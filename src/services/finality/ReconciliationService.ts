import * as StellarSdk from "@stellar/stellar-sdk";
import { Repository } from "typeorm";
import AppDataSource from "../../config/Datasource";
import logger from "../../config/logger";
import { TransactionLifecycle } from "../../transactions/TransactionLifecycle.entity";
import { FinalityPolicy } from "./FinalityPolicy";
import { ReorgEvent } from "./ReorgEvent";
import { EventEmitter } from "events";

export type ReconciliationOutcome =
  | "tx_found_same_ledger"
  | "tx_found_different_ledger"
  | "tx_not_found"
  | "provider_unavailable"
  | "conflicting_results";

export interface ReconciliationResult {
  outcome: ReconciliationOutcome;
  ledgerSequence?: number;
  ledgerHash?: string;
  txResult?: string;
  error?: string;
}

/**
 * Handles reconciliation with independent Horizon endpoint after orphan or STALE.
 * Queries reconciliation provider to determine true canonical state.
 */
export class ReconciliationService extends EventEmitter {
  private lifecycleRepo: Repository<TransactionLifecycle>;
  private reconciliationServer: StellarSdk.Horizon.Server;
  private reconciliationAttempts: Map<string, number> = new Map();

  constructor(private policy: FinalityPolicy) {
    super();
    this.lifecycleRepo = AppDataSource.getRepository(TransactionLifecycle);
    this.reconciliationServer = new StellarSdk.Horizon.Server(policy.reconciliationHorizonUrl);
  }

  /**
   * Reconcile a transaction that was marked ORPHANED or STALE.
   * Queries the independent reconciliation Horizon endpoint.
   */
  async reconcile(transactionId: string, txHash: string): Promise<ReconciliationResult> {
    const attempts = (this.reconciliationAttempts.get(txHash) || 0) + 1;
    this.reconciliationAttempts.set(txHash, attempts);

    if (attempts > this.policy.maxReconciliationAttempts) {
      logger.error("Max reconciliation attempts exceeded", {
        transactionId,
        txHash,
        attempts,
      });

      // Mark as final reconciliation failure
      const lifecycle = await this.lifecycleRepo.findOneOrFail({
        where: { id: transactionId },
      });
      lifecycle.finalityStatus = "ORPHANED"; // Terminal state
      await this.lifecycleRepo.save(lifecycle);

      this.emitReorgEvent({
        eventType: "reconciliation_provider_unavailable",
        transactionId,
        transactionHash: txHash,
        network: this.policy.network,
        timestamp: new Date().toISOString(),
        previousStatus: "RECONCILING",
        newStatus: "ORPHANED",
        details: {
          attempts,
          maxAttempts: this.policy.maxReconciliationAttempts,
          reconciliationProvider: this.policy.reconciliationHorizonUrl,
        },
      });

      return {
        outcome: "provider_unavailable",
        error: `Max reconciliation attempts (${attempts}) exceeded`,
      };
    }

    try {
      logger.info("Reconciling transaction", {
        transactionId,
        txHash,
        attempt: attempts,
      });

      // Query reconciliation provider for this transaction
      const transactions = await this.reconciliationServer
        .transactions()
        .transaction(txHash)
        .call();

      if (!transactions) {
        logger.warn("Transaction not found on reconciliation provider", {
          transactionId,
          txHash,
        });

        return {
          outcome: "tx_not_found",
          txResult: "NOT_FOUND",
        };
      }

      const ledgerSequence = transactions.ledger;
      const ledgerHash = transactions.ledger_attr?.hash || "unknown";
      const txResult = transactions.successful ? "SUCCESS" : "FAILED";

      logger.info("Transaction found on reconciliation provider", {
        transactionId,
        txHash,
        ledgerSequence,
        ledgerHash,
        txResult,
      });

      // Update lifecycle with reconciliation result
      const lifecycle = await this.lifecycleRepo.findOneOrFail({
        where: { id: transactionId },
      });

      const originalLedgerSequence = lifecycle.ledgerSequence;
      const isSameLedger = ledgerSequence === originalLedgerSequence;

      if (isSameLedger) {
        // Same ledger on both providers - probably a false alarm fork
        lifecycle.finalityStatus = "CONFIRMING";
        lifecycle.confirmationDepth = 0; // Reset depth
        lifecycle.reconciledAt = new Date();
        lifecycle.reconcileProvider = this.policy.reconciliationHorizonUrl;
        await this.lifecycleRepo.save(lifecycle);

        this.emitReorgEvent({
          eventType: "reconciliation_updated",
          transactionId,
          transactionHash: txHash,
          network: this.policy.network,
          timestamp: new Date().toISOString(),
          previousStatus: "RECONCILING",
          newStatus: "CONFIRMING",
          details: {
            ledgerSequence,
            ledgerHash,
            txResult,
            reconciliationProvider: this.policy.reconciliationHorizonUrl,
          },
        });

        // Emit event to restart confirmation tracking
        this.emit("reconciliation:success", {
          transactionId,
          txHash,
          ledgerSequence,
          ledgerHash,
        });

        return {
          outcome: "tx_found_same_ledger",
          ledgerSequence,
          ledgerHash,
          txResult,
        };
      } else {
        // Different ledger - transaction was re-included after fork
        lifecycle.ledgerSequence = ledgerSequence;
        lifecycle.ledgerHash = ledgerHash;
        lifecycle.finalityStatus = "CONFIRMING";
        lifecycle.confirmationDepth = 0; // Reset depth for new ledger
        lifecycle.reconciledAt = new Date();
        lifecycle.reconcileProvider = this.policy.reconciliationHorizonUrl;
        await this.lifecycleRepo.save(lifecycle);

        this.emitReorgEvent({
          eventType: "reconciliation_updated",
          transactionId,
          transactionHash: txHash,
          network: this.policy.network,
          timestamp: new Date().toISOString(),
          previousStatus: "RECONCILING",
          newStatus: "CONFIRMING",
          details: {
            originalLedgerSequence,
            newLedgerSequence: ledgerSequence,
            ledgerHash,
            txResult,
            reconciliationProvider: this.policy.reconciliationHorizonUrl,
          },
        });

        // Emit event to restart confirmation tracking at new ledger
        this.emit("reconciliation:success", {
          transactionId,
          txHash,
          ledgerSequence,
          ledgerHash,
        });

        return {
          outcome: "tx_found_different_ledger",
          ledgerSequence,
          ledgerHash,
          txResult,
        };
      }
    } catch (error) {
      if (error instanceof StellarSdk.NotFoundError) {
        logger.warn("Transaction not found on reconciliation provider", {
          transactionId,
          txHash,
        });

        return {
          outcome: "tx_not_found",
          txResult: "NOT_FOUND",
        };
      }

      logger.error("Reconciliation error", {
        transactionId,
        txHash,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Retry reconciliation later
      this.emit("reconciliation:retry", {
        transactionId,
        txHash,
        delayMs: this.policy.reconciliationRetryDelayMs,
      });

      return {
        outcome: "provider_unavailable",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Handle reconciliation failure where both providers agree tx is not found.
   */
  async handleReconciliationFailure(
    transactionId: string,
    txHash: string,
    primaryResult: string,
    reconciliationResult: string
  ): Promise<void> {
    logger.error("Reconciliation failed - true orphan", {
      transactionId,
      txHash,
      primaryResult,
      reconciliationResult,
    });

    const lifecycle = await this.lifecycleRepo.findOneOrFail({
      where: { id: transactionId },
    });
    lifecycle.finalityStatus = "ORPHANED"; // Terminal
    await this.lifecycleRepo.save(lifecycle);

    this.emitReorgEvent({
      eventType: "reconciliation_failed",
      transactionId,
      transactionHash: txHash,
      network: this.policy.network,
      timestamp: new Date().toISOString(),
      previousStatus: "RECONCILING",
      newStatus: "ORPHANED",
      details: {
        primaryProvider: this.policy.primaryHorizonUrl,
        reconciliationProvider: this.policy.reconciliationHorizonUrl,
        primaryResult,
        reconciliationResult,
      },
    });
  }

  /**
   * Handle conflicting provider results.
   */
  async handleConflictingProviders(
    transactionId: string,
    txHash: string,
    primaryResult: string,
    reconciliationResult: string
  ): Promise<void> {
    logger.error("Conflicting provider results", {
      transactionId,
      txHash,
      primaryResult,
      reconciliationResult,
    });

    const lifecycle = await this.lifecycleRepo.findOneOrFail({
      where: { id: transactionId },
    });
    lifecycle.finalityStatus = "CONFLICTED"; // Terminal - requires manual resolution
    await this.lifecycleRepo.save(lifecycle);

    this.emitReorgEvent({
      eventType: "conflicting_providers",
      transactionId,
      transactionHash: txHash,
      network: this.policy.network,
      timestamp: new Date().toISOString(),
      previousStatus: "RECONCILING",
      newStatus: "CONFLICTED",
      details: {
        primaryProvider: this.policy.primaryHorizonUrl,
        reconciliationProvider: this.policy.reconciliationHorizonUrl,
        primaryResult,
        reconciliationResult,
      },
    });
  }

  /**
   * Reset reconciliation attempts for a transaction (e.g., after successful reconciliation).
   */
  resetAttempts(txHash: string): void {
    this.reconciliationAttempts.delete(txHash);
  }

  /**
   * Emit a structured reorg event.
   */
  private emitReorgEvent(event: ReorgEvent): void {
    logger.warn("ReorgEvent", JSON.stringify(event));
    this.emit("reorg:event", event);
  }
}
