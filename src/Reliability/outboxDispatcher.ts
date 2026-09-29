import { DataSource } from "typeorm";
import { OutboxEvent, AggregateType } from "./outboxEvent.entity";
import { OutboxService, DispatchedEvent, EventHandler } from "./outbox.service";
import logger from "../config/logger";

// ── Aggregate ordering requirements ───────────────────────────────────────────

/**
 * Documents which aggregates require ordered delivery.
 *
 * - "transaction": YES — lifecycle events (created → submitted → confirmed)
 *   must arrive in order for the frontend to render correctly.
 * - "bot", "deployment", "agent": YES — status updates depend on ordering.
 * - "user", "contact", "contract", "audit", "generic": NO — ordering not
 *   required; parallel dispatch is safe.
 */
export const ORDERED_AGGREGATES: Set<AggregateType> = new Set([
  "transaction",
  "bot",
  "deployment",
  "agent",
]);

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Background outbox dispatcher.
 *
 * Polls the `outbox_event` table for pending rows, dispatches them to
 * registered handlers in sequence-number order, and marks them dispatched.
 * Handlers are invoked exactly once per eventId (consumers deduplicate by
 * stable event identity).
 *
 * Supports:
 * - Per-aggregate ordering (for transaction, bot, deployment, agent events)
 * - Idempotent consumers (deduplication by eventId)
 * - Exponential back-off retries with configurable max retries
 * - Retention controls (automatic cleanup of old dispatched events)
 */
export class OutboxDispatcher {
  private outboxService: OutboxService;
  private dataSource: DataSource;
  private intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private cleanupIntervalMs: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  /** Track which eventIds have been dispatched in this session for in-memory dedup. */
  private dispatchedIds = new Set<string>();

  constructor(
    dataSource: DataSource,
    options: { intervalMs?: number; cleanupIntervalMs?: number } = {}
  ) {
    this.dataSource = dataSource;
    this.outboxService = new OutboxService(dataSource);
    this.intervalMs = options.intervalMs ?? 2000;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 3_600_000; // 1 hour
  }

  // ── Handler registration ──────────────────────────────────────────────────

  /**
   * Register a handler for a specific event type.
   * Multiple handlers per event type are invoked in registration order.
   */
  on(eventType: string, handler: EventHandler): void {
    this.outboxService.on(eventType, handler);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Start the dispatcher loop. */
  start(): void {
    if (this.running) return;
    this.running = true;

    logger.info("OutboxDispatcher started", { intervalMs: this.intervalMs });

    // Dispatch loop
    this.timer = setInterval(async () => {
      if (!this.running) return;
      try {
        await this.poll();
      } catch (err) {
        logger.error("OutboxDispatcher poll error", { error: (err as Error).message });
      }
    }, this.intervalMs);

    // Cleanup loop (separate interval)
    this.cleanupTimer = setInterval(async () => {
      try {
        await this.outboxService.cleanup();
      } catch (err) {
        logger.error("OutboxDispatcher cleanup error", { error: (err as Error).message });
      }
    }, this.cleanupIntervalMs);

    // Run immediately
    this.poll().catch((err) => {
      logger.error("OutboxDispatcher initial poll error", { error: (err as Error).message });
    });
  }

  /** Stop the dispatcher loop. */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    logger.info("OutboxDispatcher stopped");
  }

  /** Get the underlying OutboxService (for testing / admin). */
  getService(): OutboxService {
    return this.outboxService;
  }

  /** Get dispatched event IDs (for testing). */
  getDispatchedIds(): Set<string> {
    return new Set(this.dispatchedIds);
  }

  // ── Core polling logic ────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    const now = new Date();

    // Fetch pending events ordered by aggregate for ordering guarantees
    const events = await this.dataSource
      .getRepository(OutboxEvent)
      .createQueryBuilder("e")
      .where("e.status = :status", { status: "pending" })
      .andWhere("(e.nextRetryAt IS NULL OR e.nextRetryAt <= :now)", { now })
      .orderBy("e.aggregateType", "ASC")
      .addOrderBy("e.createdAt", "ASC")
      .addOrderBy("e.sequence", "ASC")
      .take(100)
      .getMany();

    if (events.length === 0) return;

    logger.debug("OutboxDispatcher processing batch", { count: events.length });

    // Group by aggregate for ordering guarantees
    const orderedGroups = new Map<string, OutboxEvent[]>();
    const unorderedEvents: OutboxEvent[] = [];

    for (const event of events) {
      if (ORDERED_AGGREGATES.has(event.aggregateType as AggregateType)) {
        const key = `${event.aggregateType}:${event.aggregateId ?? "global"}`;
        const group = orderedGroups.get(key) ?? [];
        group.push(event);
        orderedGroups.set(key, group);
      } else {
        unorderedEvents.push(event);
      }
    }

    // Dispatch unordered events in parallel
    const unorderedPromises = unorderedEvents.map((e) => this.safeDispatch(e));

    // Dispatch ordered groups sequentially within each aggregate
    const orderedPromises: Promise<void>[] = [];
    for (const [, group] of orderedGroups) {
      // Sort by sequence within group
      group.sort((a, b) => a.sequence - b.sequence);
      orderedPromises.push(this.dispatchSequentially(group));
    }

    await Promise.all([...unorderedPromises, ...orderedPromises]);
  }

  private async dispatchSequentially(events: OutboxEvent[]): Promise<void> {
    for (const event of events) {
      await this.safeDispatch(event);
    }
  }

  private async safeDispatch(event: OutboxEvent): Promise<void> {
    // In-memory dedup within this session
    if (this.dispatchedIds.has(event.eventId)) {
      logger.debug("OutboxDispatcher skipping duplicate", { eventId: event.eventId });
      // Mark as dispatched to prevent future polls from picking it up
      await this.outboxService["markDispatched"](event);
      return;
    }

    try {
      // The OutboxService handles handler invocation and status updates
      await this.outboxService["dispatchEvent"](event);
      this.dispatchedIds.add(event.eventId);
    } catch (err) {
      logger.error("OutboxDispatcher dispatch failed", {
        eventId: event.eventId,
        error: (err as Error).message,
      });
      await this.outboxService["scheduleRetry"](event, err as Error);
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let dispatcherInstance: OutboxDispatcher | null = null;

export function initializeOutboxDispatcher(
  dataSource: DataSource,
  options?: { intervalMs?: number; cleanupIntervalMs?: number }
): OutboxDispatcher {
  if (dispatcherInstance) {
    logger.warn("OutboxDispatcher already initialized");
    return dispatcherInstance;
  }
  dispatcherInstance = new OutboxDispatcher(dataSource, options);
  return dispatcherInstance;
}

export function getOutboxDispatcher(): OutboxDispatcher {
  if (!dispatcherInstance) {
    throw new Error(
      "OutboxDispatcher not initialized. Call initializeOutboxDispatcher first."
    );
  }
  return dispatcherInstance;
}
