import * as StellarSdk from "@stellar/stellar-sdk";
import { logInfo, logWarn, logError } from "../../config/logger";
import {
  gapQuarantineStore,
  GapQuarantineStore,
} from "./gapQuarantineStore";
import {
  contiguousCursorStore,
  ContiguousCursorStore,
} from "./contiguousCursorStore";
import {
  deduplicatingDispatcher,
  DeduplicatingDispatcher,
} from "./deduplicatingDispatcher";
import { eventNormalizer } from "./eventNormalizer";
import { CompletenessEvidence, QuarantinedGap } from "./gapTypes";

export interface GapRecoveryResult {
  streamId: string;
  totalGapsProcessed: number;
  resolvedGaps: string[];
  failedGaps: string[];
  totalEventsIngested: number;
  totalEventsDeduplicated: number;
  newContiguousLedger: number;
}

export interface GapRecoveryOptions {
  streamId: string;
  rpcUrl: string;
  contractIds?: string[];
  maxEventsPerPage?: number;
}

/**
 * Gap Recovery Pipeline (Issue #750 - Acceptance Criterion 3).
 * Recovers and backfills quarantined ledger gaps without duplicate side effects.
 */
export class GapRecoveryPipeline {
  private quarantineStore: GapQuarantineStore;
  private cursorStore: ContiguousCursorStore;
  private dispatcher: DeduplicatingDispatcher;

  constructor(
    quarantine: GapQuarantineStore = gapQuarantineStore,
    cursor: ContiguousCursorStore = contiguousCursorStore,
    dispatcher: DeduplicatingDispatcher = deduplicatingDispatcher
  ) {
    this.quarantineStore = quarantine;
    this.cursorStore = cursor;
    this.dispatcher = dispatcher;
  }

  /**
   * Scans for all active quarantined gaps for a stream and backfills them in sequence.
   */
  async backfillGaps(options: GapRecoveryOptions): Promise<GapRecoveryResult> {
    const { streamId, rpcUrl, contractIds, maxEventsPerPage = 100 } = options;
    const activeGaps = await this.quarantineStore.getActiveGaps(streamId);

    // Sort gaps by starting ledger to backfill in chronological order
    activeGaps.sort((a, b) => a.fromLedger - b.fromLedger);

    logInfo("[GapRecoveryPipeline] Starting gap recovery", {
      streamId,
      activeGapsCount: activeGaps.length,
      gaps: activeGaps.map((g) => `[${g.fromLedger}-${g.toLedger}]`),
    });

    const resolvedGaps: string[] = [];
    const failedGaps: string[] = [];
    let totalEventsIngested = 0;
    let totalEventsDeduplicated = 0;

    const server = new StellarSdk.SorobanRpc.Server(rpcUrl);

    for (const gap of activeGaps) {
      await this.quarantineStore.markGapReplaying(gap.gapId);

      try {
        logInfo("[GapRecoveryPipeline] Backfilling quarantined gap", {
          gapId: gap.gapId,
          fromLedger: gap.fromLedger,
          toLedger: gap.toLedger,
        });

        let currentStart = gap.fromLedger;
        let gapEvents: import("./eventNormalizer").NormalizedEvent[] = [];

        while (currentStart <= gap.toLedger) {
          const response = await server.getEvents({
            startLedger: currentStart,
            filters: [
              {
                type: "contract",
                ...(contractIds?.length ? { contractIds } : {}),
              },
            ],
            limit: maxEventsPerPage,
          });

          const rawEvents = (response.events || []).filter(
            (e) => Number(e.ledger) <= gap.toLedger
          );

          if (!rawEvents.length) {
            // No more events in this gap range; gap consisted of empty ledgers
            break;
          }

          const normalized = rawEvents.map((e) => eventNormalizer.normalizeSorobanEvent(e));
          gapEvents.push(...normalized);

          const maxObservedLedger = Math.max(...normalized.map((e) => e.ledger));
          currentStart = maxObservedLedger + 1;

          if (rawEvents.length < maxEventsPerPage) {
            // Reached boundary
            break;
          }
        }

        // Dispatch through DeduplicatingDispatcher (Zero duplicate side effects guarantee)
        const dispatchResult = await this.dispatcher.dispatch(gapEvents);
        totalEventsIngested += dispatchResult.dispatchedCount;
        totalEventsDeduplicated += dispatchResult.deduplicatedCount;

        // Resolve gap
        await this.quarantineStore.resolveGap(gap.gapId);
        resolvedGaps.push(gap.gapId);

        // Update contiguous cursor if the resolved gap connects to the current contiguous boundary
        const currentCursor = await this.cursorStore.get(streamId);
        const lastContiguous = currentCursor ? currentCursor.lastContiguousLedger : 0;

        if (gap.fromLedger <= lastContiguous + 1 && gap.toLedger > lastContiguous) {
          const evidence: CompletenessEvidence = {
            streamId,
            startLedger: gap.fromLedger,
            endLedger: gap.toLedger,
            totalEventsCount: gapEvents.length,
            isPageComplete: true,
            expectedBoundaryReached: true,
            observedLedgers: Array.from(new Set(gapEvents.map((e) => e.ledger))).sort((a, b) => a - b),
            evidenceHash: "backfilled-evidence",
            committedAt: new Date().toISOString(),
          };

          const lastEvent = gapEvents[gapEvents.length - 1];
          await this.cursorStore.advanceWithEvidence(
            streamId,
            gap.toLedger,
            evidence,
            lastEvent?.id,
            lastEvent?.ledgerClosedAt
          );
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logError("[GapRecoveryPipeline] Failed to backfill gap", err, { gapId: gap.gapId });
        await this.quarantineStore.markGapFailed(gap.gapId, errorMsg);
        failedGaps.push(gap.gapId);
      }
    }

    const finalCursor = await this.cursorStore.get(streamId);

    return {
      streamId,
      totalGapsProcessed: activeGaps.length,
      resolvedGaps,
      failedGaps,
      totalEventsIngested,
      totalEventsDeduplicated,
      newContiguousLedger: finalCursor ? finalCursor.lastContiguousLedger : 0,
    };
  }
}

export const gapRecoveryPipeline = new GapRecoveryPipeline();
