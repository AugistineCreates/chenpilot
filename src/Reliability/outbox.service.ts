import { DataSource, Repository } from "typeorm";
import { OutboxEvent, type OutboxEventStatus, type AggregateType } from "./outboxEvent.entity";
import logger from "../config/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PublishOptions {
  /** Stable event identity for consumer deduplication (auto-generated if omitted). */
  eventId?: string;
  /** Dot-separated event type, e.g. "transaction.created" */
  eventType: string;
  /** Aggregate category for per-aggregate ordering */
  aggregateType: AggregateType;
  /** ID of the related aggregate (nullable for global events) */
  aggregateId?: string;
  /** The event payload */
  payload: Record<string, unknown>;
  /** Optional correlation / tracing metadata */
  metadata?: Record<string, unknown>;
  /** Maximum retries before giving up (default 5) */
  maxRetries?: number;
}

export interface DispatchedEvent {
  id: string;
  eventId: string;
  eventType: string;
  aggregateType: AggregateType;
  aggregateId: string | null;
  sequence: number;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export type EventHandler = (event: DispatchedEvent) => Promise<void>;

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Transactional Outbox service.
 *
 * Provides two core capabilities:
 *
 * 1. `publish()` — inserts an outbox record.  The caller MUST pass a
 *    `QueryRunner` or `EntityManager` that is part of the same DB transaction
 *    that performs the business state change, guaranteeing atomicity.
 *
 * 2. `dispatch()` / `dispatchOnce()` — polls pending records, invokes
 *    registered handlers, and marks them dispatched (or schedules retries).
 *    Consumers deduplicate by the stable `eventId`.
 */
export class OutboxService {
  private dataSource: DataSource;
  private handlers: Map<string, EventHandler[]> = new Map();

  constructor(dataSource: DataSource) {
    this.dataSource = dataSource;
  }

  /** Get the underlying TypeORM repository. */
  private get repo(): Repository<OutboxEvent> {
    return this.dataSource.getRepository(OutboxEvent);
  }

  // ── Publishing ────────────────────────────────────────────────────────────

  /**
   * Publish an outbox event **within an existing transaction**.
   *
   * The caller is responsible for ensuring this call is made inside the same
   * DB transaction that performs the business state change.
   *
   * Example:
   * ```ts
   * await AppDataSource.transaction(async (manager) => {
   *   await manager.save(user);
   *   await outboxService.publishWithManager(manager, {
   *     eventType: "user.created",
   *     aggregateType: "user",
   *     aggregateId: user.id,
   *     payload: { userId: user.id, email: user.email },
   *   });
   * });
   * ```
   */
  async publishWithManager(
    manager: { save: (entity: OutboxEvent) => Promise<OutboxEvent> },
    options: PublishOptions
  ): Promise<OutboxEvent> {
    const { generateStableEventId } = await import("./eventIdentity");

    const eventId = options.eventId ?? generateStableEventId();
    const sequence = await this.nextSequence(
      options.aggregateType,
      options.aggregateId ?? null
    );

    const record = this.repo.create({
      eventId,
      eventType: options.eventType,
      aggregateType: options.aggregateType,
      aggregateId: options.aggregateId ?? null,
      sequence,
      payload: options.payload,
      metadata: options.metadata ?? null,
      status: "pending" as OutboxEventStatus,
      retryCount: 0,
      maxRetries: options.maxRetries ?? 5,
      nextRetryAt: null,
      dispatchedAt: null,
      errorMessage: null,
    });

    const saved = await manager.save(record);
    logger.debug("Outbox event published", {
      eventId,
      eventType: options.eventType,
      aggregateType: options.aggregateType,
      aggregateId: options.aggregateId,
      sequence,
    });
    return saved;
  }

  /**
   * Convenience: publish outside of an explicit transaction (auto-wraps in one).
   *
   * Use this only when the outbox write is the **only** DB operation in the
   * transaction (e.g. a standalone event with no accompanying state change).
   */
  async publish(options: PublishOptions): Promise<OutboxEvent> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(OutboxEvent);
      const { generateStableEventId } = await import("./eventIdentity");

      const eventId = options.eventId ?? generateStableEventId();
      const sequence = await this.nextSequenceWithManager(
        manager,
        options.aggregateType,
        options.aggregateId ?? null
      );

      const record = repo.create({
        eventId,
        eventType: options.eventType,
        aggregateType: options.aggregateType,
        aggregateId: options.aggregateId ?? null,
        sequence,
        payload: options.payload,
        metadata: options.metadata ?? null,
        status: "pending" as OutboxEventStatus,
        retryCount: 0,
        maxRetries: options.maxRetries ?? 5,
        nextRetryAt: null,
        dispatchedAt: null,
        errorMessage: null,
      });

      return repo.save(record);
    });
  }

  // ── Sequence generation ───────────────────────────────────────────────────

  /** Get next sequence number for an aggregate (non-transactional). */
  private async nextSequence(
    aggregateType: AggregateType,
    aggregateId: string | null
  ): Promise<number> {
    const result = await this.repo
      .createQueryBuilder("e")
      .select("COALESCE(MAX(e.sequence), 0)", "maxSeq")
      .where("e.aggregateType = :aggregateType", { aggregateType })
      .andWhere(
        aggregateId ? "e.aggregateId = :aggregateId" : "e.aggregateId IS NULL",
        { aggregateId }
      )
      .getRawOne<{ maxSeq: string }>();

    return Number(result?.maxSeq ?? 0) + 1;
  }

  /** Get next sequence number using a transactional entity manager. */
  private async nextSequenceWithManager(
    manager: any,
    aggregateType: AggregateType,
    aggregateId: string | null
  ): Promise<number> {
    const result = await manager
      .createQueryBuilder(OutboxEvent, "e")
      .select("COALESCE(MAX(e.sequence), 0)", "maxSeq")
      .where("e.aggregateType = :aggregateType", { aggregateType })
      .andWhere(
        aggregateId ? "e.aggregateId = :aggregateId" : "e.aggregateId IS NULL",
        { aggregateId }
      )
      .getRawOne<{ maxSeq: string }>();

    return Number(result?.maxSeq ?? 0) + 1;
  }

  // ── Handler registration ──────────────────────────────────────────────────

  /**
   * Register an event handler for one or more event types.
   * Multiple handlers per event type are supported and invoked in order.
   */
  on(eventType: string, handler: EventHandler): void {
    const list = this.handlers.get(eventType) ?? [];
    list.push(handler);
    this.handlers.set(eventType, list);
  }

  // ── Dispatching ───────────────────────────────────────────────────────────

  /**
   * Fetch a batch of pending outbox events, dispatch them, and update status.
   *
   * Returns the number of successfully dispatched events.
   */
  async dispatchOnce(batchSize = 50): Promise<number> {
    const now = new Date();

    // Select pending events ready for (re)dispatch, ordered by sequence for
    // per-aggregate ordering guarantees.
    const events = await this.repo
      .createQueryBuilder("e")
      .where("e.status = :status", { status: "pending" })
      .andWhere("(e.nextRetryAt IS NULL OR e.nextRetryAt <= :now)", { now })
      .orderBy("e.createdAt", "ASC")
      .addOrderBy("e.sequence", "ASC")
      .take(batchSize)
      .getMany();

    let dispatched = 0;

    for (const event of events) {
      try {
        await this.dispatchEvent(event);
        dispatched++;
      } catch (err) {
        logger.error("Outbox dispatch failed", {
          eventId: event.eventId,
          eventType: event.eventType,
          error: (err as Error).message,
        });
      }
    }

    return dispatched;
  }

  /** Run the dispatcher continuously at a given interval (milliseconds). */
  startDispatcher(intervalMs = 2000): NodeJS.Timeout {
    const loop = async () => {
      try {
        await this.dispatchOnce();
      } catch (err) {
        logger.error("Outbox dispatcher loop error", { error: (err as Error).message });
      }
    };

    // Run immediately, then on interval
    loop();
    return setInterval(loop, intervalMs);
  }

  private async dispatchEvent(event: OutboxEvent): Promise<void> {
    const handlers = this.handlers.get(event.eventType) ?? [];
    if (handlers.length === 0) {
      // No handlers registered — mark as dispatched (orphaned event).
      await this.markDispatched(event);
      return;
    }

    const dispatchEvent: DispatchedEvent = {
      id: event.id,
      eventId: event.eventId,
      eventType: event.eventType,
      aggregateType: event.aggregateType as AggregateType,
      aggregateId: event.aggregateId,
      sequence: event.sequence,
      payload: event.payload,
      metadata: event.metadata,
      createdAt: event.createdAt,
    };

    for (const handler of handlers) {
      await handler(dispatchEvent);
    }

    await this.markDispatched(event);
  }

  private async markDispatched(event: OutboxEvent): Promise<void> {
    await this.repo.update(event.id, {
      status: "dispatched",
      dispatchedAt: new Date(),
      errorMessage: null,
    });
  }

  private async scheduleRetry(event: OutboxEvent, error: Error): Promise<void> {
    const retryCount = event.retryCount + 1;

    if (retryCount >= event.maxRetries) {
      await this.repo.update(event.id, {
        status: "failed",
        retryCount,
        errorMessage: error.message,
      });
      logger.warn("Outbox event permanently failed", {
        eventId: event.eventId,
        eventType: event.eventType,
        retryCount,
      });
      return;
    }

    // Exponential back-off: 1s, 2s, 4s, 8s, 16s …
    const delayMs = Math.min(1000 * Math.pow(2, retryCount), 60_000);
    const nextRetryAt = new Date(Date.now() + delayMs);

    await this.repo.update(event.id, {
      status: "pending",
      retryCount,
      nextRetryAt,
      errorMessage: error.message,
    });

    logger.info("Outbox event retry scheduled", {
      eventId: event.eventId,
      eventType: event.eventType,
      retryCount,
      nextRetryAt,
    });
  }

  // ── Retention / cleanup ───────────────────────────────────────────────────

  /**
   * Delete dispatched events older than `maxAgeMs` (default 7 days).
   * Call periodically to control table growth.
   */
  async cleanup(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .where("status = :status", { status: "dispatched" })
      .andWhere("dispatchedAt < :cutoff", { cutoff })
      .execute();

    const deleted = result.affected ?? 0;
    if (deleted > 0) {
      logger.info("Outbox cleanup completed", { deleted, cutoff });
    }
    return deleted;
  }

  // ── Querying (for tests / admin) ──────────────────────────────────────────

  /** Get all pending events (for testing / admin UI). */
  async getPending(): Promise<OutboxEvent[]> {
    return this.repo.find({
      where: { status: "pending" },
      order: { createdAt: "ASC" },
    });
  }

  /** Get a single event by its stable eventId. */
  async getByEventId(eventId: string): Promise<OutboxEvent | null> {
    return this.repo.findOne({ where: { eventId } });
  }

  /** Get failed events (for inspection / manual retry). */
  async getFailed(): Promise<OutboxEvent[]> {
    return this.repo.find({
      where: { status: "failed" },
      order: { createdAt: "ASC" },
    });
  }

  /**
   * Manually retry a failed event by resetting it to pending.
   */
  async retryFailed(eventId: string): Promise<boolean> {
    const event = await this.repo.findOne({ where: { eventId } });
    if (!event || event.status !== "failed") return false;

    await this.repo.update(event.id, {
      status: "pending",
      retryCount: 0,
      nextRetryAt: null,
      errorMessage: null,
    });
    return true;
  }
}
