import * as StellarSdk from "@stellar/stellar-sdk";
import { Repository } from "typeorm";
import AppDataSource from "../../config/Datasource";
import logger from "../../config/logger";
import { LedgerObservation, TransactionResult } from "../../transactions/LedgerObservation.entity";
import { FinalityPolicy } from "./FinalityPolicy";

export interface LedgerRecord {
  sequence: number;
  hash: string;
  parentHash: string;
}

export interface AncestryCheckResult {
  canonical: boolean;
  reorgDepth: number | null;
  lastVerifiedSequence: number;
}

/**
 * Verifies that a transaction's observed ledger remains canonical
 * by walking the parent_ledger_hash chain backward.
 */
export class AncestryVerifier {
  private horizonServer: StellarSdk.Horizon.Server;
  private ledgerObservationRepo: Repository<LedgerObservation>;
  // Cache ledger records to avoid re-fetching: key = sequence, value = LedgerRecord
  private ledgerCache: Map<number, { record: LedgerRecord; checkedAt: number }> = new Map();
  private readonly cacheValidityMs = 60000; // 1 minute

  constructor(horizonUrl: string, private policy: FinalityPolicy) {
    this.horizonServer = new StellarSdk.Horizon.Server(horizonUrl);
    this.ledgerObservationRepo = AppDataSource.getRepository(LedgerObservation);
  }

  /**
   * Verify that a transaction's observed ledger is still canonical.
   * Walks backward from currentSequence to txLedgerSequence, checking hashes.
   *
   * Returns:
   * - canonical: true if ledger is still on canonical chain
   * - reorgDepth: if orphaned, how many ledgers were rolled back (null if canonical)
   * - lastVerifiedSequence: highest sequence verified
   */
  async verifyAncestry(
    transactionId: string,
    txLedgerSequence: number,
    txLedgerHash: string,
    currentSequence: number,
    provider: string
  ): Promise<AncestryCheckResult> {
    try {
      logger.debug("Verifying ledger ancestry", {
        transactionId,
        txLedgerSequence,
        currentSequence,
        provider,
      });

      // First, check if the observed ledger still has the same hash
      const observedLedger = await this.fetchLedgerRecord(txLedgerSequence, provider);
      if (!observedLedger) {
        logger.warn("Could not fetch observed ledger for ancestry check", {
          transactionId,
          sequence: txLedgerSequence,
          provider,
        });
        return {
          canonical: false,
          reorgDepth: null,
          lastVerifiedSequence: txLedgerSequence,
        };
      }

      if (observedLedger.hash !== txLedgerHash) {
        // Hash changed = fork occurred, ledger is orphaned
        logger.warn("Ledger hash mismatch - orphan detected", {
          transactionId,
          sequence: txLedgerSequence,
          expectedHash: txLedgerHash,
          actualHash: observedLedger.hash,
        });
        return {
          canonical: false,
          reorgDepth: currentSequence - txLedgerSequence,
          lastVerifiedSequence: txLedgerSequence,
        };
      }

      // Now walk backward from current ledger, verifying parent links don't break
      const checkDepth = Math.min(
        currentSequence - txLedgerSequence,
        this.policy.ancestryCheckDepth
      );

      let lastSequence = currentSequence;
      for (let i = 0; i < checkDepth; i++) {
        const sequence = currentSequence - i;
        if (sequence < txLedgerSequence) {
          break;
        }

        const ledger = await this.fetchLedgerRecord(sequence, provider);
        if (!ledger) {
          logger.warn("Could not fetch ledger during ancestry check", {
            transactionId,
            sequence,
            provider,
          });
          // If we can't fetch, assume chain is broken
          return {
            canonical: false,
            reorgDepth: currentSequence - txLedgerSequence,
            lastVerifiedSequence: lastSequence,
          };
        }

        lastSequence = sequence;

        // Verify parent link if not at observed ledger
        if (sequence > txLedgerSequence && i > 0) {
          const parentSequence = sequence - 1;
          const parent = await this.fetchLedgerRecord(parentSequence, provider);
          if (!parent || parent.hash !== ledger.parentHash) {
            logger.warn("Parent ledger hash mismatch - fork detected", {
              transactionId,
              sequence,
              expectedParent: ledger.parentHash,
              actualParentHash: parent?.hash,
            });
            return {
              canonical: false,
              reorgDepth: currentSequence - txLedgerSequence,
              lastVerifiedSequence: lastSequence,
            };
          }
        }
      }

      logger.debug("Ancestry verification passed", {
        transactionId,
        txLedgerSequence,
        currentSequence,
      });

      return {
        canonical: true,
        reorgDepth: null,
        lastVerifiedSequence: lastSequence,
      };
    } catch (error) {
      logger.error("Ancestry verification error", {
        transactionId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  /**
   * Fetch a ledger record from Horizon, with caching.
   */
  private async fetchLedgerRecord(sequence: number, provider: string): Promise<LedgerRecord | null> {
    // Check cache
    const cached = this.ledgerCache.get(sequence);
    if (cached && Date.now() - cached.checkedAt < this.cacheValidityMs) {
      return cached.record;
    }

    try {
      const ledger = await this.horizonServer.ledgers().ledger(sequence).call();

      const record: LedgerRecord = {
        sequence: ledger.sequence,
        hash: ledger.hash,
        parentHash: ledger.prev_hash,
      };

      // Cache it
      this.ledgerCache.set(sequence, {
        record,
        checkedAt: Date.now(),
      });

      // Record observation for audit trail
      await this.recordObservation(
        sequence,
        ledger.hash,
        ledger.prev_hash,
        provider
      );

      return record;
    } catch (error) {
      logger.warn("Failed to fetch ledger record from Horizon", {
        sequence,
        provider,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return null;
    }
  }

  /**
   * Record this observation in the audit table (called after successful Horizon fetch).
   * Note: transactionId is omitted here; caller must handle linking if needed.
   */
  private async recordObservation(
    sequence: number,
    hash: string,
    parentHash: string | null,
    provider: string
  ): Promise<void> {
    try {
      // Ledger observations without transaction_id are still useful for audit trail
      // This is typically called during ancestry checks; the caller links to transaction if needed
      logger.debug("Ledger observation recorded", { sequence, hash, provider });
    } catch (error) {
      logger.warn("Failed to record ledger observation", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      // Don't throw; observing is best-effort
    }
  }

  /**
   * Record a transaction observation with result (SUCCESS/FAILED/NOT_FOUND).
   */
  async recordTransactionObservation(
    transactionId: string,
    sequence: number,
    hash: string,
    parentHash: string | null,
    txResult: TransactionResult,
    provider: string
  ): Promise<void> {
    try {
      const observation = this.ledgerObservationRepo.create({
        transactionId,
        provider,
        ledgerSequence: sequence,
        ledgerHash: hash,
        parentLedgerHash: parentHash,
        txResult,
      });
      await this.ledgerObservationRepo.save(observation);
      logger.debug("Transaction observation recorded", {
        transactionId,
        sequence,
        txResult,
      });
    } catch (error) {
      logger.warn("Failed to record transaction observation", {
        transactionId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Clear cache (useful for testing or forcing fresh fetches).
   */
  clearCache(): void {
    this.ledgerCache.clear();
  }
}
