import type { TransactionSubmission } from "./TransactionSubmission.entity";

export interface CreateSubmissionInput {
  idempotencyKey: string;
  userId: string;
  operationType: string;
  transactionHash: string;
  envelopeXdr: string;
  sourceAccount: string;
  sequenceNumber: string;
  maxTime: string | null;
  lifecycleId?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Persistence port. Every state change is a write.
export interface SubmissionStore {
  create(input: CreateSubmissionInput): Promise<TransactionSubmission>;
  save(record: TransactionSubmission): Promise<TransactionSubmission>;
  findById(id: string): Promise<TransactionSubmission | null>;
  findByHash(transactionHash: string): Promise<TransactionSubmission | null>;
  findByIdempotencyKey(
    idempotencyKey: string
  ): Promise<TransactionSubmission | null>;
  findByUser(userId: string, limit: number): Promise<TransactionSubmission[]>;
  /** Due for another resolution attempt. */
  findDueForResolution(
    now: Date,
    limit: number
  ): Promise<TransactionSubmission[]>;
  /** Left mid-flight by a dead process. */
  findStalled(stalledBefore: Date): Promise<TransactionSubmission[]>;
}
