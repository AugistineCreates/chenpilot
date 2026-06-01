import { AppDataSource } from "../config/Datasource";
import { DurableOperation, OperationStatus } from "./DurableOperation.entity";
import logger from "../config/logger";
import { Repository, LessThanOrEqual, IsNull, Or } from "typeorm";

export type OperationHandler = (payload: any) => Promise<any>;

export class DurableOperationService {
  private repository: Repository<DurableOperation>;
  private handlers: Map<string, OperationHandler> = new Map();
  private isProcessing = false;

  constructor() {
    this.repository = AppDataSource.getRepository(DurableOperation);
  }

  /**
   * Register a handler for a specific category of operations
   */
  registerHandler(category: string, handler: OperationHandler): void {
    this.handlers.set(category, handler);
    logger.info(`Registered handler for durable operation category: ${category}`);
  }

  /**
   * Execute an operation with idempotency
   */
  async execute<T = any>(options: {
    category: string;
    idempotentKey?: string;
    payload: any;
    maxRetries?: number;
    scheduledAt?: Date;
    conditions?: Record<string, any>;
  }): Promise<T | null> {
    const { category, idempotentKey, payload, maxRetries, scheduledAt, conditions } = options;

    // Check for existing operation if idempotentKey is provided
    if (idempotentKey) {
      const existing = await this.repository.findOne({
        where: { category, idempotentKey },
      });

      if (existing) {
        if (existing.status === OperationStatus.COMPLETED) {
          return existing.result;
        }
        if (existing.status === OperationStatus.RUNNING || existing.status === OperationStatus.PENDING) {
          logger.info(`Operation ${idempotentKey} in category ${category} is already in progress/pending`);
          return null; // Or wait? For now, return null to signify "handled/in-progress"
        }
        // If failed, we might want to retry. For now, fall through to creation or handle failure.
      }
    }

    const operation = new DurableOperation();
    operation.category = category;
    operation.idempotentKey = idempotentKey;
    operation.payload = payload;
    operation.maxRetries = maxRetries ?? 3;
    operation.scheduledAt = scheduledAt;
    operation.conditions = conditions;
    operation.status = OperationStatus.PENDING;

    await this.repository.save(operation);

    // If not scheduled, try to run immediately (async)
    if (!scheduledAt) {
      this.runOperation(operation.id).catch(err => {
        logger.error(`Error running operation ${operation.id}`, { error: err });
      });
    }

    return null;
  }

  /**
   * Internal method to run a specific operation
   */
  private async runOperation(id: string): Promise<void> {
    const operation = await this.repository.findOne({ where: { id } });
    if (!operation || operation.status === OperationStatus.COMPLETED || operation.status === OperationStatus.RUNNING) {
      return;
    }

    const handler = this.handlers.get(operation.category);
    if (!handler) {
      logger.error(`No handler registered for category: ${operation.category}`);
      return;
    }

    operation.status = OperationStatus.RUNNING;
    await this.repository.save(operation);

    try {
      const result = await handler(operation.payload);
      operation.status = OperationStatus.COMPLETED;
      operation.result = result;
      operation.completedAt = new Date();
      await this.repository.save(operation);
      logger.info(`Successfully completed durable operation ${id}`, { category: operation.category });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      operation.retries++;
      operation.errorMessage = errorMessage;

      if (operation.retries >= operation.maxRetries) {
        operation.status = OperationStatus.FAILED;
        logger.error(`Durable operation ${id} failed after ${operation.retries} attempts`, { error: errorMessage });
      } else {
        operation.status = OperationStatus.PENDING;
        // Exponential backoff
        const delay = Math.pow(2, operation.retries) * 1000;
        operation.nextRetryAt = new Date(Date.now() + delay);
        logger.warn(`Durable operation ${id} failed, scheduled for retry in ${delay}ms`, { error: errorMessage });
      }
      await this.repository.save(operation);
    }
  }

  /**
   * Start background processing for pending/scheduled operations
   */
  startBackgroundProcessor(intervalMs = 10000): void {
    if (this.isProcessing) return;
    this.isProcessing = true;

    setInterval(async () => {
      await this.processPendingOperations();
    }, intervalMs);
  }

  private async processPendingOperations(): Promise<void> {
    const now = new Date();
    const pending = await this.repository.find({
      where: [
        { 
          status: OperationStatus.PENDING, 
          scheduledAt: LessThanOrEqual(now) 
        },
        { 
          status: OperationStatus.PENDING, 
          nextRetryAt: LessThanOrEqual(now) 
        },
        {
          status: OperationStatus.PENDING,
          scheduledAt: IsNull(),
          nextRetryAt: IsNull()
        }
      ],
      take: 10
    });

    for (const op of pending) {
      // Check conditions if any
      if (op.conditions) {
        const isReady = await this.evaluateConditions(op.conditions);
        if (!isReady) continue;
      }
      
      this.runOperation(op.id).catch(err => {
        logger.error(`Error in background processor for operation ${op.id}`, { error: err });
      });
    }
  }

  private async evaluateConditions(conditions: Record<string, any>): Promise<boolean> {
    // This can be expanded to check network fees, congestion, etc.
    if (conditions.strategy === "fee_based") {
      // Placeholder for actual fee check
      return true; 
    }
    if (conditions.strategy === "congestion_based") {
      return true;
    }
    return true; 
  }

  /**
   * Get all operations for operator visibility
   */
  async getAllOperations(options: { 
    status?: OperationStatus; 
    category?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<[DurableOperation[], number]> {
    const { status, category, limit = 50, offset = 0 } = options;
    const query = this.repository.createQueryBuilder("op");

    if (status) query.andWhere("op.status = :status", { status });
    if (category) query.andWhere("op.category = :category", { category });

    return query
      .orderBy("op.updatedAt", "DESC")
      .skip(offset)
      .take(limit)
      .getManyAndCount();
  }

  /**
   * Manual replay of a failed operation
   */
  async replay(id: string): Promise<void> {
    const operation = await this.repository.findOne({ where: { id } });
    if (!operation) throw new Error("Operation not found");

    operation.status = OperationStatus.PENDING;
    operation.retries = 0;
    operation.errorMessage = undefined;
    operation.nextRetryAt = undefined;
    await this.repository.save(operation);

    return this.runOperation(id);
  }
}

export const durableOperationService = new DurableOperationService();
