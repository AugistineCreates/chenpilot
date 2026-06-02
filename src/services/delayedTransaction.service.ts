import * as StellarSdk from "@stellar/stellar-sdk";
import config from "../config/config";
import logger from "../config/logger";
import { durableOperationService } from "../Reliability/DurableOperationService";

/**
 * Delay strategy for transaction submission
 */
export type DelayStrategy = 
  | "scheduled"
  | "fee_based"
  | "congestion_based";

/**
 * Configuration for delayed transaction submission
 */
export interface DelayedTransactionConfig {
  strategy: DelayStrategy;
  scheduledAt?: number;
  maxFee?: number;
  targetFee?: number;
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Service for managing delayed transaction submission using Durable Operations
 */
export class DelayedTransactionService {
  private server: StellarSdk.Horizon.Server;
  private readonly DEFAULT_MAX_FEE = 100000;
  private readonly DEFAULT_TARGET_FEE = 5000;

  constructor() {
    this.server = new StellarSdk.Horizon.Server(config.stellar.horizonUrl);
    
    // Register handler for delayed transactions
    durableOperationService.registerHandler("delayed_transaction", async (payload) => {
      return this.executeTransaction(payload.transactionXdr);
    });
  }

  /**
   * Initialize the delayed transaction service
   */
  async initialize(): Promise<void> {
    logger.info("Delayed transaction service initialized with durable framework");
  }

  /**
   * Create a delayed transaction
   */
  async createDelayedTransaction(
    userId: string,
    transactionXdr: string,
    config: DelayedTransactionConfig
  ): Promise<any> {
    this.validateConfig(config);

    try {
      StellarSdk.Transaction.fromXDR(transactionXdr, StellarSdk.Networks.TESTNET);
    } catch (error) {
      throw new Error(`Invalid transaction XDR: ${error instanceof Error ? error.message : "Unknown error"}`);
    }

    return durableOperationService.execute({
      category: "delayed_transaction",
      payload: { userId, transactionXdr },
      scheduledAt: config.strategy === "scheduled" ? new Date(config.scheduledAt!) : undefined,
      conditions: config.strategy !== "scheduled" ? config : undefined,
      maxRetries: config.maxRetries,
    });
  }

  private async executeTransaction(xdr: string): Promise<any> {
    const tx = StellarSdk.Transaction.fromXDR(xdr, StellarSdk.Networks.TESTNET);
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

    if (config.strategy === "scheduled") {
      if (!config.scheduledAt) throw new Error("scheduledAt is required for 'scheduled' strategy");
      if (config.scheduledAt < Date.now()) throw new Error("scheduledAt must be in the future");
    }
  }
}

export const delayedTransactionService = new DelayedTransactionService();


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
    if (this.lastFeeInfo && Date.now() - this.lastFeeInfo.lastUpdated < this.FEE_CACHE_TTL) {
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
  private async submitTransaction(id: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const delayedTx = this.pendingDelayedTxs.get(id);
    if (!delayedTx) {
      return { success: false, error: "Transaction not found" };
    }

    delayedTx.status = "submitting";
    
    try {
      const networkPassphrase = config.stellar.networkPassphrase;
      const tx = StellarSdk.Transaction.fromXDR(delayedTx.transactionXdr, networkPassphrase);
      
      const response = await this.server.submitTransaction(tx);
      
      delayedTx.status = "submitted";
      delayedTx.submittedAt = Date.now();
      delayedTx.txHash = response.hash;
      
      logger.info(`Successfully submitted delayed transaction ${id}: ${response.hash}`);
      
      return { success: true, txHash: response.hash };
    } catch (error) {
      delayedTx.retries++;
      const maxRetries = delayedTx.config.maxRetries || 3;
      
      if (delayedTx.retries >= maxRetries) {
        delayedTx.status = "failed";
        delayedTx.error = error instanceof Error ? error.message : "Unknown error";
        logger.error(`Delayed transaction ${id} failed after ${maxRetries} retries`);
      } else {
        // Reset status based on strategy
        if (delayedTx.config.strategy === "fee_based") {
          delayedTx.status = "waiting_for_fee";
        } else if (delayedTx.config.strategy === "congestion_based") {
          delayedTx.status = "waiting_for_congestion";
        } else {
          delayedTx.status = "pending";
        }
        
        logger.warn(`Delayed transaction ${id} failed, retry ${delayedTx.retries}/${maxRetries}`);
      }
      
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
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
      (tx) => tx.userId === userId && tx.status !== "submitted" && tx.status !== "failed" && tx.status !== "cancelled"
    );
  }

  /**
   * Update a scheduled transaction time
   */
  rescheduleTransaction(id: string, userId: string, newScheduledAt: number): boolean {
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
    
    logger.info(`Rescheduled delayed transaction ${id} to ${new Date(newScheduledAt).toISOString()}`);
    
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
