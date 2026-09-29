import { logInfo, logError, logWarn } from "../../config/logger";
import { StellarEventIndexer, IndexerConfig } from "./stellarEventIndexer";
import { cursorStore } from "./cursorStore";
import { NormalizedEvent } from "./eventNormalizer";
import { getObservabilityContext } from "../../observability";

export interface ReplayOptions {
  fromLedger: number;
  toLedger?: number;
  pageSize?: number;
}

export interface IndexingPipelineOptions {
  streamId: string;
  pageSize?: number;
  pollIntervalMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface IndexingCheckpoint {
  streamId: string;
  lastLedger: number;
  lastEventId?: string;
  startedAt: string;
  updatedAt: string;
}

/**
 * Resilient event indexing and replay pipeline.
 *
 * Features:
 *  - Restart-safe cursor tracking via durable cursorStore
 *  - Replay-safe bounded re-index with automatic cursor restore on failure
 *  - Normalizes Stellar/Soroban events into a unified schema
 *  - Retries transient failures with backoff
 *  - Integration with observability context for tracing
 */
export class ResilientIndexerPipeline {
  private readonly streamId: string;
  private readonly pageSize: number;
  private readonly pollIntervalMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private running = false;

  constructor(options: IndexingPipelineOptions) {
    this.streamId = options.streamId;
    this.pageSize = options.pageSize ?? 200;
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
  }

  /**
   * Start live indexing loop. Blocking until stop() is called.
   */
  async start(baseConfig: Omit<IndexerConfig, "streamId" | "pageSize" | "pollIntervalMs">): Promise<void> {
    if (this.running) {
      logWarn("[IndexerPipeline] already running", { streamId: this.streamId });
      return;
    }

    this.running = true;
    logInfo("[IndexerPipeline] starting", { streamId: this.streamId });

    const config: IndexerConfig = {
      ...baseConfig,
      streamId: this.streamId,
      pageSize: this.pageSize,
      pollIntervalMs: this.pollIntervalMs,
    };

    const indexer = new StellarEventIndexer(config);

    // Restore cursor from durable store
    const prior = await cursorStore.get(this.streamId);
    const startLedger = prior?.lastLedger ?? 0;
    logInfo("[IndexerPipeline] cursor restored", { streamId: this.streamId, startLedger });

    while (this.running) {
      try {
        const batch = await this.pollWithRetry(indexer);
        if (!batch.length) {
          await this.sleep(this.pollIntervalMs);
          continue;
        }

        await this.dispatchAndAdvance(batch);
      } catch (err) {
        logError("[IndexerPipeline] iteration failed", err, { streamId: this.streamId });
        await this.sleep(this.retryDelayMs);
      }
    }

    logInfo("[IndexerPipeline] stopped", { streamId: this.streamId });
  }

  /**
   * Stop live indexing gracefully.
   */
  stop(): void {
    this.running = false;
    logInfo("[IndexerPipeline] stop requested", { streamId: this.streamId });
  }

  /**
   * Replay historical ledgers and emit normalized events.
   */
  async replay(options: ReplayOptions, baseConfig: Omit<IndexerConfig, "streamId" | "pageSize" | "pollIntervalMs">): Promise<{
    totalEvents: number;
    fromLedger: number;
    toLedger: number;
  }> {
    const { fromLedger, pageSize = this.pageSize } = options;
    const context = getObservabilityContext();
    const correlationId = context?.requestId || `replay-${Date.now()}`;

    logInfo("[Replay] starting", { streamId: this.streamId, fromLedger, toLedger: options.toLedger ?? "tip", correlationId });

    const prior = await cursorStore.get(this.streamId);
    const priorLedger = prior?.lastLedger ?? fromLedger - 1;

    const replayConfig: IndexerConfig = {
      ...baseConfig,
      streamId: this.streamId,
      pageSize,
      pollIntervalMs: 0,
    };

    const indexer = new StellarEventIndexer(replayConfig);
    await cursorStore.reset(this.streamId, fromLedger - 1);

    let totalEvents = 0;
    let lastLedger = fromLedger - 1;

    try {
      while (true) {
        const batch = await indexer.poll();
        if (!batch.length) break;

        totalEvents += batch.length;
        lastLedger = batch[batch.length - 1].ledger;

        await this.dispatchAndAdvance(batch);

        if (options.toLedger !== undefined && lastLedger >= options.toLedger) {
          break;
        }
      }
    } catch (err) {
      logError("[Replay] failed, restoring cursor", err, { streamId: this.streamId, priorLedger });
      await cursorStore.reset(this.streamId, priorLedger);
      throw err;
    }

    const result = { totalEvents, fromLedger, toLedger: lastLedger };
    logInfo("[Replay] complete", { ...result, correlationId });
    return result;
  }

  /**
   * Dispatch normalized events to downstream handlers and advance cursor.
   */
  private async dispatchAndAdvance(batch: NormalizedEvent[]): Promise<void> {
    const last = batch[batch.length - 1];

    for (const event of batch) {
      try {
        await this.dispatch(event);
      } catch (err) {
        logError("[IndexerPipeline] dispatch failed", err, { eventId: event.id });
      }
    }

    await cursorStore.advance(
      this.streamId,
      last.ledger,
      last.id,
      last.ledgerClosedAt ?? new Date().toISOString(),
      { batchSize: batch.length }
    );

    logInfo("[IndexerPipeline] advanced cursor", {
      streamId: this.streamId,
      lastLedger: last.ledger,
      lastEventId: last.id,
    });
  }

  /**
   * Dispatch a single normalized event to downstream consumers.
   */
  private async dispatch(event: NormalizedEvent): Promise<void> {
    logInfo("[IndexerPipeline] event", { streamId: this.streamId, eventId: event.id, type: event.type });
  }

  /**
   * Poll with bounded retry for transient failures.
   */
  private async pollWithRetry(indexer: StellarEventIndexer): Promise<NormalizedEvent[]> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await indexer.poll();
      } catch (err) {
        lastError = err;
        logWarn("[IndexerPipeline] poll attempt failed", {
          streamId: this.streamId,
          attempt,
          maxRetries: this.maxRetries,
          error: err instanceof Error ? err.message : String(err),
        });
        await this.sleep(this.retryDelayMs * attempt);
      }
    }
    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const resilientIndexerPipeline = new ResilientIndexerPipeline({
  streamId: "default",
  pageSize: 200,
  pollIntervalMs: 5000,
});