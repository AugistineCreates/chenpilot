import * as StellarSdk from "@stellar/stellar-sdk";
import config from "../config/config";
import { TelegramAdapter } from "../../packages/bot/src/adapters/telegram";
import { DiscordAdapter } from "../../packages/bot/src/adapters/discord";
import {
  TransactionNotificationData,
  BotNotificationConfig,
} from "../../packages/bot/src/types";
import logger from "../config/logger";

/**
 * Transaction monitoring configuration
 */
export interface TransactionMonitorConfig {
  /**
   * Horizon server URL
   */
  horizonUrl: string;

  /**
   * Poll interval in milliseconds
   */
  pollInterval: number;

  /**
   * Confirmation threshold
   */
  confirmations: number;

  /**
   * Notification config
   */
  notification: BotNotificationConfig;
}

/**
 * Pending transaction to monitor
 */
interface PendingTransaction {
  userId: string;
  hash: string;
  from: string;
  to: string;
  amount: string;
  asset: string;
  fee?: string;
  memo?: string;
  submittedAt: number;
  notificationSent: boolean;
}

/**
 * Service for monitoring transactions and sending bot notifications
 */
export class TransactionNotificationService {
  private server: StellarSdk.Horizon.Server;
  private telegramAdapter: TelegramAdapter | null = null;
  private discordAdapter: DiscordAdapter | null = null;
  private pendingTransactions: Map<string, PendingTransaction> = new Map();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private config: TransactionMonitorConfig;

  constructor(config?: Partial<TransactionMonitorConfig>) {
    const horizonUrl = config?.horizonUrl || "https://horizon.stellar.org";
    this.server = new StellarSdk.Horizon.Server(horizonUrl);

    this.config = {
      horizonUrl: config?.horizonUrl || "https://horizon.stellar.org",
      pollInterval: config?.pollInterval || 10000, // 10 seconds
      confirmations: config?.confirmations || 1,
      notification: config?.notification || {
        telegramEnabled: true,
        discordEnabled: true,
        minConfirmations: 1,
        template: "standard",
      },
    };
  }

  /**
   * Initialize the notification service
   */
  async initialize(
    telegramToken?: string,
    discordToken?: string
  ): Promise<void> {
    // Initialize Telegram adapter
    if (this.config.notification.telegramEnabled && telegramToken) {
      this.telegramAdapter = new TelegramAdapter(telegramToken);
      await this.telegramAdapter.init();
    }

    // Initialize Discord adapter
    if (this.config.notification.discordEnabled && discordToken) {
      this.discordAdapter = new DiscordAdapter(discordToken);
      await this.discordAdapter.init();
    }

    // Start polling for transaction confirmations
    this.startPolling();

    logger.info("Transaction notification service initialized");
  }

  /**
   * Start polling for transaction confirmations
   */
  private startPolling(): void {
    this.pollInterval = setInterval(async () => {
      await this.checkPendingTransactions();
    }, this.config.pollInterval);
  }

  /**
   * Stop polling
   */
  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Add a transaction to monitor
   */
  addPendingTransaction(
    userId: string,
    txHash: string,
    data: {
      from: string;
      to: string;
      amount: string;
      asset: string;
      fee?: string;
      memo?: string;
    }
  ): void {
    this.pendingTransactions.set(txHash, {
      userId,
      hash: txHash,
      ...data,
      submittedAt: Date.now(),
      notificationSent: false,
    });

    logger.info(`Monitoring transaction ${txHash} for user ${userId}`);
  }

  /**
   * Check all pending transactions for confirmations
   */
  private async checkPendingTransactions(): Promise<void> {
    const txsToRemove: string[] = [];

    for (const [hash, pending] of this.pendingTransactions.entries()) {
      try {
        const tx = await this.server.transactions().transaction(hash).call();

        if (tx.successful) {
          // Transaction confirmed - send notification
          await this.sendTransactionNotification(pending, true);
          txsToRemove.push(hash);
        } else if (tx.failure_reason) {
          // Transaction failed - send failure notification
          await this.sendTransactionNotification(pending, false);
          txsToRemove.push(hash);
        }
      } catch (error) {
        // Transaction not found yet - continue monitoring
        // Could be pending or not yet submitted
        if ((error as any).response?.status === 404) {
          continue;
        }
        logger.error(`Error checking transaction ${hash}:`, error);
      }
    }

    // Clean up processed transactions
    for (const hash of txsToRemove) {
      this.pendingTransactions.delete(hash);
    }
  }

  /**
   * Send transaction notification via configured adapters
   */
  private async sendTransactionNotification(
    pending: PendingTransaction,
    successful: boolean
  ): Promise<void> {
    if (pending.notificationSent) {
      return;
    }

    const notificationData: TransactionNotificationData = {
      hash: pending.hash,
      successful,
      amount: pending.amount,
      asset: pending.asset,
      from: pending.from,
      to: pending.to,
      timestamp: Date.now(),
      fee: pending.fee,
      memo: pending.memo,
      userId: pending.userId,
    };

    // Send Telegram notification
    if (this.telegramAdapter) {
      await this.telegramAdapter.sendTransactionNotification(
        pending.userId,
        notificationData
      );
    }

    // Send Discord notification
    if (this.discordAdapter) {
      await this.discordAdapter.sendTransactionNotification(
        pending.userId,
        notificationData
      );
    }

    // Mark as notified
    pending.notificationSent = true;

    logger.info(
      `Sent ${successful ? "success" : "failure"} notification for tx ${pending.hash}`
    );
  }

  /**
   * Register a user for notifications
   */
  async registerUser(
    userId: string,
    telegramChatId?: string,
    discordChannelId?: string
  ): Promise<void> {
    if (this.telegramAdapter && telegramChatId) {
      await this.telegramAdapter.registerUser(userId, telegramChatId);
    }

    if (this.discordAdapter && discordChannelId) {
      await this.discordAdapter.registerUser(userId, discordChannelId);
    }
  }

  /**
   * Send a custom notification to a user
   */
  async sendCustomNotification(userId: string, message: string): Promise<void> {
    if (this.telegramAdapter) {
      await this.telegramAdapter.sendNotification(userId, message);
    }

    if (this.discordAdapter) {
      await this.discordAdapter.sendNotification(userId, message);
    }
  }

  /**
   * Get pending transaction count
   */
  getPendingCount(): number {
    return this.pendingTransactions.size;
  }

  /**
   * Check if a transaction is being monitored
   */
  isMonitoring(txHash: string): boolean {
    return this.pendingTransactions.has(txHash);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopPolling();
  }
}

// Export singleton instance
export const transactionNotificationService =
  new TransactionNotificationService();
