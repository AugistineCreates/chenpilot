import logger from "../../config/logger";
import {
  AmbiguousSubmissionError,
  SubmissionGateway,
} from "./SubmissionGateway";
import { SubmissionResolver } from "./SubmissionResolver";
import {
  assertSubmissionTransition,
  DuplicateEffectRiskError,
  isRetrySafe,
  isTerminalSubmissionState,
  SubmissionAlreadyResolvedError,
  SubmissionState,
} from "./SubmissionState";
import type { CreateSubmissionInput, SubmissionStore } from "./SubmissionStore";
import type { TransactionSubmission } from "./TransactionSubmission.entity";

export interface TransactionSubmissionServiceOptions {
  /** First backoff delay, in milliseconds. */
  baseResolutionDelayMs?: number;
  /** Backoff ceiling, in milliseconds. */
  maxResolutionDelayMs?: number;
  /** How long a record may sit in `built` or `submitting` before it counts as abandoned. */
  stalledAfterMs?: number;
}

interface TransitionPatch {
  reason: string;
  ledger?: number | null;
  resultXdr?: string | null;
  metadata?: Record<string, unknown>;
}

const DEFAULT_BASE_RESOLUTION_DELAY_MS = 5_000;
const DEFAULT_MAX_RESOLUTION_DELAY_MS = 300_000;
const DEFAULT_STALLED_AFTER_MS = 60_000;
const DEFAULT_RESOLUTION_BATCH_SIZE = 50;

// Drives a submission from built envelope to a terminal state. Every
// transition is persisted before the next network call, and retries only go
// through prepareRetry.
export class TransactionSubmissionService {
  private readonly resolver: SubmissionResolver;
  private readonly baseResolutionDelayMs: number;
  private readonly maxResolutionDelayMs: number;
  private readonly stalledAfterMs: number;

  constructor(
    private readonly gateway: SubmissionGateway,
    private readonly store: SubmissionStore,
    options: TransactionSubmissionServiceOptions = {}
  ) {
    this.resolver = new SubmissionResolver(gateway);
    this.baseResolutionDelayMs =
      options.baseResolutionDelayMs ?? DEFAULT_BASE_RESOLUTION_DELAY_MS;
    this.maxResolutionDelayMs =
      options.maxResolutionDelayMs ?? DEFAULT_MAX_RESOLUTION_DELAY_MS;
    this.stalledAfterMs = options.stalledAfterMs ?? DEFAULT_STALLED_AFTER_MS;
  }

  /** Persists the envelope before it can reach the network. */
  async register(input: CreateSubmissionInput): Promise<TransactionSubmission> {
    const existing = await this.store.findByIdempotencyKey(
      input.idempotencyKey
    );
    if (existing) {
      return existing;
    }

    const record = await this.store.create(input);
    logger.info("Submission registered", {
      submissionId: record.id,
      transactionHash: record.transactionHash,
      sourceAccount: record.sourceAccount,
      sequenceNumber: record.sequenceNumber,
    });
    return record;
  }

  /** Returns the record in whatever state the attempt produced, including `unknown`. */
  async submit(submissionId: string): Promise<TransactionSubmission> {
    let record = await this.requireRecord(submissionId);

    // Replaying a submit for an applied transaction is a no-op.
    if (record.state === SubmissionState.FINALIZED) {
      return record;
    }
    if (isTerminalSubmissionState(record.state)) {
      throw new SubmissionAlreadyResolvedError(record.id, record.state);
    }
    if (record.state !== SubmissionState.BUILT) {
      throw new DuplicateEffectRiskError(record.id, record.state);
    }

    record.submitAttempts += 1;
    record.submittedAt = new Date();
    record = await this.applyTransition(record, SubmissionState.SUBMITTING, {
      reason: "submit_started",
    });

    try {
      const outcome = await this.gateway.submit(record.envelopeXdr);

      if (outcome.status === "applied") {
        return this.applyTransition(
          record,
          outcome.successful
            ? SubmissionState.FINALIZED
            : SubmissionState.REJECTED,
          {
            reason: outcome.successful
              ? "applied_in_ledger"
              : "failed_in_ledger",
            ledger: outcome.ledger,
            resultXdr: outcome.resultXdr ?? null,
          }
        );
      }

      if (outcome.status === "rejected") {
        return this.applyTransition(record, SubmissionState.REJECTED, {
          reason: outcome.reason,
          resultXdr: outcome.resultXdr ?? null,
        });
      }

      return this.applyTransition(record, SubmissionState.ACCEPTED, {
        reason: "accepted_by_provider",
      });
    } catch (error) {
      const reason =
        error instanceof AmbiguousSubmissionError
          ? error.message
          : `unexpected_submit_error: ${error instanceof Error ? error.message : String(error)}`;

      logger.warn("Submission outcome is ambiguous", {
        submissionId: record.id,
        transactionHash: record.transactionHash,
        reason,
      });

      return this.applyTransition(record, SubmissionState.UNKNOWN, { reason });
    }
  }

  /** Runs one resolution pass over a single submission. */
  async resolve(submissionId: string): Promise<TransactionSubmission> {
    const record = await this.requireRecord(submissionId);
    return this.resolveRecord(record);
  }

  /** Runs one resolution pass over every submission that is due. */
  async resolveDue(
    limit: number = DEFAULT_RESOLUTION_BATCH_SIZE
  ): Promise<TransactionSubmission[]> {
    const due = await this.store.findDueForResolution(new Date(), limit);
    const resolved: TransactionSubmission[] = [];

    for (const record of due) {
      resolved.push(await this.resolveRecord(record));
    }

    return resolved;
  }

  /** Hands submissions abandoned by a dead process to the resolver. Safe on every boot. */
  async recoverStalled(): Promise<TransactionSubmission[]> {
    const stalledBefore = new Date(Date.now() - this.stalledAfterMs);
    const stalled = await this.store.findStalled(stalledBefore);
    const recovered: TransactionSubmission[] = [];

    for (const record of stalled) {
      logger.warn("Recovering stalled submission", {
        submissionId: record.id,
        state: record.state,
        transactionHash: record.transactionHash,
      });
      recovered.push(
        await this.applyTransition(record, SubmissionState.UNKNOWN, {
          reason: "recovered_after_process_failure",
        })
      );
    }

    return recovered;
  }

  /**
   * Gate for every retry and compensating action.
   * @throws DuplicateEffectRiskError while the previous attempt is unresolved.
   */
  async prepareRetry(submissionId: string): Promise<TransactionSubmission> {
    const record = await this.requireRecord(submissionId);

    if (!isRetrySafe(record.state)) {
      throw new DuplicateEffectRiskError(record.id, record.state);
    }

    return record;
  }

  /**
   * Registers a replacement submission. A retry is always a new envelope,
   * since the original burnt its sequence slot or outlived its time bounds.
   * @throws DuplicateEffectRiskError while the previous attempt is unresolved.
   */
  async registerRetry(
    previousSubmissionId: string,
    input: CreateSubmissionInput
  ): Promise<TransactionSubmission> {
    const previous = await this.prepareRetry(previousSubmissionId);

    return this.register({
      ...input,
      metadata: {
        ...(input.metadata ?? {}),
        retryOf: previous.id,
        retryOfState: previous.state,
      },
    });
  }

  async findById(id: string): Promise<TransactionSubmission | null> {
    return this.store.findById(id);
  }

  async findByHash(
    transactionHash: string
  ): Promise<TransactionSubmission | null> {
    return this.store.findByHash(transactionHash);
  }

  async findByIdempotencyKey(
    key: string
  ): Promise<TransactionSubmission | null> {
    return this.store.findByIdempotencyKey(key);
  }

  async findByUser(
    userId: string,
    limit = 50
  ): Promise<TransactionSubmission[]> {
    return this.store.findByUser(userId, limit);
  }

  private async resolveRecord(
    record: TransactionSubmission
  ): Promise<TransactionSubmission> {
    if (isTerminalSubmissionState(record.state)) {
      return record;
    }

    const resolution = await this.resolver.resolve(record);
    record.resolutionAttempts += 1;

    if (resolution.state === SubmissionState.UNKNOWN) {
      record.lastReason = resolution.reason;
      record.nextResolutionAt = this.nextResolutionAt(
        record.resolutionAttempts
      );

      // Already unknown, so only the backoff changes.
      if (record.state === SubmissionState.UNKNOWN) {
        return this.store.save(record);
      }

      return this.applyTransition(record, SubmissionState.UNKNOWN, {
        reason: resolution.reason,
      });
    }

    const patch: TransitionPatch = { reason: resolution.reason };
    if ("ledger" in resolution && resolution.ledger !== undefined) {
      patch.ledger = resolution.ledger;
    }
    if ("resultXdr" in resolution && resolution.resultXdr !== undefined) {
      patch.resultXdr = resolution.resultXdr;
    }

    logger.info("Submission resolved", {
      submissionId: record.id,
      transactionHash: record.transactionHash,
      from: record.state,
      to: resolution.state,
      reason: resolution.reason,
    });

    return this.applyTransition(record, resolution.state, patch);
  }

  private async applyTransition(
    record: TransactionSubmission,
    next: SubmissionState,
    patch: TransitionPatch
  ): Promise<TransactionSubmission> {
    assertSubmissionTransition(record.id, record.state, next);

    record.state = next;
    record.lastReason = patch.reason;

    if (patch.ledger !== undefined) {
      record.ledger = patch.ledger;
    }
    if (patch.resultXdr !== undefined) {
      record.resultXdr = patch.resultXdr;
    }
    if (patch.metadata) {
      record.metadata = { ...(record.metadata ?? {}), ...patch.metadata };
    }

    if (isTerminalSubmissionState(next)) {
      record.resolvedAt = new Date();
      record.nextResolutionAt = null;
    } else {
      record.nextResolutionAt = this.nextResolutionAt(
        record.resolutionAttempts
      );
    }

    return this.store.save(record);
  }

  private nextResolutionAt(attempts: number): Date {
    const delay = Math.min(
      this.maxResolutionDelayMs,
      this.baseResolutionDelayMs * 2 ** Math.max(0, attempts)
    );
    return new Date(Date.now() + delay);
  }

  private async requireRecord(
    submissionId: string
  ): Promise<TransactionSubmission> {
    const record = await this.store.findById(submissionId);
    if (!record) {
      throw new Error(`Submission ${submissionId} not found`);
    }
    return record;
  }
}
