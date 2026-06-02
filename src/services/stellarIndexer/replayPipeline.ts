import { logInfo, logError } from "../../config/logger";
import { StellarEventIndexer, IndexerConfig } from "./stellarEventIndexer";
import { cursorStore } from "./cursorStore";
import { NormalizedEvent } from "./eventNormalizer";

export interface ReplayOptions {
  /** Ledger to start replay from (inclusive) */
  fromLedger: number;
  /** Ledger to stop at (inclusive).  Omit to replay to the current tip. */
  toLedger?: number;
  /** Override the page size for replay (larger batches are fine offline) */
  pageSize?: number;
}

export interface ReplayResult {
  streamId: string;
  fromLedger: number;
  toLedger: number;
  totalEvents: number;
  durationMs: number;
}

/**
 * Replay pipeline.
 *
 * Orchestrates a bounded re-index of historical ledgers by:
 * 1. Resetting the cursor to `fromLedger - 1`
 * 2. Polling in a tight loop until `toLedger` is reached
 * 3. Restoring the cursor to the pre-replay position on failure
 *
 * The underlying indexer's at-least-once + idempotent dispatch guarantees
 * mean replaying an already-indexed range is safe.
 */
export class ReplayPipeline {
  constructor(private readonly baseConfig: IndexerConfig) {}

  async replay(options: ReplayOptions): Promise<ReplayResult> {
    const { fromLedger, pageSize = 200 } = options;
    const startMs = Date.now();

    // Snapshot current cursor so we can restore on failure
    const priorCursor = await cursorStore.get(this.baseConfig.streamId);
    const priorLedger = priorCursor?.lastLedger ?? fromLedger - 1;

    logInfo("[Replay] starting", {
      streamId: this.baseConfig.streamId,
      fromLedger,
      toLedger: options.toLedger ?? "tip",
    });

    // Build a one-shot indexer with replay-specific settings
    const replayConfig: IndexerConfig = {
      ...this.baseConfig,
      streamId: this.baseConfig.streamId,
      pageSize,
      pollIntervalMs: 0, // no sleep between pages during replay
    };

    const indexer = new StellarEventIndexer(replayConfig);

    // Reset cursor to one ledger before the replay start
    await cursorStore.reset(this.baseConfig.streamId, fromLedger - 1);

    let totalEvents = 0;
    let lastLedger = fromLedger - 1;

    try {
      while (true) {
        const batch: NormalizedEvent[] = await indexer.poll();

        if (!batch.length) {
          // No more events – we've reached the tip or the target ledger
          break;
        }

        totalEvents += batch.length;
        lastLedger = batch[batch.length - 1].ledger;

        logInfo("[Replay] batch processed", {
          streamId: this.baseConfig.streamId,
          batchSize: batch.length,
          lastLedger,
        });

        if (options.toLedger !== undefined && lastLedger >= options.toLedger) {
          break;
        }
      }
    } catch (err) {
      logError("[Replay] failed, restoring prior cursor", err, {
        streamId: this.baseConfig.streamId,
        priorLedger,
      });
      // Restore cursor so live indexing resumes from where it was
      await cursorStore.reset(this.baseConfig.streamId, priorLedger);
      throw err;
    }

    const result: ReplayResult = {
      streamId: this.baseConfig.streamId,
      fromLedger,
      toLedger: lastLedger,
      totalEvents,
      durationMs: Date.now() - startMs,
    };

    logInfo("[Replay] complete", result);
    return result;
  }
}
