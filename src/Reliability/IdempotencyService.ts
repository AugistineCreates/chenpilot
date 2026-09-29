import { AppDataSource } from "../config/Datasource";
import { DurableOperation, OperationStatus } from "./DurableOperation.entity";
import { WebhookIdempotency } from "../Gateway/webhookIdempotency.entity";
import logger from "../config/logger";
import { Repository, MoreThanOrEqual, LessThanOrEqual, IsNull } from "typeorm";
import crypto from "crypto";

/**
 * IdempotencyService
 *
 * Unified idempotency and replay-safe durable execution layer.
 *
 * Replaces:
 *   - src/Gateway/webhookIdempotency.service.ts (webhook-specific dedup)
 *   - src/Reliability/DurableOperationService.ts execute(idempotentKey) path
 *
 * Usage patterns:
 *   - HTTP/webhook inbound:   isDuplicate(eventId) / markProcessed(eventId, ...)
 *   - Async workflows/queues: execute({ idempotentKey, category, payload })
 *   - Delayed/replay jobs:    schedule({ idempotentKey, category, payload, scheduledAt, conditions })
 *   - Recovery on restart:    recoverInterruptedExecutions(handlerRegistry)
 */

export type IdempotentHandler<T = unknown> = (payload: unknown) => Promise<T>;

interface ExecuteOptions {
  category: string;
  idempotentKey: string;
  payload: unknown;
  maxRetries?: number;
  scheduledAt?: Date;
  conditions?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface IngestOptions {
  source: string;
  eventId: string;
  signature?: string;
  timestamp?: string;
  payload: unknown;
  deduplicationWindowMs?: number;
  metadata?: Record<string, unknown>;
}

export class IdempotencyService {
  private readonly operationsRepo: Repository<DurableOperation>;
  private readonly webhookRepo: Repository<WebhookIdempotency>;
  private readonly handlers = new Map<string, IdempotentHandler<unknown>>();
  private isProcessing = false;
  private readonly DEFAULT_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

  constructor() {
    this.operationsRepo = AppDataSource.getRepository(DurableOperation);
    this.webhookRepo = AppDataSource.getRepository(WebhookIdempotency);
  }

  // ── Handler Registry ─────────────────────────────────────────────────────────

  registerHandler(category: string, handler: IdempotentHandler<unknown>): void {
    this.handlers.set(category, handler);
    logger.info(`IdempotencyService: registered handler for category=${category}`);
  }

  // ── Public API: Webhook / Event Ingestion ────────────────────────────────────

  async isDuplicate(eventId: string, source: string, windowMs = this.DEFAULT_DEDUP_WINDOW_MS): Promise<boolean> {
    const since = new Date(Date.now() - windowMs);
    const existing = await this.webhookRepo.findOne({
      where: {
        webhookId: eventId,
        platform: source,
        createdAt: MoreThanOrEqual(since),
      },
    });

    return !!existing;
  }

  async markProcessed(
    eventId: string,
    source: string,
    options: { payloadHash?: string; metadata?: Record<string, unknown> } = {}
  ): Promise<void> {
    const record = this.webhookRepo.create({
      webhookId: eventId,
      platform: source,
      metadata: {
        payloadHash: options.payloadHash,
        ...options.metadata,
      },
    });

    await this.webhookRepo.save(record);
  }

  async ingestSignedEvent(options: IngestOptions): Promise<{ isNew: boolean; eventId: string }> {
    const payloadHash = crypto.createHash("sha256").update(JSON.stringify(options.payload)).digest("hex");

    const existing = await this.webhookRepo.findOne({
      where: {
        webhookId: options.eventId,
        platform: options.source,
      },
    });

    if (existing) {
      const existingHash = (existing.metadata as Record<string, unknown> | undefined)?.payloadHash;
      if (existingHash === payloadHash) {
        return { isNew: false, eventId: options.eventId };
      }

      // Same eventId but different payload => suspicious / possible replay attack
      logger.warn("IdempotencyService: eventId reused with different payload", {
        source: options.source,
        eventId: options.eventId,
      });
    }

    await this.markProcessed(options.eventId, options.source, {
      payloadHash,
      metadata: {
        signature: options.signature,
        timestamp: options.timestamp,
        ...options.metadata,
      },
    });

    return { isNew: true, eventId: options.eventId };
  }

  // ── Public API: Durable / Async Workflows ────────────────────────────────────

  async execute<T = any>(options: ExecuteOptions): Promise<T | null> {
    const existing = await this.operationsRepo.findOne({
      where: { category: options.category, idempotentKey: options.idempotentKey },
    });

    if (existing) {
      if (existing.status === OperationStatus.COMPLETED) {
        return existing.result as T;
      }
      if (existing.status === OperationStatus.RUNNING || existing.status === OperationStatus.PENDING) {
        logger.info("IdempotencyService: duplicate execute ignored (already in progress)", {
          category: options.category,
          idempotentKey: options.idempotentKey,
          status: existing.status,
        });
        return null;
      }
    }

    const operation = this.operationsRepo.create({
      category: options.category,
      idempotentKey: options.idempotentKey,
      payload: options.payload,
      maxRetries: options.maxRetries ?? 3,
      scheduledAt: options.scheduledAt,
      conditions: options.conditions,
      status: OperationStatus.PENDING,
    });

    await this.operationsRepo.save(operation);

    if (!options.scheduledAt) {
      this.runOperation(operation.id).catch((err) => {
        logger.error(`IdempotencyService: runOperation failed for ${operation.id}`, { error: err });
      });
    }

    return null;
  }

  async schedule(options: Omit<ExecuteOptions, "scheduledAt"> & { scheduledAt: Date }): Promise<string | null> {
    return this.execute({ ...options, scheduledAt: options.scheduledAt });
  }

  async replay(id: string): Promise<void> {
    const operation = await this.operationsRepo.findOne({ where: { id } });
    if (!operation) throw new Error("Operation not found");

    operation.status = OperationStatus.PENDING;
    operation.retries = 0;
    operation.errorMessage = undefined;
    operation.nextRetryAt = undefined;
    await this.operationsRepo.save(operation);

    return this.runOperation(id);
  }

  async recoverInterruptedExecutions(): Promise<void> {
    const pending = await this.operationsRepo.find({
      where: [
        { status: OperationStatus.PENDING, scheduledAt: LessThanOrEqual(new Date()) },
        { status: OperationStatus.PENDING, nextRetryAt: LessThanOrEqual(new Date()) },
        { status: OperationStatus.PENDING, scheduledAt: IsNull(), nextRetryAt: IsNull() },
      ],
      take: 100,
    });

    logger.info(`IdempotencyService: recovering ${pending.length} interrupted operations`);

    for (const op of pending) {
      this.runOperation(op.id).catch((err) => {
        logger.error(`IdempotencyService: recovery failed for ${op.id}`, { error: err });
      });
    }
  }

  // ── Internal Execution ───────────────────────────────────────────────────────

  private async runOperation(id: string): Promise<void> {
    const operation = await this.operationsRepo.findOne({ where: { id } });
    if (!operation || operation.status === OperationStatus.COMPLETED || operation.status === OperationStatus.RUNNING) {
      return;
    }

    const handler = this.handlers.get(operation.category);
    if (!handler) {
      logger.error(`IdempotencyService: no handler for category=${operation.category}`);
      return;
    }

    operation.status = OperationStatus.RUNNING;
    await this.operationsRepo.save(operation);

    try {
      const result = await handler(operation.payload);
      operation.status = OperationStatus.COMPLETED;
      operation.result = result;
      operation.completedAt = new Date();
      await this.operationsRepo.save(operation);
      logger.info(`IdempotencyService: completed operation=${id} category=${operation.category}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      operation.retries += 1;
      operation.errorMessage = errorMessage;

      if (operation.retries >= operation.maxRetries) {
        operation.status = OperationStatus.FAILED;
        logger.error(`IdempotencyService: operation=${id} failed permanently after ${operation.retries} attempts`);
      } else {
        operation.status = OperationStatus.PENDING;
        const delay = Math.pow(2, operation.retries) * 1000;
        operation.nextRetryAt = new Date(Date.now() + delay);
        logger.warn(`IdempotencyService: operation=${id} scheduled for retry in ${delay}ms`, { error: errorMessage });
      }

      await this.operationsRepo.save(operation);
    }
  }

  startBackgroundProcessor(intervalMs = 10000): void {
    if (this.isProcessing) return;
    this.isProcessing = true;

    setInterval(async () => {
      await this.processPendingOperations();
    }, intervalMs);
  }

  private async processPendingOperations(): Promise<void> {
    const now = new Date();
    const pending = await this.operationsRepo.find({
      where: [
        { status: OperationStatus.PENDING, scheduledAt: LessThanOrEqual(now) },
        { status: OperationStatus.PENDING, nextRetryAt: LessThanOrEqual(now) },
        { status: OperationStatus.PENDING, scheduledAt: IsNull(), nextRetryAt: IsNull() },
      ],
      take: 20,
    });

    for (const op of pending) {
      if (op.conditions) {
        const ready = await this.evaluateConditions(op.conditions);
        if (!ready) continue;
      }
      this.runOperation(op.id).catch((err) => {
        logger.error(`IdempotencyService: background processor failed for ${op.id}`, { error: err });
      });
    }
  }

  private async evaluateConditions(conditions: Record<string, unknown>): Promise<boolean> {
    if (conditions.strategy === "fee_based" || conditions.strategy === "congestion_based") {
      return true;
    }
    return true;
  }

  // ── Operator Query API ───────────────────────────────────────────────────────

  async getOperations(options: {
    status?: OperationStatus;
    category?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<[DurableOperation[], number]> {
    const { status, category, limit = 50, offset = 0 } = options;
    const qb = this.operationsRepo.createQueryBuilder("op");
    if (status) qb.andWhere("op.status = :status", { status });
    if (category) qb.andWhere("op.category = :category", { category });

    return qb.orderBy("op.updatedAt", "DESC").skip(offset).take(limit).getManyAndCount();
  }
}

export const idempotencyService = new IdempotencyService();