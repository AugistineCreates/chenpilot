/**
 * Real-time Updates Integration Helper
 * Provides utilities and helpers for integrating Socket.io updates into services
 */

import {
  TransactionEventBridge,
  BotEventBridge,
  DeploymentEventBridge,
} from "./eventBridges";
import logger from "../config/logger";

/**
 * Integration helper to emit transaction updates from service handlers
 *
 * @example
 * // In a transaction service
 * TransactionUpdateHelper.notifyCreated(txId, txHash, userId);
 * // ... perform transaction...
 * TransactionUpdateHelper.notifyConfirmed(txId, txHash, ledger, fee, userId);
 */
export class TransactionUpdateHelper {
  static notifyCreated(
    transactionId: string,
    transactionHash: string,
    userId?: string
  ): void {
    TransactionEventBridge.notifyTransactionCreated(
      transactionId,
      transactionHash,
      userId
    );
  }

  static notifyPending(
    transactionId: string,
    transactionHash: string,
    userId?: string
  ): void {
    TransactionEventBridge.notifyTransactionUpdate({
      transactionId,
      transactionHash,
      status: "pending",
      timestamp: new Date(),
      userId,
    });
  }

  static notifyConfirmed(
    transactionId: string,
    transactionHash: string,
    ledger?: number,
    feeUsed?: number,
    userId?: string
  ): void {
    TransactionEventBridge.notifyTransactionConfirmed(
      transactionId,
      transactionHash,
      ledger,
      feeUsed,
      userId
    );
  }

  static notifyFailed(
    transactionId: string,
    transactionHash: string,
    reason?: string,
    userId?: string
  ): void {
    TransactionEventBridge.notifyTransactionFailed(
      transactionId,
      transactionHash,
      reason,
      userId
    );
  }
}

/**
 * Integration helper to emit swap updates from service handlers
 *
 * @example
 * // In a swap service
 * SwapUpdateHelper.notifyStarted(swapId, txHash, userId);
 * // ... perform swap...
 * SwapUpdateHelper.notifyCompleted(swapId, txHash, details, userId);
 */
export class SwapUpdateHelper {
  static notifyStarted(
    swapId: string,
    transactionHash: string,
    userId?: string
  ): void {
    TransactionEventBridge.notifySwapStatus(
      swapId,
      transactionHash,
      "pending",
      undefined,
      userId
    );
  }

  static notifyProgress(
    swapId: string,
    transactionHash: string,
    progress: number,
    userId?: string
  ): void {
    TransactionEventBridge.notifySwapStatus(
      swapId,
      transactionHash,
      "pending",
      { progress },
      userId
    );
  }

  static notifyCompleted(
    swapId: string,
    transactionHash: string,
    details?: Record<string, unknown>,
    userId?: string
  ): void {
    TransactionEventBridge.notifySwapStatus(
      swapId,
      transactionHash,
      "confirmed",
      details,
      userId
    );
  }

  static notifyFailed(
    swapId: string,
    transactionHash: string,
    reason?: string,
    userId?: string
  ): void {
    TransactionEventBridge.notifySwapStatus(
      swapId,
      transactionHash,
      "failed",
      reason ? { reason } : undefined,
      userId
    );
  }
}

/**
 * Integration helper to emit bot alerts and status changes
 *
 * @example
 * // In a bot service
 * BotUpdateHelper.notifyInfo("Swap started", botId, userId);
 * // ... perform action...
 * BotUpdateHelper.notifyStatusChange(botId, "active", "Bot reactivated", userId);
 */
export class BotUpdateHelper {
  static notifyInfo(
    message: string,
    botId?: string,
    userId?: string,
    details?: Record<string, unknown>
  ): void {
    BotEventBridge.notifyAlert(message, "info", botId, userId, details);
  }

  static notifyWarning(
    message: string,
    botId?: string,
    userId?: string,
    details?: Record<string, unknown>
  ): void {
    BotEventBridge.notifyAlert(message, "warning", botId, userId, details);
  }

  static notifyError(
    message: string,
    botId?: string,
    userId?: string,
    details?: Record<string, unknown>
  ): void {
    BotEventBridge.notifyError(message, botId, userId, details);
  }

  static notifyCriticalError(
    message: string,
    botId?: string,
    userId?: string,
    details?: Record<string, unknown>
  ): void {
    BotEventBridge.notifyCriticalError(message, botId, userId, details);
  }

  static notifyStatusActive(botId: string, userId?: string): void {
    BotEventBridge.notifyStatusChange(
      botId,
      "active",
      "Bot is now active",
      userId
    );
  }

  static notifyStatusInactive(botId: string, userId?: string): void {
    BotEventBridge.notifyStatusChange(
      botId,
      "inactive",
      "Bot is now inactive",
      userId
    );
  }

  static notifyStatusPaused(botId: string, userId?: string): void {
    BotEventBridge.notifyStatusChange(
      botId,
      "paused",
      "Bot is now paused",
      userId
    );
  }

  static notifyStatusError(
    botId: string,
    message: string,
    userId?: string
  ): void {
    BotEventBridge.notifyStatusChange(
      botId,
      "error",
      `Bot error: ${message}`,
      userId
    );
  }
}

/**
 * Integration helper to emit deployment status updates
 *
 * @example
 * // In a deployment service
 * DeploymentUpdateHelper.notifyStarted(deploymentId, userId);
 * // ... deploy steps...
 * DeploymentUpdateHelper.notifyProgress(deploymentId, 50, "Deploying contracts", userId);
 * DeploymentUpdateHelper.notifyCompleted(deploymentId, userId, { contractAddress: "..." });
 */
export class DeploymentUpdateHelper {
  static notifyStarted(deploymentId: string, userId?: string): void {
    DeploymentEventBridge.notifyDeploymentStarted(deploymentId, userId);
  }

  static notifyProgress(
    deploymentId: string,
    progress: number,
    message: string,
    userId?: string
  ): void {
    DeploymentEventBridge.notifyDeploymentProgress(
      deploymentId,
      Math.min(Math.max(progress, 0), 100),
      message,
      userId
    );
  }

  static notifyCompleted(
    deploymentId: string,
    userId?: string,
    details?: Record<string, unknown>
  ): void {
    DeploymentEventBridge.notifyDeploymentCompleted(
      deploymentId,
      userId,
      details
    );
  }

  static notifyFailed(
    deploymentId: string,
    reason: string,
    userId?: string
  ): void {
    DeploymentEventBridge.notifyDeploymentFailed(deploymentId, reason, userId);
  }
}

/**
 * Async wrapper to safely emit updates with error handling
 *
 * @example
 * await SafeUpdateEmitter.emitTransactionUpdate(txId, txHash, userId);
 */
export class SafeUpdateEmitter {
  static async emitTransactionCreated(
    transactionId: string,
    transactionHash: string,
    userId?: string
  ): Promise<boolean> {
    try {
      TransactionUpdateHelper.notifyCreated(
        transactionId,
        transactionHash,
        userId
      );
      return true;
    } catch (error) {
      logger.error("Failed to emit transaction created update:", { error });
      return false;
    }
  }

  static async emitTransactionConfirmed(
    transactionId: string,
    transactionHash: string,
    ledger?: number,
    feeUsed?: number,
    userId?: string
  ): Promise<boolean> {
    try {
      TransactionUpdateHelper.notifyConfirmed(
        transactionId,
        transactionHash,
        ledger,
        feeUsed,
        userId
      );
      return true;
    } catch (error) {
      logger.error("Failed to emit transaction confirmed update:", { error });
      return false;
    }
  }

  static async emitTransactionFailed(
    transactionId: string,
    transactionHash: string,
    reason?: string,
    userId?: string
  ): Promise<boolean> {
    try {
      TransactionUpdateHelper.notifyFailed(
        transactionId,
        transactionHash,
        reason,
        userId
      );
      return true;
    } catch (error) {
      logger.error("Failed to emit transaction failed update:", { error });
      return false;
    }
  }

  static async emitBotAlert(
    message: string,
    severity: "info" | "warning" | "error" | "critical" = "info",
    botId?: string,
    userId?: string,
    details?: Record<string, unknown>
  ): Promise<boolean> {
    try {
      BotUpdateHelper.notifyInfo(message, botId, userId, details);
      return true;
    } catch (error) {
      logger.error("Failed to emit bot alert:", { error });
      return false;
    }
  }

  static async emitDeploymentStatus(
    deploymentId: string,
    status: "pending" | "in-progress" | "completed" | "failed",
    message: string,
    userId?: string,
    progress?: number
  ): Promise<boolean> {
    try {
      DeploymentEventBridge.notifyDeploymentStatus(
        deploymentId,
        status,
        message,
        userId,
        progress
      );
      return true;
    } catch (error) {
      logger.error("Failed to emit deployment status update:", { error });
      return false;
    }
  }
}
