import { Repository } from "typeorm";
import AppDataSource from "../config/Datasource";
import logger from "../config/logger";
import {
  TransactionLifecycle,
  LifecycleOperationType,
  LifecycleState,
  VALID_TRANSITIONS,
  TERMINAL_STATES,
  FinalityStatus,
} from "./TransactionLifecycle.entity";
import { TransactionUpdateHelper } from "../Gateway/realtimeIntegration";
import { getFinalizationManager } from "../services/finality/FinalizationManager";

export interface TransitionOptions {
  reason?: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

export class TransactionLifecycleService {
  private get repo(): Repository<TransactionLifecycle> {
    return AppDataSource.getRepository(TransactionLifecycle);
  }

  /** Create a new lifecycle record at the `intent` state. */
  async create(
    userId: string,
    operationType: LifecycleOperationType,
    payload?: Record<string, unknown>,
    correlationId?: string
  ): Promise<TransactionLifecycle> {
    const record = this.repo.create({
      userId,
      operationType,
      state: "intent",
      payload: payload ?? null,
      correlationId: correlationId ?? null,
      metadata: null,
      lastTransitionReason: null,
    });
    const saved = await this.repo.save(record);
    logger.info("TransactionLifecycle created", {
      id: saved.id,
      userId,
      operationType,
    });
    this.emitRealtimeEvent(saved);
    return saved;
  }

  /**
   * Advance the lifecycle to `nextState`.
   * Throws if the transition is not allowed by the state machine.
   */
  async transition(
    id: string,
    nextState: LifecycleState,
    options: TransitionOptions = {}
  ): Promise<TransactionLifecycle> {
    const record = await this.repo.findOneOrFail({ where: { id } });

    if (TERMINAL_STATES.has(record.state)) {
      throw new Error(
        `TransactionLifecycle ${id} is already in terminal state '${record.state}'`
      );
    }

    if (!VALID_TRANSITIONS[record.state].has(nextState)) {
      throw new Error(
        `Invalid transition '${record.state}' → '${nextState}' for lifecycle ${id}`
      );
    }

    const prevState = record.state;
    record.state = nextState;
    record.lastTransitionReason = options.reason ?? null;

    if (options.metadata) {
      record.metadata = { ...(record.metadata ?? {}), ...options.metadata };
    }
    if (options.correlationId) {
      record.correlationId = options.correlationId;
    }

    const saved = await this.repo.save(record);

    logger.info("TransactionLifecycle transition", {
      id,
      from: prevState,
      to: nextState,
      reason: options.reason,
    });

    this.emitRealtimeEvent(saved);
    return saved;
  }

  /** Convenience: transition to `failed` with a reason. */
  async fail(id: string, reason: string, metadata?: Record<string, unknown>): Promise<TransactionLifecycle> {
    return this.transition(id, "failed", { reason, metadata });
  }

  /** Convenience: transition to `cancelled`. */
  async cancel(id: string, reason?: string): Promise<TransactionLifecycle> {
    return this.transition(id, "cancelled", { reason });
  }

  async findById(id: string): Promise<TransactionLifecycle | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findByUser(userId: string): Promise<TransactionLifecycle[]> {
    return this.repo.find({
      where: { userId },
      order: { createdAt: "DESC" },
      take: 50,
    });
  }

  /** Emit Socket.io realtime events so the frontend stays in sync. */
  private emitRealtimeEvent(record: TransactionLifecycle): void {
    try {
      // Only emit confirmation events if finality is FINAL
      if (record.state === "confirmed" && record.finalityStatus === "FINAL") {
        TransactionUpdateHelper.notifyConfirmed(
          record.id,
          record.correlationId ?? record.id,
          undefined,
          undefined,
          record.userId
        );
      } else if (record.state === "failed") {
        TransactionUpdateHelper.notifyFailed(
          record.id,
          record.correlationId ?? record.id,
          record.lastTransitionReason ?? undefined,
          record.userId
        );
      } else if (record.state === "intent") {
        TransactionUpdateHelper.notifyCreated(
          record.id,
          record.correlationId ?? record.id,
          record.userId
        );
      } else {
        TransactionUpdateHelper.notifyPending(
          record.id,
          record.correlationId ?? record.id,
          record.userId
        );
      }
    } catch (err) {
      // Realtime emission is best-effort; never block the lifecycle
      logger.warn("TransactionLifecycle realtime emit failed", { id: record.id, err });
    }
  }

  /**
   * Mark transaction as confirmed in the ledger and start reorg-aware finality tracking.
   * Does NOT emit confirmation events yet - those wait until finality_status = FINAL.
   */
  async markConfirmedInLedger(
    id: string,
    txHash: string,
    ledgerSequence: number,
    ledgerHash: string,
    provider: string
  ): Promise<TransactionLifecycle> {
    const record = await this.repo.findOneOrFail({ where: { id } });

    // Transition to "submitted" state if not already there
    if (record.state !== "submitted") {
      record.state = "submitted";
      record.correlationId = txHash;
    }

    // Start finality tracking
    const finalizationManager = getFinalizationManager();
    await finalizationManager.startTracking(id, txHash, ledgerSequence, ledgerHash, provider);

    // Store as-is for audit trail
    const saved = await this.repo.save(record);

    logger.info("TransactionLifecycle marked confirmed in ledger, finality tracking started", {
      id,
      txHash,
      ledgerSequence,
      state: record.state,
    });

    return saved;
  }
}

export const transactionLifecycleService = new TransactionLifecycleService();
