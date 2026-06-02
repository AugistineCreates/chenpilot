import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import * as StellarSdk from "@stellar/stellar-sdk";
import config from "../../config/config";
import { accountSecretStore } from "../../Auth/accountSecretStore";
import logger from "../../config/logger";
import stellarPriceService from "../../services/stellarPrice.service";
import { flashSwapRiskAnalyzer } from "../../services/flashSwapRiskAnalyzer";
import { RedisLockService } from "../../services/lock";

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

  constructor() {
    super();
    this.server = new StellarSdk.Horizon.Server(config.stellar.horizonUrl);
    this.lockService = new RedisLockService();
  }

  private getStellarAccount(userId: string): StellarSdk.Keypair {
    const accountData =
      accountSecretStore.getAccountByUserId<StellarAccountData>(userId);

    if (!accountData?.secretKey) {
      throw new Error(`Stellar account not found for user: ${userId}`);
    }

    return StellarSdk.Keypair.fromSecret(accountData.secretKey);
  }

  async execute(payload: SwapPayload, userId: string): Promise<ToolResult> {
    // Create a unique lock key for this user's trading operations
    const lockKey = `trade:${userId}`;

    try {
      // Acquire distributed lock to prevent concurrent trades for the same user
      const lockResult = await this.lockService.acquireLock(lockKey, userId, {
        ttl: 60000, // 60 second lock timeout
        retryDelay: 200, // 200ms between retries
        maxRetries: 15, // Maximum 3 seconds of retries
      });

      if (!lockResult.acquired) {
        logger.warn("Failed to acquire trade lock", {
          userId,
          lockKey,
          error: lockResult.error,
        });

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

      // Ensure lock is released when function completes or throws
      const lockReleased = await this.executeWithLock(payload, userId, lockKey);

      return lockReleased;
    } catch (error) {
      logger.error("Error during swap execution", {
        userId,
        error,
      });

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

  private async executeWithLock(
    payload: SwapPayload,
    userId: string,
    lockKey: string
  ): Promise<ToolResult> {
    try {
      // Validate tokens
      if (payload.from === payload.to) {
        return this.createErrorResult(
          "swap",
          "Source and destination tokens must be different"
        );
      }

      const sourceAsset = STELLAR_ASSETS[payload.from];
      const destAsset = STELLAR_ASSETS[payload.to];

      if (!sourceAsset || !destAsset) {
        return this.createErrorResult(
          "swap",
          "Invalid token symbol. Supported: XLM, USDC, USDT"
        );
      }

      // Get price quote (with caching)
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
        return this.createErrorResult(
          "swap",
          `CRITICAL RISK: Swap blocked due to high sandwich attack risk (${(riskAnalysis.sandwichAttackRisk * 100).toFixed(1)}%). ${riskAnalysis.warnings.join(". ")}. Recommendations: ${riskAnalysis.recommendations.join(". ")}`
        );
      }

      if (riskAnalysis.riskLevel === "high") {
        logger.warn("High risk swap detected", { userId, riskAnalysis });
      }

      // Get user's Stellar keypair
      const sourceKeypair = this.getStellarAccount(userId);
      const sourcePublicKey = sourceKeypair.publicKey();

      logger.info("Initiating swap", {
        userId,
        amount: payload.amount,
        from: payload.from,
        to: payload.to,
        riskLevel: riskAnalysis.riskLevel,
      });

      // Load source account to get sequence number
      const sourceAccount = await this.server.loadAccount(sourcePublicKey);

      // Convert amount to Stellar format (7 decimal places)
      const sendAmount = payload.amount.toFixed(7);

      // Calculate minimum destination amount with 1% slippage tolerance
      const minDestAmount = (priceQuote.estimatedOutput * 0.99).toFixed(7);

      // Build transaction with path payment strict send
      // This automatically finds the best path through Stellar's DEX
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: config.stellar.networkPassphrase,
      })
        .addOperation(
          StellarSdk.Operation.pathPaymentStrictSend({
            sendAsset: sourceAsset,
            sendAmount: sendAmount,
            destination: sourcePublicKey, // Send to self (swap)
            destAsset: destAsset,
            destMin: minDestAmount, // Minimum acceptable amount with slippage
          })
        )
        .setTimeout(30)
        .build();

      // Sign transaction
      transaction.sign(sourceKeypair);

      // Submit to Stellar network
      const result = await this.server.submitTransaction(transaction);

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
        riskAnalysis: {
          level: riskAnalysis.riskLevel,
          sandwichAttackRisk: riskAnalysis.sandwichAttackRisk,
          warnings: riskAnalysis.warnings,
          recommendations: riskAnalysis.recommendations,
        },
      });
    } catch (error) {
      logger.error("Error during swap execution with lock", {
        userId,
        error,
      });

      return this.createErrorResult(
        "swap",
        error instanceof Error
          ? error.message
          : "Unknown error occurred during swap"
      );
    } finally {
      // Always release the lock when done
      try {
        const released = await this.lockService.releaseLock(lockKey, userId);

        if (released) {
          logger.info("Trade lock released successfully", {
            userId,
            lockKey,
          });
        } else {
          logger.warn("Failed to release trade lock", {
            userId,
            lockKey,
          });
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
