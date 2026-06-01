import * as StellarSdk from "@stellar/stellar-sdk";
import config from "../config/config";
import AppDataSource from "../config/Datasource";
import logger from "../config/logger";

/**
 * Delay strategy for transaction submission
 */
export type DelayStrategy =
  /**
   * Submit at a specific time
   */
  | "scheduled"
  /**
   * Submit when network fees are below threshold
   */
  | "fee_based"
  /**
   * Submit when network is less congested
   */
  | "congestion_based";

/**
 * Configuration for delayed transaction submission
 */
export interface DelayedTransactionConfig {
  /**
   * Delay strategy to use
   */
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

/**
 * Delayed transaction record
 */
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
 */
export class DelayedTransactionService {
  private server: StellarSdk.Horizon.Server;
  private pendingDelayedTxs: Map<string, DelayedTransaction> = new Map();
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private lastFeeInfo: NetworkFeeInfo | null = null;
  private readonly FEE_CACHE_TTL = 60000; // 1 minute
  private readonly DEFAULT_MAX_FEE = 100000; // 0.01 XLM
  private readonly DEFAULT_TARGET_FEE = 5000; // 0.0005 XLM
  private readonly DEFAULT_RETRY_DELAY = 30000; // 30 seconds

  constructor() {
    this.server = new StellarSdk.Horizon.Server(config.stellar.horizonUrl);
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
  }

  /**
   * Create a delayed transaction
   */
  async createDelayedTransaction(
    userId: string,
    transactionXdr: string,
    config: DelayedTransactionConfig
  ): Promise<DelayedTransaction> {
    // Validate config based on strategy
    this.validateConfig(config);

    // Validate the XDR
    try {
      const _tx = StellarSdk.Transaction.fromXDR(
        transactionXdr,
        "Test SDF Network ; September 2015"
      );
    } catch (error) {
      throw new Error(
        `Invalid transaction XDR: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }

    const delayedTx: DelayedTransaction = {
      id: this.generateId(),
      userId,
      transactionXdr,
      config,
      status: "pending",
      createdAt: Date.now(),
      retries: 0,
    };

    // Set initial status based on strategy
    if (config.strategy === "scheduled" && config.scheduledAt) {
      if (config.scheduledAt <= Date.now()) {
        // Already past scheduled time, submit now
        delayedTx.status = "submitting";
      } else {
        delayedTx.status = "pending";
      }
    } else if (config.strategy === "fee_based") {
      delayedTx.status = "waiting_for_fee";
    } else if (config.strategy === "congestion_based") {
      delayedTx.status = "waiting_for_congestion";
    }

    this.pendingDelayedTxs.set(delayedTx.id, delayedTx);

    logger.info(
      `Created delayed transaction ${delayedTx.id} with strategy ${config.strategy}`
    );

    // If already ready to submit, try immediately
    if (delayedTx.status === "submitting") {
      this.submitTransaction(delayedTx.id);
    }

    return delayedTx;
  }

  /**
   * Validate delay configuration
   */
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

    // Clean up processed transactions
    for (const id of txsToRemove) {
      this.pendingDelayedTxs.delete(id);
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

    // If current fee is within range, submit
    return feeInfo.fee <= maxFee;
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
      const tx = StellarSdk.Transaction.fromXDR(
        delayedTx.transactionXdr,
        networkPassphrase
      );

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
        // Reset status based on strategy
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
  cancelTransaction(id: string, userId: string): boolean {
    const delayedTx = this.pendingDelayedTxs.get(id);

    if (!delayedTx) {
      return false;
    }

    if (delayedTx.userId !== userId) {
      return false;
    }

    if (delayedTx.status === "submitted") {
      return false;
    }

    delayedTx.status = "cancelled";
    logger.info(`Cancelled delayed transaction ${id}`);

    return true;
  }

  /**
   * Get a delayed transaction by ID
   */
  getTransaction(id: string): DelayedTransaction | undefined {
    return this.pendingDelayedTxs.get(id);
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
  rescheduleTransaction(
    id: string,
    userId: string,
    newScheduledAt: number
  ): boolean {
    const delayedTx = this.pendingDelayedTxs.get(id);

    if (!delayedTx) {
      return false;
    }

    if (delayedTx.userId !== userId) {
      return false;
    }

    if (delayedTx.config.strategy !== "scheduled") {
      return false;
    }

    if (newScheduledAt < Date.now()) {
      return false;
    }

    delayedTx.config.scheduledAt = newScheduledAt;
    delayedTx.status = "pending";

    logger.info(
      `Rescheduled delayed transaction ${id} to ${new Date(newScheduledAt).toISOString()}`
    );

    return true;
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `delayed_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopChecking();
    this.pendingDelayedTxs.clear();
  }
}

// Export singleton instance
export const delayedTransactionService = new DelayedTransactionService();
