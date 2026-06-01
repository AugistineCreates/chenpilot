import { getSocketManager } from "./socketManager";
import type {
  TransactionStatusUpdate,
  BotAlert,
  BotStatusChange,
  DeploymentStatus,
} from "./socketManager";
import logger from "../config/logger";

/**
 * Event bridge for transaction notifications
 * Bridges transaction service events to Socket.io real-time updates
 */
export class TransactionEventBridge {
  /**
   * Notify transaction created
   */
  static notifyTransactionCreated(
    transactionId: string,
    transactionHash: string,
    userId?: string
  ): void {
    try {
      const socketManager = getSocketManager();
      const update: TransactionStatusUpdate = {
        transactionId,
        transactionHash,
        status: "pending",
        timestamp: new Date(),
        userId,
      };
      socketManager.getEventEmitter().emitTransactionCreated(update);
      logger.info(`Transaction created event emitted: ${transactionId}`);
    } catch (error) {
      logger.error("Error emitting transaction created event:", { error });
    }
  }

  /**
   * Notify transaction confirmed
   */
  static notifyTransactionConfirmed(
    transactionId: string,
    transactionHash: string,
    ledger?: number,
    feeUsed?: number,
    userId?: string
  ): void {
    try {
      const socketManager = getSocketManager();
      const update: TransactionStatusUpdate = {
        transactionId,
        transactionHash,
        status: "confirmed",
        timestamp: new Date(),
        ledger,
        feeUsed,
        userId,
      };
      socketManager.getEventEmitter().emitTransactionConfirmed(update);
      logger.info(`Transaction confirmed event emitted: ${transactionId}`);
    } catch (error) {
      logger.error("Error emitting transaction confirmed event:", { error });
    }
  }

  /**
   * Notify transaction failed
   */
  static notifyTransactionFailed(
    transactionId: string,
    transactionHash: string,
    reason?: string,
    userId?: string
  ): void {
    try {
      const socketManager = getSocketManager();
      const update: TransactionStatusUpdate = {
        transactionId,
        transactionHash,
        status: "failed",
        timestamp: new Date(),
        memo: reason,
        userId,
      };
      socketManager.getEventEmitter().emitTransactionFailed(update);
      logger.info(`Transaction failed event emitted: ${transactionId}`);
    } catch (error) {
      logger.error("Error emitting transaction failed event:", { error });
    }
  }

  /**
   * Notify transaction status update (generic)
   */
  static notifyTransactionUpdate(update: TransactionStatusUpdate): void {
    try {
      const socketManager = getSocketManager();
      socketManager.getEventEmitter().emitTransactionUpdate(update);
      logger.info(`Transaction update event emitted: ${update.transactionId}`);
    } catch (error) {
      logger.error("Error emitting transaction update event:", { error });
    }
  }

  /**
   * Notify swap status update
   */
  static notifySwapStatus(
    transactionId: string,
    transactionHash: string,
    status: "pending" | "confirmed" | "failed",
    details?: Record<string, unknown>,
    userId?: string
  ): void {
    try {
      const socketManager = getSocketManager();
      const update: TransactionStatusUpdate = {
        transactionId,
        transactionHash,
        status,
        timestamp: new Date(),
        memo: details ? JSON.stringify(details) : undefined,
        userId,
      };
      socketManager.getEventEmitter().emitSwapStatus(update);
      logger.info(`Swap status event emitted: ${transactionId}`);
    } catch (error) {
      logger.error("Error emitting swap status event:", { error });
    }
  }
}

/**
 * Event bridge for bot notifications
 * Bridges bot service events to Socket.io real-time updates
 */
export class BotEventBridge {
  /**
   * Notify bot alert
   */
  static notifyAlert(
    message: string,
    severity: "info" | "warning" | "error" | "critical" = "info",
    botId?: string,
    userId?: string,
    details?: Record<string, unknown>
  ): void {
    try {
      const socketManager = getSocketManager();
      const alert: BotAlert = {
        alertId: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        severity,
        message,
        botId,
        timestamp: new Date(),
        userId,
        details,
      };
      socketManager.getEventEmitter().emitBotAlert(alert);
      logger.info(`Bot alert emitted: ${message} (severity: ${severity})`);
    } catch (error) {
      logger.error("Error emitting bot alert:", { error });
    }
  }

  /**
   * Notify bot status change
   */
  static notifyStatusChange(
    botId: string,
    status: "active" | "inactive" | "error" | "paused",
    message: string,
    userId?: string
  ): void {
    try {
      const socketManager = getSocketManager();
      const statusChange: BotStatusChange = {
        botId,
        status,
        message,
        timestamp: new Date(),
        userId,
      };
      socketManager.getEventEmitter().emitBotStatusChange(statusChange);
      logger.info(`Bot status change emitted: ${botId} -> ${status}`);
    } catch (error) {
      logger.error("Error emitting bot status change:", { error });
    }
  }

  /**
   * Notify bot error
   */
  static notifyError(
    message: string,
    botId?: string,
    userId?: string,
    details?: Record<string, unknown>
  ): void {
    try {
      const socketManager = getSocketManager();
      const alert: BotAlert = {
        alertId: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        severity: "error",
        message,
        botId,
        timestamp: new Date(),
        userId,
        details,
      };
      socketManager.getEventEmitter().emitBotError(alert);
      logger.info(`Bot error emitted: ${message}`);
    } catch (error) {
      logger.error("Error emitting bot error:", { error });
    }
  }

  /**
   * Notify critical bot error
   */
  static notifyCriticalError(
    message: string,
    botId?: string,
    userId?: string,
    details?: Record<string, unknown>
  ): void {
    try {
      const socketManager = getSocketManager();
      const alert: BotAlert = {
        alertId: `critical-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        severity: "critical",
        message,
        botId,
        timestamp: new Date(),
        userId,
        details,
      };
      socketManager.getEventEmitter().emitBotError(alert);
      logger.error(`Critical bot error emitted: ${message}`);
    } catch (error) {
      logger.error("Error emitting critical bot error:", { error });
    }
  }
}

/**
 * Event bridge for deployment notifications
 */
export class DeploymentEventBridge {
  /**
   * Notify deployment status update
   */
  static notifyDeploymentStatus(
    deploymentId: string,
    status: "pending" | "in-progress" | "completed" | "failed",
    message: string,
    userId?: string,
    progress?: number,
    details?: Record<string, unknown>
  ): void {
    try {
      const socketManager = getSocketManager();
      const deploymentStatus: DeploymentStatus = {
        deploymentId,
        status,
        progress,
        message,
        timestamp: new Date(),
        userId,
        details,
      };
      socketManager.getEventEmitter().emitDeploymentStatus(deploymentStatus);
      logger.info(`Deployment status emitted: ${deploymentId} -> ${status}`);
    } catch (error) {
      logger.error("Error emitting deployment status:", { error });
    }
  }

  /**
   * Notify deployment started
   */
  static notifyDeploymentStarted(deploymentId: string, userId?: string): void {
    this.notifyDeploymentStatus(
      deploymentId,
      "in-progress",
      "Deployment in progress",
      userId,
      0
    );
  }

  /**
   * Notify deployment progress
   */
  static notifyDeploymentProgress(
    deploymentId: string,
    progress: number,
    message: string,
    userId?: string
  ): void {
    this.notifyDeploymentStatus(
      deploymentId,
      "in-progress",
      message,
      userId,
      progress
    );
  }

  /**
   * Notify deployment completed
   */
  static notifyDeploymentCompleted(
    deploymentId: string,
    userId?: string,
    details?: Record<string, unknown>
  ): void {
    this.notifyDeploymentStatus(
      deploymentId,
      "completed",
      "Deployment completed successfully",
      userId,
      100,
      details
    );
  }

  /**
   * Notify deployment failed
   */
  static notifyDeploymentFailed(
    deploymentId: string,
    reason: string,
    userId?: string
  ): void {
    this.notifyDeploymentStatus(
      deploymentId,
      "failed",
      `Deployment failed: ${reason}`,
      userId,
      undefined,
      { reason }
    );
  }
}
