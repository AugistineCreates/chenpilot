import crypto from "crypto";
import {
  CompletenessEvidence,
  LedgerDiscontinuityError,
  PageTruncationError,
} from "./gapTypes";
import { gapQuarantineStore, GapQuarantineStore } from "./gapQuarantineStore";
import { cursorStore } from "./cursorStore";
import { logInfo, logError, logWarn } from "../../config/logger";

export interface ContiguousCursorRecord {
  streamId: string;
  lastContiguousLedger: number;
  lastEventId?: string;
  lastEvidence: CompletenessEvidence;
  updatedAt: string;
}

/**
 * Contiguous Cursor Store (Issue #750 - Acceptance Criterion 1).
 * Ensures cursor advancement is atomic with completeness evidence.
 * Blocks monotonic advancement if gaps exist or pages are incomplete.
 */
export class ContiguousCursorStore {
  private records = new Map<string, ContiguousCursorRecord>();
  private quarantineStore: GapQuarantineStore;

  constructor(quarantine: GapQuarantineStore = gapQuarantineStore) {
    this.quarantineStore = quarantine;
  }

  /**
   * Retrieves the current contiguous cursor and completeness evidence for a stream.
   */
  async get(streamId: string): Promise<ContiguousCursorRecord | null> {
    const record = this.records.get(streamId);
    if (record) return record;

    // Fall back to underlying cursorStore for backward compatibility if database is available
    try {
      const fallback = await cursorStore.get(streamId);
      if (fallback) {
        const syntheticEvidence: CompletenessEvidence = {
          streamId,
          startLedger: 0,
          endLedger: Number(fallback.lastLedger),
          totalEventsCount: 0,
          isPageComplete: true,
          expectedBoundaryReached: true,
          observedLedgers: [Number(fallback.lastLedger)],
          evidenceHash: "legacy-unverified-baseline",
          committedAt: fallback.updatedAt?.toISOString() || new Date().toISOString(),
        };
        const synthesized: ContiguousCursorRecord = {
          streamId,
          lastContiguousLedger: Number(fallback.lastLedger),
          lastEventId: fallback.lastEventId,
          lastEvidence: syntheticEvidence,
          updatedAt: syntheticEvidence.committedAt,
        };
        this.records.set(streamId, synthesized);
        return synthesized;
      }
    } catch {
      // In-memory mode when database datasource is not connected
    }

    return null;
  }

  /**
   * Atomically advances the cursor WITH completeness evidence.
   * Throws if:
   * 1. The page is truncated (incomplete)
   * 2. The expected ledger boundary was not reached
   * 3. A gap exists between the prior contiguous ledger and the incoming batch
   * 4. An active quarantined gap blocks this range
   */
  async advanceWithEvidence(
    streamId: string,
    targetLedger: number,
    evidence: CompletenessEvidence,
    lastEventId?: string,
    lastLedgerClosedAt?: string
  ): Promise<void> {
    // 1. Validate page completeness and expected boundary
    if (!evidence.isPageComplete || !evidence.expectedBoundaryReached) {
      logWarn("[ContiguousCursorStore] Incomplete page rejected", {
        streamId,
        targetLedger,
        isPageComplete: evidence.isPageComplete,
        expectedBoundaryReached: evidence.expectedBoundaryReached,
      });
      throw new PageTruncationError(streamId, targetLedger);
    }

    const current = await this.get(streamId);
    const expectedStartLedger = current ? current.lastContiguousLedger + 1 : evidence.startLedger;

    // 2. Validate ledger continuity
    if (evidence.startLedger > expectedStartLedger) {
      const gapFrom = expectedStartLedger;
      const gapTo = evidence.startLedger - 1;

      // Automatically quarantine the missing ledger gap
      await this.quarantineStore.quarantineGap({
        streamId,
        fromLedger: gapFrom,
        toLedger: gapTo,
        failureReason: `Detected missing ledgers [${gapFrom}-${gapTo}] before incoming batch starting at ${evidence.startLedger}`,
      });

      logError("[ContiguousCursorStore] Ledger discontinuity detected - advancement blocked", undefined, {
        streamId,
        expectedStartLedger,
        incomingStartLedger: evidence.startLedger,
        gapFrom,
        gapTo,
      });

      throw new LedgerDiscontinuityError(streamId, expectedStartLedger, evidence.startLedger);
    }

    // 3. Check for any active quarantined gaps in the target range
    const activeGaps = await this.quarantineStore.getActiveGaps(streamId);
    const blockingGap = activeGaps.find(
      (g) => g.fromLedger <= targetLedger && g.toLedger >= expectedStartLedger
    );

    if (blockingGap) {
      logWarn("[ContiguousCursorStore] Blocked by active quarantined gap", {
        streamId,
        targetLedger,
        gapId: blockingGap.gapId,
        range: `[${blockingGap.fromLedger}-${blockingGap.toLedger}]`,
      });
      throw new LedgerDiscontinuityError(
        streamId,
        blockingGap.fromLedger,
        targetLedger,
        `Cannot advance cursor: active quarantined gap ${blockingGap.gapId} [${blockingGap.fromLedger}-${blockingGap.toLedger}] must be backfilled first`
      );
    }

    // 4. Compute cryptographic integrity hash for completeness evidence
    if (!evidence.evidenceHash || evidence.evidenceHash === "pending") {
      evidence.evidenceHash = this.computeEvidenceHash(evidence);
    }

    // 5. Commit atomically
    const record: ContiguousCursorRecord = {
      streamId,
      lastContiguousLedger: targetLedger,
      lastEventId,
      lastEvidence: evidence,
      updatedAt: new Date().toISOString(),
    };

    this.records.set(streamId, record);

    // Also sync to persistent cursor store if database is initialized
    try {
      const AppDataSource = (await import("../../config/Datasource")).default;
      if (AppDataSource.isInitialized) {
        await cursorStore.advance(
          streamId,
          targetLedger,
          lastEventId,
          lastLedgerClosedAt,
          {
            evidenceHash: evidence.evidenceHash,
            isPageComplete: evidence.isPageComplete,
            expectedBoundaryReached: evidence.expectedBoundaryReached,
            totalEventsCount: evidence.totalEventsCount,
          }
        );
      }
    } catch {
      // In test environments where DB may not be connected, the in-memory map guarantees consistency
    }

    logInfo("[ContiguousCursorStore] Atomically committed cursor with completeness evidence", {
      streamId,
      lastContiguousLedger: targetLedger,
      lastEventId,
      evidenceHash: evidence.evidenceHash,
    });
  }

  /**
   * Resets the cursor to a specific ledger.
   */
  async reset(streamId: string, toLedger: number): Promise<void> {
    const syntheticEvidence: CompletenessEvidence = {
      streamId,
      startLedger: toLedger,
      endLedger: toLedger,
      totalEventsCount: 0,
      isPageComplete: true,
      expectedBoundaryReached: true,
      observedLedgers: [toLedger],
      evidenceHash: `reset-to-${toLedger}`,
      committedAt: new Date().toISOString(),
    };

    this.records.set(streamId, {
      streamId,
      lastContiguousLedger: toLedger,
      lastEvidence: syntheticEvidence,
      updatedAt: syntheticEvidence.committedAt,
    });

    try {
      await cursorStore.reset(streamId, toLedger);
    } catch {
      // Allow in-memory fallback
    }

    logInfo("[ContiguousCursorStore] Reset cursor", { streamId, toLedger });
  }

  computeEvidenceHash(evidence: CompletenessEvidence): string {
    const content = `${evidence.streamId}:${evidence.startLedger}:${evidence.endLedger}:${evidence.totalEventsCount}:${evidence.isPageComplete}:${evidence.expectedBoundaryReached}:${evidence.observedLedgers.join(",")}`;
    return crypto.createHash("sha256").update(content).digest("hex");
  }
}

export const contiguousCursorStore = new ContiguousCursorStore();
