import { In, IsNull, LessThan, LessThanOrEqual, Or, Repository } from "typeorm";
import AppDataSource from "../../config/Datasource";
import {
  RESOLVABLE_SUBMISSION_STATES,
  SubmissionState,
} from "./SubmissionState";
import type { CreateSubmissionInput, SubmissionStore } from "./SubmissionStore";
import { TransactionSubmission } from "./TransactionSubmission.entity";

export class TypeOrmSubmissionStore implements SubmissionStore {
  private get repository(): Repository<TransactionSubmission> {
    return AppDataSource.getRepository(TransactionSubmission);
  }

  async create(input: CreateSubmissionInput): Promise<TransactionSubmission> {
    const record = this.repository.create({
      ...input,
      lifecycleId: input.lifecycleId ?? null,
      metadata: input.metadata ?? null,
      state: SubmissionState.BUILT,
      submitAttempts: 0,
      resolutionAttempts: 0,
      nextResolutionAt: null,
      ledger: null,
      resultXdr: null,
      lastReason: null,
      submittedAt: null,
      resolvedAt: null,
    });
    return this.repository.save(record);
  }

  async save(record: TransactionSubmission): Promise<TransactionSubmission> {
    return this.repository.save(record);
  }

  async findById(id: string): Promise<TransactionSubmission | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByHash(
    transactionHash: string
  ): Promise<TransactionSubmission | null> {
    return this.repository.findOne({ where: { transactionHash } });
  }

  async findByIdempotencyKey(
    idempotencyKey: string
  ): Promise<TransactionSubmission | null> {
    return this.repository.findOne({ where: { idempotencyKey } });
  }

  async findByUser(
    userId: string,
    limit: number
  ): Promise<TransactionSubmission[]> {
    return this.repository.find({
      where: { userId },
      order: { createdAt: "DESC" },
      take: limit,
    });
  }

  async findDueForResolution(
    now: Date,
    limit: number
  ): Promise<TransactionSubmission[]> {
    return this.repository.find({
      where: {
        state: In([...RESOLVABLE_SUBMISSION_STATES]),
        nextResolutionAt: Or(IsNull(), LessThanOrEqual(now)),
      },
      order: { nextResolutionAt: "ASC" },
      take: limit,
    });
  }

  async findStalled(stalledBefore: Date): Promise<TransactionSubmission[]> {
    return this.repository.find({
      where: {
        state: In([SubmissionState.BUILT, SubmissionState.SUBMITTING]),
        updatedAt: LessThan(stalledBefore),
      },
    });
  }
}
