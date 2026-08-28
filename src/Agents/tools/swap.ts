import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import * as StellarSdk from "@stellar/stellar-sdk";
import config from "../../config/config";
import { accountSecretStore } from "../../Auth/accountSecretStore";
import logger from "../../config/logger";
import stellarPriceService from "../../services/stellarPrice.service";
import { flashSwapRiskAnalyzer } from "../../services/flashSwapRiskAnalyzer";
import { RedisLockService } from "../../services/lock";
import { transactionLifecycleService } from "../../transactions/TransactionLifecycle.service";
import { assetRevocationService } from "../../Security";

interface SwapPayload extends Record<string, unknown> {
  from: string;
  to: string;
  amount: number;
}

interface StellarAccountData {
  userId: string;
  secretKey: string;
  publicKey: string;
  [key: string]: unknown;
}

// Stellar asset definitions
const STELLAR_ASSETS: Record<string, StellarSdk.Asset> = {
  XLM: StellarSdk.Asset.native(),
  USDC: new StellarSdk.Asset(
    "USDC",
    "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" // Stellar USDC issuer (Circle)
  ),
  USDT: new StellarSdk.Asset(
    "USDT",
    "GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V" // Stellar USDT issuer
  ),
};

/**
 * Tool for swapping tokens on the Stellar DEX using path payments with risk analysis and distributed locking
 */
export class SwapTool extends BaseTool<SwapPayload> {
  metadata: ToolMetadata = {
    name: "swap_tool",
    description: "Swap tokens on the Stellar DEX using path payments",
    parameters: {
      from: {
        type: "string",
        description: "Source token symbol",
        required: true,
        enum: ["XLM", "USDC", "USDT"],
      },
      to: {
        type: "string",
        description: "Target token symbol",
        required: true,
        enum: ["XLM", "USDC", "USDT"],
      },
      amount: {
        type: "number",
        description: "Amount to swap",
        required: true,
        min: 0,
      },
    },
    examples: [
      "Swap 100 XLM to USDC",
      "Convert 50 USDC to XLM",
      "Exchange 10 USDT for XLM",
    ],
    category: "trading",
    version: "1.0.0",
    riskLevel: "high",
    capabilities: ["dex_trading", "path_payment"],
    permissions: ["user"],
  };

  private server: StellarSdk.Horizon.Server;
  private lockService: RedisLockService;
  private readonly defaultLockTtlMs = 300000;
  private readonly lockHeartbeatIntervalMs = 30000;

  /**
   * Initialize the swap tool with Stellar Horizon server and Redis lock service
   */
  constructor() {
    super();
    this.server = new StellarSdk.Horizon.Server(config.stellar.horizonUrl);
    this.lockService = new RedisLockService();
  }

  /**
   * Get a Stellar keypair for the user from stored account data
   * @param userId - The user ID
   * @returns Stellar keypair
   * @throws Error if account not found
   */
  private getStellarAccount(userId: string): StellarSdk.Keypair {
    const accountData =
      accountSecretStore.getAccountByUserId<StellarAccountData>(userId);

    if (!accountData?.secretKey) {
      throw new Error(`Stellar account not found for user: ${userId}`);
    }

    return StellarSdk.Keypair.fromSecret(accountData.secretKey);
  }

  /**
   * Execute a token swap on Stellar DEX with risk analysis and distributed locking
   * @param payload - The swap payload with from, to assets and amount
   * @param userId - The user executing the swap
   * @returns ToolResult with swap result
   */
  async execute(payload: SwapPayload, userId: string): Promise<ToolResult> {
    // Create lifecycle record at intent state
    const lifecycle = await transactionLifecycleService.create(userId, "swap", {
      from: payload.from,
      to: payload.to,
      amount: payload.amount,
    });

    // Create a unique lock key for this user's trading operations
    const lockKey = `trade:${userId}`;

    try {
      // Acquire distributed lock to prevent concurrent trades for the same user
      const lockResult = await this.lockService.acquireLock(lockKey, userId, {
        ttl: this.defaultLockTtlMs,
        retryDelay: 200,
        maxRetries: 15,
      });

      if (!lockResult.acquired) {
        logger.warn("Failed to acquire trade lock", {
          userId,
          lockKey,
          error: lockResult.error,
        });
        await transactionLifecycleService.fail(
          lifecycle.id,
          "Trade lock not acquired — another trade in progress"
        );
        return this.createErrorResult(
          "swap",
          "Another trade is currently in progress for your account. Please wait a moment and try again."
        );
      }

      logger.info("Trade lock acquired", {
        userId,
        lockKey,
        lockValue: lockResult.lockValue,
      });

      const heartbeat = this.startLockHeartbeat(lockKey, userId);

      // Ensure lock is released when function completes or throws
      const lockReleased = await this.executeWithLock(
        payload,
        userId,
        lockKey,
        lifecycle.id,
        heartbeat
      );

      return lockReleased;
    } catch (error) {
      logger.error("Error during swap execution", {
        userId,
        error,
      });

      await transactionLifecycleService.fail(
        lifecycle.id,
        error instanceof Error ? error.message : "Unknown error during swap"
      );

      // Try to release lock if something went wrong
      try {
        await this.lockService.releaseLock(lockKey, userId);
      } catch (releaseError) {
        logger.error("Failed to release lock after error", {
          userId,
          lockKey,
          error: releaseError,
        });
      }

      return this.createErrorResult(
        "swap",
        error instanceof Error
          ? error.message
          : "Unknown error occurred during swap"
      );
    }
  }

  /**
   * Start a periodic heartbeat to keep the distributed lock alive
   * @param lockKey - The lock key
   * @param userId - The user ID
   * @returns Interval timer reference
   */
  private startLockHeartbeat(
    lockKey: string,
    userId: string
  ): NodeJS.Timeout | undefined {
    return setInterval(async () => {
      const extended = await this.lockService.extendLock(
        lockKey,
        userId,
        this.defaultLockTtlMs
      );
      if (!extended) {
        logger.warn("Trade lock heartbeat failed", { userId, lockKey });
      }
    }, this.lockHeartbeatIntervalMs);
  }

  /**
   * Stop the lock heartbeat interval
   * @param heartbeat - The interval timer to clear
   */
  private stopLockHeartbeat(heartbeat?: NodeJS.Timeout): void {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
  }

  /**
   * Execute the swap while holding the distributed lock
   * @param payload - The swap payload
   * @param userId - The user ID
   * @param lockKey - The lock key
   * @param lifecycleId - Transaction lifecycle ID
   * @param heartbeat - Optional heartbeat timer reference
   * @returns ToolResult with swap result
   */
  private async executeWithLock(
    payload: SwapPayload,
    userId: string,
    lockKey: string,
    lifecycleId: string,
    heartbeat?: NodeJS.Timeout
  ): Promise<ToolResult> {
    try {
      // Validate tokens
      if (payload.from === payload.to) {
        await transactionLifecycleService.fail(
          lifecycleId,
          "Source and destination tokens must be different"
        );
        return this.createErrorResult(
          "swap",
          "Source and destination tokens must be different"
        );
      }

      const sourceAsset = STELLAR_ASSETS[payload.from];
      const destAsset = STELLAR_ASSETS[payload.to];

      if (!sourceAsset || !destAsset) {
        await transactionLifecycleService.fail(
          lifecycleId,
          "Invalid token symbol"
        );
        return this.createErrorResult(
          "swap",
          "Invalid token symbol. Supported: XLM, USDC, USDT"
        );
      }

      // Simulation phase — price quote + risk analysis
      await transactionLifecycleService.transition(lifecycleId, "simulating");

      const priceQuote = await stellarPriceService.getPrice(
        payload.from,
        payload.to,
        payload.amount
      );

      logger.info("Price quote obtained", {
        price: priceQuote.price,
        estimatedOutput: priceQuote.estimatedOutput,
        cached: priceQuote.cached,
        path: priceQuote.path,
      });

      // Analyze swap risk for sandwich attacks
      logger.info("Analyzing swap risk", { userId, amount: payload.amount });
      const riskAnalysis = await flashSwapRiskAnalyzer.analyzeSwapRisk({
        fromAsset: sourceAsset,
        toAsset: destAsset,
        amount: payload.amount,
      });

      // Notify user of risks
      if (riskAnalysis.riskLevel === "critical") {
        await transactionLifecycleService.fail(
          lifecycleId,
          `Critical sandwich attack risk: ${riskAnalysis.sandwichAttackRisk}`,
          { riskAnalysis }
        );
        return this.createErrorResult(
          "swap",
          `CRITICAL RISK: Swap blocked due to high sandwich attack risk (${(riskAnalysis.sandwichAttackRisk * 100).toFixed(1)}%). ${riskAnalysis.warnings.join(". ")}. Recommendations: ${riskAnalysis.recommendations.join(". ")}`
        );
      }

      if (riskAnalysis.riskLevel === "high") {
        logger.warn("High risk swap detected", { userId, riskAnalysis });
      }

      // Execution phase — build and sign transaction
      await transactionLifecycleService.transition(lifecycleId, "executing", {
        metadata: {
          estimatedOutput: priceQuote.estimatedOutput,
          riskLevel: riskAnalysis.riskLevel,
        },
      });

      const sourceKeypair = this.getStellarAccount(userId);
      const sourcePublicKey = sourceKeypair.publicKey();

      logger.info("Initiating swap", {
        userId,
        amount: payload.amount,
        from: payload.from,
        to: payload.to,
        riskLevel: riskAnalysis.riskLevel,
      });

      const sourceAccount = await this.server.loadAccount(sourcePublicKey);
      const sendAmount = payload.amount.toFixed(7);
      const minDestAmount = (priceQuote.estimatedOutput * 0.99).toFixed(7);

      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: config.stellar.networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.pathPaymentStrictSend({
            sendAsset: sourceAsset,
            sendAmount: sendAmount,
            destination: sourcePublicKey,
            destAsset: destAsset,
            destMin: minDestAmount,
          })
        )
        .setTimeout(30)
        .build();

      transaction.sign(sourceKeypair);

      // Re-check revocation immediately before submission
      try {
        const sourceRevocation = await assetRevocationService.isRevoked(sourceAsset.code, "asset");
        if (sourceRevocation.revoked) {
          await transactionLifecycleService.fail(lifecycleId, `Asset ${sourceAsset.code} revoked before submission: ${sourceRevocation.reason}`);
          return this.createErrorResult("swap", `Asset ${sourceAsset.code} has been revoked: ${sourceRevocation.reason}`);
        }
        const destRevocation = await assetRevocationService.isRevoked(destAsset.code, "asset");
        if (destRevocation.revoked) {
          await transactionLifecycleService.fail(lifecycleId, `Asset ${destAsset.code} revoked before submission: ${destRevocation.reason}`);
          return this.createErrorResult("swap", `Asset ${destAsset.code} has been revoked: ${destRevocation.reason}`);
        }
      } catch (err) {
        logger.warn("Revocation re-check failed before swap submission", { userId, error: err });
      }

      // Submission phase
      await transactionLifecycleService.transition(lifecycleId, "submitting");

      const result = await this.server.submitTransaction(transaction);

      // Confirmed
      await transactionLifecycleService.transition(lifecycleId, "submitted", {
        correlationId: result.hash,
        metadata: { txHash: result.hash, ledger: result.ledger },
      });
      await transactionLifecycleService.transition(lifecycleId, "confirmed", {
        metadata: { successful: result.successful },
      });

      return this.createSuccessResult("swap", {
        from: payload.from,
        to: payload.to,
        amount: payload.amount,
        estimatedOutput: priceQuote.estimatedOutput,
        price: priceQuote.price,
        txHash: result.hash,
        timestamp: new Date().toISOString(),
        ledger: result.ledger,
        successful: result.successful,
        lifecycleId: lifecycleId,
        riskAnalysis: {
          level: riskAnalysis.riskLevel,
          sandwichAttackRisk: riskAnalysis.sandwichAttackRisk,
          warnings: riskAnalysis.warnings,
          recommendations: riskAnalysis.recommendations,
        },
      });
    } catch (error) {
      logger.error("Error during swap execution with lock", { userId, error });
      await transactionLifecycleService.fail(
        lifecycleId,
        error instanceof Error ? error.message : "Unknown error"
      );
      return this.createErrorResult(
        "swap",
        error instanceof Error
          ? error.message
          : "Unknown error occurred during swap"
      );
    } finally {
      this.stopLockHeartbeat(heartbeat);

      // Always release the lock when done
      try {
        const released = await this.lockService.releaseLock(lockKey, userId);
        if (released) {
          logger.info("Trade lock released successfully", { userId, lockKey });
        } else {
          logger.warn("Failed to release trade lock", { userId, lockKey });
        }
      } catch (releaseError) {
        logger.error("Error releasing trade lock", {
          userId,
          lockKey,
          error: releaseError,
        });
      }
    }
  }
}

export const swapTool = new SwapTool();
