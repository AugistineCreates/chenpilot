import * as StellarSdk from "@stellar/stellar-sdk";
import config from "../config/config";
import logger from "../config/logger";
import { transactionLifecycleService } from "../transactions/TransactionLifecycle.service";
import { durableOperationService } from "../Reliability/DurableOperationService";
import { SafeXdrDecoder } from "../utils/xdr";

/**
 * Delay strategy for transaction submission
 */
export type DelayStrategy = "scheduled" | "fee_based" | "congestion_based";

export interface DelayedTransactionConfig {
  strategy: DelayStrategy;

  /**
   * Unix timestamp (in milliseconds) to submit at (for 'scheduled' strategy)
   */
  scheduledAt?: number;

  /**
   * Maximum fee willing to pay (in stroops) for 'fee_based' strategy
   */
  maxFee?: number;

  /**
   * Target fee (stroops) for 'fee_based' strategy
   */
  targetFee?: number;

  /**
   * Maximum number of retries
   */
  maxRetries?: number;

  /**
   * Retry delay in milliseconds
   */
  scheduledAt?: number;
  maxFee?: number;
  targetFee?: number;
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Status of a delayed transaction
 */
export type DelayedTransactionStatus =
  | "pending"
  | "waiting_for_fee"
  | "waiting_for_congestion"
  | "submitting"
  | "submitted"
  | "failed"
  | "cancelled";

export interface DelayedTransaction {
  id: string;
  userId: string;
  transactionXdr: string;
  config: DelayedTransactionConfig;
  status: DelayedTransactionStatus;
  createdAt: number;
  submittedAt?: number;
  txHash?: string;
  error?: string;
  retries: number;
}

/**
 * Network fee info
 */
export interface NetworkFeeInfo {
  /**
   * Current fee in stroops per operation
   */
  fee: number;

  /**
   * Last updated timestamp
   */
  lastUpdated: number;

  /**
   * Number of pending transactions in the network
   */
  pendingTxCount?: number;
}

/**
 * Service for managing delayed transaction submission
 * Service for managing delayed transaction submission using Durable Operations
 */
export class DelayedTransactionService {
  private server: StellarSdk.Horizon.Server;
  private readonly DEFAULT_MAX_FEE = 100000;
  private readonly DEFAULT_TARGET_FEE = 5000;

  constructor() {
    this.server = new StellarSdk.Horizon.Server(config.stellar.horizonUrl);

    // Register handler for delayed transactions
    durableOperationService.registerHandler(
      "delayed_transaction",
      async (payload) => {
        return this.executeTransaction(payload.transactionXdr);
      }
    );
  }

  /**
   * Initialize the delayed transaction service
   */
  async initialize(): Promise<void> {
    // Start background checking for delayed transactions
    this.startChecking();

    logger.info("Delayed transaction service initialized");
  }

  /**
   * Start periodic checking of delayed transactions
   */
  private startChecking(): void {
    this.checkInterval = setInterval(async () => {
      await this.processDelayedTransactions();
    }, 10000); // Check every 10 seconds
  }

  /**
   * Stop periodic checking
   */
  stopChecking(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    logger.info(
      "Delayed transaction service initialized with durable framework"
    );
  }

  async createDelayedTransaction(
    userId: string,
    transactionXdr: string,
    config: DelayedTransactionConfig
  ): Promise<unknown> {
    this.validateConfig(config);

    try {
      SafeXdrDecoder.decodeTransaction(transactionXdr, {
        networkPassphrase: config.stellar.networkPassphrase,
      });
    } catch (error) {
      throw new Error(
        `Invalid transaction XDR: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }

    const initialAvailableAt =
      delayedConfig.strategy === "scheduled" && delayedConfig.scheduledAt
        ? new Date(delayedConfig.scheduledAt)
        : new Date();

    await jobQueueService.enqueueWithContext({
      queue: "transactions",
      jobType: "delayed_transaction.submit",
      userId,
      availableAt: initialAvailableAt,
      maxAttempts: delayedConfig.maxRetries ?? 3,
      metadata: { strategy: delayedConfig.strategy },
      payload: {
        userId,
        transactionXdr,
        config: delayedConfig,
      },
    });

    this.pendingDelayedTxs.set(delayedTx.id, delayedTx);

    logger.info(
      `Created delayed transaction ${delayedTx.id} with strategy ${config.strategy}`
    );

    // If already ready to submit, try immediately
    if (delayedTx.status === "submitting") {
      this.submitTransaction(delayedTx.id);
    }
    return durableOperationService.execute({
      category: "delayed_transaction",
      payload: { userId, transactionXdr },
      scheduledAt:
        config.strategy === "scheduled"
          ? new Date(config.scheduledAt!)
          : undefined,
      conditions: config.strategy !== "scheduled" ? config : undefined,
      maxRetries: config.maxRetries,
    });
  }

  private async executeTransaction(
    xdr: string
  ): Promise<{ hash: string; ledger: number; envelopeXdr: string }> {
    const tx = SafeXdrDecoder.decodeTransaction(xdr, {
      networkPassphrase: config.stellar.networkPassphrase,
    }) as StellarSdk.Transaction;
    const result = await this.server.submitTransaction(tx);
    return {
      hash: result.hash,
      ledger: result.ledger,
      envelopeXdr: result.envelope_xdr,
    };
  }

  private validateConfig(config: DelayedTransactionConfig): void {
    if (!config.strategy) {
      throw new Error("Delay strategy is required");
    }

    switch (config.strategy) {
      case "scheduled":
        if (!config.scheduledAt) {
          throw new Error("scheduledAt is required for 'scheduled' strategy");
        }
        if (config.scheduledAt < Date.now()) {
          throw new Error("scheduledAt must be in the future");
        }
        break;

      case "fee_based":
        if (!config.targetFee && !config.maxFee) {
          config.targetFee = this.DEFAULT_TARGET_FEE;
          config.maxFee = this.DEFAULT_MAX_FEE;
        }
        break;

      case "congestion_based":
        // No specific validation needed
        break;
    }
  }

  /**
   * Process all pending delayed transactions
   */
  private async processDelayedTransactions(): Promise<void> {
    const txsToRemove: string[] = [];

    for (const [id, delayedTx] of this.pendingDelayedTxs.entries()) {
      if (
        delayedTx.status === "submitted" ||
        delayedTx.status === "failed" ||
        delayedTx.status === "cancelled"
      ) {
        txsToRemove.push(id);
        continue;
      }

      // Check if ready to submit based on strategy
      const shouldSubmit = await this.checkShouldSubmit(delayedTx);

      if (shouldSubmit) {
        await this.submitTransaction(id);
      }
    }
  }

  /**
   * Check if a delayed transaction should be submitted
   */
  private async checkShouldSubmit(
    delayedTx: DelayedTransaction
  ): Promise<boolean> {
    const { config } = delayedTx;

    switch (config.strategy) {
      case "scheduled":
        // Submit if scheduled time has passed
        return config.scheduledAt ? Date.now() >= config.scheduledAt : false;

      case "fee_based":
        // Submit if current fee is below target
        return await this.isFeeAcceptable(config);

      case "congestion_based":
        // Submit if network is not congested
        return await this.isNetworkCongestionAcceptable();

      default:
        return false;
    }
  }

  /**
   * Check if current fee is acceptable
   */
  private async isFeeAcceptable(
    config: DelayedTransactionConfig
  ): Promise<boolean> {
    const feeInfo = await this.getCurrentFee();

    const targetFee = config.targetFee || this.DEFAULT_TARGET_FEE;
    const maxFee = config.maxFee || this.DEFAULT_MAX_FEE;

    return feeInfo.fee <= targetFee || feeInfo.fee <= maxFee;
  }

  /**
   * Check if network congestion is acceptable
   */
  private async isNetworkCongestionAcceptable(): Promise<boolean> {
    // Simple congestion check - can be enhanced with more sophisticated logic
    const feeInfo = await this.getCurrentFee();

    // Consider network uncongested if fee is below 10000 stroops (0.001 XLM)
    return feeInfo.fee <= 10000;
  }

  /**
   * Get current network fee
   */
  private async getCurrentFee(): Promise<NetworkFeeInfo> {
    // Check cache
    if (
      this.lastFeeInfo &&
      Date.now() - this.lastFeeInfo.lastUpdated < this.FEE_CACHE_TTL
    ) {
      return this.lastFeeInfo;
    }

    try {
      // Get latest fee from Horizon
      const response = await this.server.feeStats().call();

      this.lastFeeInfo = {
        fee: response.fee_charged.max_fee || 100,
        lastUpdated: Date.now(),
        pendingTxCount: response.operations_in_queue_total || 0,
      };

      return this.lastFeeInfo;
    } catch (error) {
      logger.error("Error fetching fee stats:", error);

      // Return default fee if unable to fetch
      return {
        fee: 100,
        lastUpdated: Date.now(),
      };
    }
  }

  /**
   * Submit a delayed transaction
   */
  private async submitTransaction(
    id: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const delayedTx = this.pendingDelayedTxs.get(id);
    if (!delayedTx) {
      return { success: false, error: "Transaction not found" };
    }

    delayedTx.status = "submitting";

    try {
      const networkPassphrase = config.stellar.networkPassphrase;
      const tx = SafeXdrDecoder.decodeTransaction(delayedTx.transactionXdr, {
        networkPassphrase,
      }) as StellarSdk.Transaction;

      const response = await this.server.submitTransaction(tx);

      delayedTx.status = "submitted";
      delayedTx.submittedAt = Date.now();
      delayedTx.txHash = response.hash;

      logger.info(
        `Successfully submitted delayed transaction ${id}: ${response.hash}`
      );

      return { success: true, txHash: response.hash };
    } catch (error) {
      delayedTx.retries++;
      const maxRetries = delayedTx.config.maxRetries || 3;

      if (delayedTx.retries >= maxRetries) {
        delayedTx.status = "failed";
        delayedTx.error =
          error instanceof Error ? error.message : "Unknown error";
        logger.error(
          `Delayed transaction ${id} failed after ${maxRetries} retries`
        );
      } else {
        if (delayedTx.config.strategy === "fee_based") {
          delayedTx.status = "waiting_for_fee";
        } else if (delayedTx.config.strategy === "congestion_based") {
          delayedTx.status = "waiting_for_congestion";
        } else {
          delayedTx.status = "pending";
        }

        logger.warn(
          `Delayed transaction ${id} failed, retry ${delayedTx.retries}/${maxRetries}`
        );
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Cancel a delayed transaction
   */
  cancelTransaction(id: string): boolean {
    const delayedTx = this.pendingDelayedTxs.get(id);

    if (!delayedTx) {
      return false;
    }

    delayedTx.status = "cancelled";

    if (delayedTx.lifecycleId) {
      transactionLifecycleService
        .cancel(delayedTx.lifecycleId, "Cancelled by user")
        .catch((err) => {
          logger.warn("Failed to cancel lifecycle for delayed transaction", {
            id,
            err,
          });
        });
    }

    logger.info(`Cancelled delayed transaction ${id}`);

    return true;
  }

  destroy(): void {
    logger.info("Delayed transaction service shutdown complete");
  }

  /**
   * Get all pending delayed transactions for a user
   */
  getUserTransactions(userId: string): DelayedTransaction[] {
    return Array.from(this.pendingDelayedTxs.values()).filter(
      (tx) =>
        tx.userId === userId &&
        tx.status !== "submitted" &&
        tx.status !== "failed" &&
        tx.status !== "cancelled"
    );
  }

  /**
   * Update a scheduled transaction time
   */
  rescheduleTransaction(id: string, newScheduledAt: number): boolean {
    const delayedTx = this.pendingDelayedTxs.get(id);

    if (!delayedTx) {
      return false;
    }

    delayedTx.config.scheduledAt = newScheduledAt;
    delayedTx.status = "pending";

    logger.info(
      `Rescheduled delayed transaction ${id} to ${new Date(newScheduledAt).toISOString()}`
    );

    return true;
  }
}

export const delayedTransactionService = new DelayedTransactionService();
