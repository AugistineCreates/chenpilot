import * as StellarSdk from "@stellar/stellar-sdk";
import { logInfo, logWarn, logError } from "../../config/logger";
import { cursorStore } from "./cursorStore";
import { eventNormalizer, NormalizedEvent } from "./eventNormalizer";
import { eventDispatcher } from "./eventDispatcher";

export interface IndexerConfig {
  /** Unique stream id – used as cursor key */
  streamId: string;
  /** Soroban RPC endpoint */
  rpcUrl: string;
  /** Contract ids to watch (empty = all) */
  contractIds?: string[];
  /** Ledger to start from when no cursor exists */
  defaultStartLedger?: number;
  /** Max events per RPC page */
  pageSize?: number;
  /** Polling interval in ms */
  pollIntervalMs?: number;
  /** Max consecutive RPC errors before backing off */
  maxConsecutiveErrors?: number;
}

const DEFAULT_POLL_MS = 5_000;
const DEFAULT_PAGE_SIZE = 100;
const MAX_ERRORS = 5;
const BACKOFF_MS = 30_000;

/**
 * Restart-safe, replay-safe Soroban event indexer.
 *
 * Safety guarantees:
 * - Cursor is only advanced AFTER events are dispatched, so a crash mid-batch
 *   causes the batch to be re-fetched on restart (at-least-once delivery).
 * - Downstream dispatcher is idempotent on event.id, so duplicate delivery
 *   is harmless.
 * - Replay is supported by resetting the cursor to any past ledger.
 */
export class StellarEventIndexer {
  private running = false;
  private consecutiveErrors = 0;
  private server!: StellarSdk.SorobanRpc.Server;

  constructor(private readonly config: IndexerConfig) {}

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.server = new StellarSdk.SorobanRpc.Server(this.config.rpcUrl);
    logInfo("[Indexer] starting", { streamId: this.config.streamId });
    await this.loop();
  }

  stop(): void {
    this.running = false;
    logInfo("[Indexer] stopped", { streamId: this.config.streamId });
  }

  // ─── Main poll loop ─────────────────────────────────────────────────────────

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.poll();
        this.consecutiveErrors = 0;
        await this.sleep(this.config.pollIntervalMs ?? DEFAULT_POLL_MS);
      } catch (err) {
        this.consecutiveErrors++;
        logError("[Indexer] poll error", err, {
          streamId: this.config.streamId,
          consecutiveErrors: this.consecutiveErrors,
        });

        if (this.consecutiveErrors >= (this.config.maxConsecutiveErrors ?? MAX_ERRORS)) {
          logWarn("[Indexer] backing off after repeated errors", {
            streamId: this.config.streamId,
            backoffMs: BACKOFF_MS,
          });
          await this.sleep(BACKOFF_MS);
          this.consecutiveErrors = 0;
        } else {
          await this.sleep(this.config.pollIntervalMs ?? DEFAULT_POLL_MS);
        }
      }
    }
  }

  // ─── Single poll tick ───────────────────────────────────────────────────────

  async poll(): Promise<NormalizedEvent[]> {
    const cursor = await cursorStore.get(this.config.streamId);
    const startLedger = cursor
      ? cursor.lastLedger + 1
      : (this.config.defaultStartLedger ?? 0);

    const filters: StellarSdk.SorobanRpc.Api.EventFilter[] = [
      {
        type: "contract",
        ...(this.config.contractIds?.length
          ? { contractIds: this.config.contractIds }
          : {}),
      },
    ];

    const response = await this.server.getEvents({
      startLedger,
      filters,
      limit: this.config.pageSize ?? DEFAULT_PAGE_SIZE,
    });

    if (!response.events.length) {
      logInfo("[Indexer] no new events", {
        streamId: this.config.streamId,
        startLedger,
      });
      return [];
    }

    const normalized = response.events.map((e) =>
      eventNormalizer.normalizeSorobanEvent(e)
    );

    // Dispatch BEFORE advancing cursor (at-least-once guarantee)
    await eventDispatcher.dispatch(normalized);

    // Advance cursor to the last ledger in this batch
    const lastEvent = normalized[normalized.length - 1];
    await cursorStore.advance(
      this.config.streamId,
      lastEvent.ledger,
      lastEvent.id,
      lastEvent.ledgerClosedAt
    );

    logInfo("[Indexer] indexed batch", {
      streamId: this.config.streamId,
      count: normalized.length,
      fromLedger: startLedger,
      toLedger: lastEvent.ledger,
    });

    return normalized;
  }

  // ─── Replay support ─────────────────────────────────────────────────────────

  /**
   * Reset the cursor to `fromLedger` so the next poll re-indexes from there.
   * The caller is responsible for clearing any downstream state if needed.
   */
  async replayFrom(fromLedger: number): Promise<void> {
    await cursorStore.reset(this.config.streamId, fromLedger - 1);
    logInfo("[Indexer] replay scheduled", {
      streamId: this.config.streamId,
      fromLedger,
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
