import { QuarantinedGap, GapStatus } from "./gapTypes";
import { logInfo, logWarn } from "../../config/logger";

/**
 * Ingestion Gap Quarantine Store.
 * Holds quarantined gaps for ledger sequences that were skipped, dropped,
 * or truncated during ingestion.
 */
export class GapQuarantineStore {
  private gaps = new Map<string, QuarantinedGap>();
  private idCounter = 1;

  /**
   * Quarantines a new gap of missing ledgers.
   */
  async quarantineGap(options: {
    streamId: string;
    fromLedger: number;
    toLedger: number;
    failureReason?: string;
    providerId?: string;
  }): Promise<QuarantinedGap> {
    const { streamId, fromLedger, toLedger, failureReason, providerId } = options;
    const gapId = `gap-${streamId}-${fromLedger}-${toLedger}-${this.idCounter++}`;
    const missingCount = Math.max(1, toLedger - fromLedger + 1);

    const gap: QuarantinedGap = {
      gapId,
      streamId,
      fromLedger,
      toLedger,
      status: "QUARANTINED",
      missingLedgersCount: missingCount,
      detectedAt: new Date().toISOString(),
      failureReason,
      providerId,
      retryCount: 0,
    };

    this.gaps.set(gapId, gap);
    logWarn("[GapQuarantineStore] Quarantined ledger gap", {
      gapId,
      streamId,
      fromLedger,
      toLedger,
      missingCount,
      reason: failureReason,
    });

    return gap;
  }

  /**
   * Retrieves all active (unresolved) gaps for a given stream.
   */
  async getActiveGaps(streamId: string): Promise<QuarantinedGap[]> {
    return Array.from(this.gaps.values()).filter(
      (g) => g.streamId === streamId && (g.status === "QUARANTINED" || g.status === "REPLAYING")
    );
  }

  /**
   * Checks whether there are active gaps affecting ledgers up to targetLedger.
   */
  async hasActiveGaps(streamId: string, upToLedger?: number): Promise<boolean> {
    const active = await this.getActiveGaps(streamId);
    if (!active.length) return false;
    if (upToLedger === undefined) return true;
    return active.some((g) => g.fromLedger <= upToLedger);
  }

  /**
   * Marks a quarantined gap as currently replaying.
   */
  async markGapReplaying(gapId: string): Promise<void> {
    const gap = this.gaps.get(gapId);
    if (gap) {
      gap.status = "REPLAYING";
      gap.retryCount++;
    }
  }

  /**
   * Resolves a quarantined gap after complete and contiguous backfill.
   */
  async resolveGap(gapId: string): Promise<void> {
    const gap = this.gaps.get(gapId);
    if (gap) {
      gap.status = "RESOLVED";
      gap.resolvedAt = new Date().toISOString();
      logInfo("[GapQuarantineStore] Resolved ledger gap", {
        gapId,
        streamId: gap.streamId,
        fromLedger: gap.fromLedger,
        toLedger: gap.toLedger,
      });
    }
  }

  /**
   * Marks a quarantined gap as failed after retry limits.
   */
  async markGapFailed(gapId: string, reason: string): Promise<void> {
    const gap = this.gaps.get(gapId);
    if (gap) {
      gap.status = "FAILED";
      gap.failureReason = reason;
      logWarn("[GapQuarantineStore] Gap backfill failed", { gapId, reason });
    }
  }

  /**
   * Clears all quarantined gaps (useful for testing or full stream resets).
   */
  async clearAll(streamId?: string): Promise<void> {
    if (streamId) {
      for (const [id, gap] of this.gaps.entries()) {
        if (gap.streamId === streamId) {
          this.gaps.delete(id);
        }
      }
    } else {
      this.gaps.clear();
    }
  }

  getAllGaps(): QuarantinedGap[] {
    return Array.from(this.gaps.values());
  }
}

export const gapQuarantineStore = new GapQuarantineStore();
