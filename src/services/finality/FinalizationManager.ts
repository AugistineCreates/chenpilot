import logger from "../../config/logger";
import { TransactionLifecycle } from "../../transactions/TransactionLifecycle.entity";
import { FinalityPolicy, loadFinalityPolicyFromEnv } from "./FinalityPolicy";
import { ConfirmationDepthTracker } from "./ConfirmationDepthTracker";
import { ReconciliationService } from "./ReconciliationService";
import { ReorgEvent } from "./ReorgEvent";
import { EventEmitter } from "events";

/**
 * Orchestrates reorg-aware transaction finality tracking.
 * Manages confirmation depth polling and reconciliation flows.
 */
export class FinalizationManager extends EventEmitter {
  private confirmationTracker: ConfirmationDepthTracker;
  private reconciliationService: ReconciliationService;
  private reconciliationTimeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor(private policy: FinalityPolicy) {
    super();
    this.confirmationTracker = new ConfirmationDepthTracker(policy);
    this.reconciliationService = new ReconciliationService(policy);

    // Wire up event handlers
    this.wireEventHandlers();
  }

  /**
   * Start finality tracking for a transaction observed in a ledger.
   */
  async startTracking(
    transactionId: string,
    txHash: string,
    ledgerSequence: number,
    ledgerHash: string,
    provider: string
  ): Promise<void> {
    logger.info("FinalizationManager: starting tracking", {
      transactionId,
      txHash,
      ledgerSequence,
    });

    await this.confirmationTracker.startConfirmationTracking(
      transactionId,
      txHash,
      ledgerSequence,
      ledgerHash,
      provider
    );
  }

  /**
   * Stop tracking a transaction (cleanup).
   */
  stopTracking(txHash: string): void {
    this.confirmationTracker.stopTracking(txHash);
    this.reconciliationService.resetAttempts(txHash);

    // Clear any pending reconciliation timeouts
    const timeout = this.reconciliationTimeouts.get(txHash);
    if (timeout) {
      clearTimeout(timeout);
      this.reconciliationTimeouts.delete(txHash);
    }
  }

  /**
   * Get the current finality policy.
   */
  getPolicy(): FinalityPolicy {
    return this.policy;
  }

  /**
   * Get active confirmations (for monitoring/testing).
   */
  getActiveConfirmations() {
    return this.confirmationTracker.getActiveConfirmations();
  }

  /**
   * Wire up event handlers between services.
   */
  private wireEventHandlers(): void {
    // When finality is declared, emit it externally and clean up
    this.confirmationTracker.on("finality:declared", (data) => {
      logger.info("Finality declared", data);
      this.stopTracking(data.txHash);
      this.emit("finality:declared", data);
    });

    // When orphan is detected, trigger reconciliation
    this.confirmationTracker.on("orphan:detected", (data) => {
      logger.warn("Orphan detected, starting reconciliation", {
        transactionId: data.transactionId,
        txHash: data.txHash,
      });
      this.triggerReconciliation(data.transactionId, data.txHash);
    });

    // When STALE is detected, trigger reconciliation
    this.confirmationTracker.on("stale:detected", (data) => {
      logger.warn("STALE detected, starting reconciliation", {
        transactionId: data.transactionId,
        txHash: data.txHash,
      });
      this.triggerReconciliation(data.transactionId, data.txHash);
    });

    // Reorg events from confirmation tracker
    this.confirmationTracker.on("reorg:event", (event: ReorgEvent) => {
      this.emit("reorg:event", event);
    });

    // When reconciliation succeeds, restart confirmation tracking
    this.reconciliationService.on("reconciliation:success", (data) => {
      logger.info("Reconciliation success, restarting confirmation tracking", {
        transactionId: data.transactionId,
        txHash: data.txHash,
        newLedgerSequence: data.ledgerSequence,
      });
      this.reconciliationService.resetAttempts(data.txHash);
      this.startTracking(
        data.transactionId,
        data.txHash,
        data.ledgerSequence,
        data.ledgerHash,
        this.policy.reconciliationHorizonUrl
      ).catch((error) => {
        logger.error("Failed to restart tracking after reconciliation", {
          transactionId: data.transactionId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      });
    });

    // When reconciliation needs retry, schedule it
    this.reconciliationService.on("reconciliation:retry", (data) => {
      logger.warn("Reconciliation retry scheduled", {
        transactionId: data.transactionId,
        delayMs: data.delayMs,
      });
      this.scheduleReconciliationRetry(data.transactionId, data.txHash, data.delayMs);
    });

    // Reorg events from reconciliation service
    this.reconciliationService.on("reorg:event", (event: ReorgEvent) => {
      this.emit("reorg:event", event);
    });
  }

  /**
   * Trigger reconciliation for a transaction.
   */
  private async triggerReconciliation(transactionId: string, txHash: string): Promise<void> {
    try {
      const result = await this.reconciliationService.reconcile(transactionId, txHash);

      if (result.outcome === "tx_found_same_ledger" || result.outcome === "tx_found_different_ledger") {
        // Success - reconciliation service will emit reconciliation:success event
      } else if (result.outcome === "tx_not_found") {
        // Both providers return NOT_FOUND
        await this.reconciliationService.handleReconciliationFailure(
          transactionId,
          txHash,
          "NOT_FOUND",
          "NOT_FOUND"
        );
      } else if (result.outcome === "provider_unavailable") {
        // Provider error or max attempts exceeded - already handled by service
      }
    } catch (error) {
      logger.error("Error triggering reconciliation", {
        transactionId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Schedule a reconciliation retry.
   */
  private scheduleReconciliationRetry(
    transactionId: string,
    txHash: string,
    delayMs: number
  ): void {
    // Cancel any existing retry
    const existing = this.reconciliationTimeouts.get(txHash);
    if (existing) {
      clearTimeout(existing);
    }

    const timeout = setTimeout(() => {
      this.reconciliationTimeouts.delete(txHash);
      this.triggerReconciliation(transactionId, txHash).catch((error) => {
        logger.error("Reconciliation retry error", {
          transactionId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      });
    }, delayMs);

    this.reconciliationTimeouts.set(txHash, timeout);
  }

  /**
   * Shutdown the manager (cleanup all pending operations).
   */
  shutdown(): void {
    logger.info("FinalizationManager shutting down");
    for (const [, timeout] of this.reconciliationTimeouts) {
      clearTimeout(timeout);
    }
    this.reconciliationTimeouts.clear();
    this.removeAllListeners();
  }
}

// Global singleton
let globalFinalizationManager: FinalizationManager | null = null;

/**
 * Get or create the global finalization manager.
 */
export function getFinalizationManager(): FinalizationManager {
  if (!globalFinalizationManager) {
    const policy = loadFinalityPolicyFromEnv(process.env.STELLAR_NETWORK || "testnet");
    globalFinalizationManager = new FinalizationManager(policy);
  }
  return globalFinalizationManager;
}

/**
 * Initialize the global finalization manager with a custom policy.
 */
export function initializeFinalizationManager(policy: FinalityPolicy): FinalizationManager {
  if (globalFinalizationManager) {
    globalFinalizationManager.shutdown();
  }
  globalFinalizationManager = new FinalizationManager(policy);
  return globalFinalizationManager;
}
