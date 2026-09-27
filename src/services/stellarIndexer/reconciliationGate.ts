import {
  QuarantinedGap,
  ReconciliationBlockedByGapError,
} from "./gapTypes";
import { gapQuarantineStore, GapQuarantineStore } from "./gapQuarantineStore";
import {
  contiguousCursorStore,
  ContiguousCursorStore,
} from "./contiguousCursorStore";
import { logWarn } from "../../config/logger";

export interface ReconciliationCheckResult {
  allowed: boolean;
  targetLedger: number;
  lastContiguousLedger: number;
  blockingGaps: QuarantinedGap[];
  reason?: string;
}

/**
 * Reconciliation Gate (Issue #750 - Acceptance Criterion 2).
 * Ensures that dependent reconciliation processes are strictly BLOCKED
 * if missing ledgers or active quarantined gaps exist up to the reconciliation target.
 */
export class ReconciliationGate {
  private quarantineStore: GapQuarantineStore;
  private cursorStore: ContiguousCursorStore;

  constructor(
    quarantine: GapQuarantineStore = gapQuarantineStore,
    cursor: ContiguousCursorStore = contiguousCursorStore
  ) {
    this.quarantineStore = quarantine;
    this.cursorStore = cursor;
  }

  /**
   * Checks whether reconciliation up to targetLedger is permitted.
   */
  async checkReconciliationAllowed(
    streamId: string,
    targetLedger: number
  ): Promise<ReconciliationCheckResult> {
    const cursor = await this.cursorStore.get(streamId);
    const lastContiguous = cursor ? cursor.lastContiguousLedger : 0;

    // 1. Check for active quarantined gaps
    const activeGaps = await this.quarantineStore.getActiveGaps(streamId);
    const blockingGaps = activeGaps.filter((g) => g.fromLedger <= targetLedger);

    if (blockingGaps.length > 0) {
      const summary = blockingGaps
        .map((g) => `[${g.fromLedger}-${g.toLedger}]`)
        .join(", ");
      return {
        allowed: false,
        targetLedger,
        lastContiguousLedger: lastContiguous,
        blockingGaps,
        reason: `Reconciliation blocked: active quarantined gap(s) ${summary} detected on stream '${streamId}'`,
      };
    }

    // 2. Check if the indexer's contiguous cursor has even reached targetLedger
    if (lastContiguous < targetLedger) {
      const uningestedGap: QuarantinedGap = {
        gapId: `unindexed-${streamId}-${lastContiguous + 1}-${targetLedger}`,
        streamId,
        fromLedger: lastContiguous + 1,
        toLedger: targetLedger,
        status: "QUARANTINED",
        missingLedgersCount: targetLedger - lastContiguous,
        detectedAt: new Date().toISOString(),
        failureReason: `Indexer has not yet ingested contiguous ledgers up to target ${targetLedger} (current contiguous: ${lastContiguous})`,
        retryCount: 0,
      };

      return {
        allowed: false,
        targetLedger,
        lastContiguousLedger: lastContiguous,
        blockingGaps: [uningestedGap],
        reason: `Reconciliation blocked: stream '${streamId}' has not ingested contiguous ledgers up to ${targetLedger} (last contiguous: ${lastContiguous})`,
      };
    }

    return {
      allowed: true,
      targetLedger,
      lastContiguousLedger: lastContiguous,
      blockingGaps: [],
    };
  }

  /**
   * Asserts that reconciliation is eligible to proceed; throws ReconciliationBlockedByGapError if not.
   */
  async assertReconciliationAllowed(
    streamId: string,
    targetLedger: number
  ): Promise<void> {
    const check = await this.checkReconciliationAllowed(streamId, targetLedger);
    if (!check.allowed) {
      logWarn("[ReconciliationGate] Reconciliation rejected due to missing ledgers/gaps", {
        streamId,
        targetLedger,
        blockingCount: check.blockingGaps.length,
        reason: check.reason,
      });
      throw new ReconciliationBlockedByGapError(
        streamId,
        targetLedger,
        check.blockingGaps,
        check.reason
      );
    }
  }
}

export const reconciliationGate = new ReconciliationGate();
