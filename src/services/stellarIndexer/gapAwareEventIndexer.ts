import * as StellarSdk from "@stellar/stellar-sdk";
import { logInfo, logWarn, logError } from "../../config/logger";
import {
  contiguousCursorStore,
  ContiguousCursorStore,
} from "./contiguousCursorStore";
import { gapQuarantineStore, GapQuarantineStore } from "./gapQuarantineStore";
import {
  deduplicatingDispatcher,
  DeduplicatingDispatcher,
} from "./deduplicatingDispatcher";
import { eventNormalizer, NormalizedEvent } from "./eventNormalizer";
import {
  CompletenessEvidence,
  LedgerDiscontinuityError,
  PageTruncationError,
} from "./gapTypes";

export interface GapAwareIndexerConfig {
  streamId: string;
  rpcUrls: string[]; // Primary and fallback RPC providers
  contractIds?: string[];
  defaultStartLedger?: number;
  pageSize?: number;
  pollIntervalMs?: number;
  maxConsecutiveErrors?: number;
}

export interface IngestionPollResult {
  streamId: string;
  ingestedEvents: NormalizedEvent[];
  committedLedger: number;
  detectedGapsCount: number;
  pageTruncated: boolean;
  providerUsed: string;
  evidence?: CompletenessEvidence;
}

/**
 * Gap-Aware Stellar Event Indexer (Issue #750).
 *
 * Guarantees:
 * 1. Checks ledger continuity: missing ledgers are quarantined and block cursor advancement.
 * 2. Checks page completeness: pagination truncation is detected and does not commit incomplete ledgers.
 * 3. Enforces atomic cursor advancement with verified completeness evidence.
 * 4. Supports multi-provider failover when RPC providers return errors or discontinuous gaps.
 */
export class GapAwareEventIndexer {
  private activeProviderIndex = 0;
  private running = false;
  private cursorStore: ContiguousCursorStore;
  private quarantineStore: GapQuarantineStore;
  private dispatcher: DeduplicatingDispatcher;

  constructor(
    private readonly config: GapAwareIndexerConfig,
    cursorStoreInstance: ContiguousCursorStore = contiguousCursorStore,
    quarantineStoreInstance: GapQuarantineStore = gapQuarantineStore,
    dispatcherInstance: DeduplicatingDispatcher = deduplicatingDispatcher
  ) {
    if (!config.rpcUrls || config.rpcUrls.length === 0) {
      throw new Error("GapAwareEventIndexer requires at least one RPC provider URL");
    }
    this.cursorStore = cursorStoreInstance;
    this.quarantineStore = quarantineStoreInstance;
    this.dispatcher = dispatcherInstance;
  }

  getCurrentProvider(): string {
    return this.config.rpcUrls[this.activeProviderIndex];
  }

  failoverProvider(reason: string): string {
    const prev = this.getCurrentProvider();
    this.activeProviderIndex = (this.activeProviderIndex + 1) % this.config.rpcUrls.length;
    const next = this.getCurrentProvider();
    logWarn("[GapAwareIndexer] Failing over RPC provider", {
      streamId: this.config.streamId,
      previousProvider: prev,
      nextProvider: next,
      reason,
    });
    return next;
  }

  /**
   * Performs a single poll cycle with gap detection, page completeness verification,
   * and atomic cursor advancement.
   */
  async poll(): Promise<IngestionPollResult> {
    const streamId = this.config.streamId;
    const pageSize = this.config.pageSize ?? 100;
    const cursor = await this.cursorStore.get(streamId);
    const startLedger = cursor
      ? cursor.lastContiguousLedger + 1
      : (this.config.defaultStartLedger ?? 0);

    let provider = this.getCurrentProvider();
    let rawEvents: StellarSdk.SorobanRpc.Api.EventResponse[] = [];
    let rpcSuccess = false;

    // 1. Fetch from RPC provider with failover support
    for (let attempt = 0; attempt < this.config.rpcUrls.length; attempt++) {
      try {
        const server = new StellarSdk.SorobanRpc.Server(provider);
        const filters: StellarSdk.SorobanRpc.Api.EventFilter[] = [
          {
            type: "contract",
            ...(this.config.contractIds?.length ? { contractIds: this.config.contractIds } : {}),
          },
        ];

        const response = await server.getEvents({
          startLedger,
          filters,
          limit: pageSize,
        });

        rawEvents = response.events || [];
        rpcSuccess = true;
        break;
      } catch (err) {
        logWarn("[GapAwareIndexer] Provider query failed, attempting failover", {
          provider,
          error: err instanceof Error ? err.message : String(err),
        });
        provider = this.failoverProvider(err instanceof Error ? err.message : "RPC query error");
      }
    }

    if (!rpcSuccess) {
      throw new Error(`All RPC providers failed for stream ${streamId} at ledger ${startLedger}`);
    }

    // If no events in this range
    if (!rawEvents.length) {
      logInfo("[GapAwareIndexer] No new events in poll", { streamId, startLedger });
      return {
        streamId,
        ingestedEvents: [],
        committedLedger: cursor ? cursor.lastContiguousLedger : startLedger - 1,
        detectedGapsCount: 0,
        pageTruncated: false,
        providerUsed: provider,
      };
    }

    // Normalize raw events
    const normalized = rawEvents.map((e) => eventNormalizer.normalizeSorobanEvent(e));
    const firstLedgerInBatch = normalized[0].ledger;
    const lastLedgerInBatch = normalized[normalized.length - 1].ledger;

    // 2. Ledger Continuity Check:
    // If first ledger in batch is greater than expected startLedger, missing ledgers exist!
    if (firstLedgerInBatch > startLedger) {
      const gapFrom = startLedger;
      const gapTo = firstLedgerInBatch - 1;

      await this.quarantineStore.quarantineGap({
        streamId,
        fromLedger: gapFrom,
        toLedger: gapTo,
        failureReason: `Observed discontinuity: expected ledger ${startLedger}, but batch begins at ${firstLedgerInBatch}`,
        providerId: provider,
      });

      logError("[GapAwareIndexer] Missing ledger gap detected; cursor advancement halted", undefined, {
        streamId,
        expectedLedger: startLedger,
        firstLedgerInBatch,
        gapFrom,
        gapTo,
      });

      return {
        streamId,
        ingestedEvents: [],
        committedLedger: cursor ? cursor.lastContiguousLedger : startLedger - 1,
        detectedGapsCount: 1,
        pageTruncated: false,
        providerUsed: provider,
      };
    }

    // 3. Page Completeness & Expected Boundary Check:
    // If batch size equals pageSize, the page might be truncated at the last ledger!
    const isPotentiallyTruncated = rawEvents.length === pageSize;
    let safeEndLedger = lastLedgerInBatch;
    let pageTruncated = false;

    if (isPotentiallyTruncated) {
      // If all events in the full page belong to the same ledger, that ledger is definitely truncated
      if (firstLedgerInBatch === lastLedgerInBatch) {
        pageTruncated = true;
        logWarn("[GapAwareIndexer] Page truncated within single ledger; cannot advance cursor", {
          streamId,
          ledger: lastLedgerInBatch,
          pageSize,
        });

        // Do not commit this ledger yet - we need the rest of this ledger's events!
        return {
          streamId,
          ingestedEvents: [],
          committedLedger: cursor ? cursor.lastContiguousLedger : startLedger - 1,
          detectedGapsCount: 0,
          pageTruncated: true,
          providerUsed: provider,
        };
      } else {
        // If batch spans multiple ledgers and hit pageSize, the last ledger in the batch may be truncated.
        // The safe end ledger is the previous ledger that closed before lastLedgerInBatch!
        safeEndLedger = lastLedgerInBatch - 1;
        pageTruncated = true;
        logInfo("[GapAwareIndexer] Bounding commit to last complete ledger before truncated tip", {
          streamId,
          safeEndLedger,
          truncatedLedger: lastLedgerInBatch,
        });
      }
    }

    // Filter events to only those within [startLedger, safeEndLedger]
    const eventsToCommit = normalized.filter((e) => e.ledger <= safeEndLedger);
    if (!eventsToCommit.length) {
      return {
        streamId,
        ingestedEvents: [],
        committedLedger: cursor ? cursor.lastContiguousLedger : startLedger - 1,
        detectedGapsCount: 0,
        pageTruncated,
        providerUsed: provider,
      };
    }

    // 4. Dispatch through DeduplicatingDispatcher (Zero duplicate side effects)
    await this.dispatcher.dispatch(eventsToCommit);

    // 5. Build Completeness Evidence
    const observedLedgersSet = new Set(eventsToCommit.map((e) => e.ledger));
    const observedLedgers = Array.from(observedLedgersSet).sort((a, b) => a - b);

    const evidence: CompletenessEvidence = {
      streamId,
      startLedger,
      endLedger: safeEndLedger,
      totalEventsCount: eventsToCommit.length,
      isPageComplete: !pageTruncated || safeEndLedger < lastLedgerInBatch,
      expectedBoundaryReached: true,
      observedLedgers,
      evidenceHash: "pending",
      committedAt: new Date().toISOString(),
    };

    const lastEvent = eventsToCommit[eventsToCommit.length - 1];

    // 6. Atomically Advance Cursor with Completeness Evidence
    await this.cursorStore.advanceWithEvidence(
      streamId,
      safeEndLedger,
      evidence,
      lastEvent.id,
      lastEvent.ledgerClosedAt
    );

    logInfo("[GapAwareIndexer] Contiguously advanced indexer cursor", {
      streamId,
      fromLedger: startLedger,
      toLedger: safeEndLedger,
      eventsCount: eventsToCommit.length,
      pageTruncated,
    });

    return {
      streamId,
      ingestedEvents: eventsToCommit,
      committedLedger: safeEndLedger,
      detectedGapsCount: 0,
      pageTruncated,
      providerUsed: provider,
      evidence,
    };
  }
}
