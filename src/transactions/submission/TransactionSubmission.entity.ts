import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { SubmissionState } from "./SubmissionState";

// Written before the envelope reaches the network, so a crash still leaves
// the hash, sequence and time bounds needed to resolve the outcome.
@Entity("transaction_submission")
@Index(["state", "nextResolutionAt"])
@Index(["sourceAccount", "sequenceNumber"])
@Index(["userId", "createdAt"])
export class TransactionSubmission {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** Reusing it returns the existing record instead of a second envelope. */
  @Column({ type: "varchar", unique: true })
  idempotencyKey!: string;

  @Column({ type: "varchar" })
  userId!: string;

  /** swap, transfer, soroban, etc. */
  @Column({ type: "varchar" })
  operationType!: string;

  @Column({ type: "varchar", default: SubmissionState.BUILT })
  state!: SubmissionState;

  /** Deterministic over the signed envelope, so known before submission. */
  @Column({ type: "varchar", unique: true })
  transactionHash!: string;

  @Column({ type: "text" })
  envelopeXdr!: string;

  @Column({ type: "varchar" })
  sourceAccount!: string;

  /** int64, stored as text to avoid precision loss. */
  @Column({ type: "varchar" })
  sequenceNumber!: string;

  /** Unix timestamp. Without it a submission can never be declared expired. */
  @Column({ type: "varchar", nullable: true })
  maxTime!: string | null;

  @Column({ type: "integer", default: 0 })
  submitAttempts!: number;

  @Column({ type: "integer", default: 0 })
  resolutionAttempts!: number;

  /** Null once terminal. */
  @Column({ type: "timestamp", nullable: true })
  nextResolutionAt!: Date | null;

  @Column({ type: "integer", nullable: true })
  ledger!: number | null;

  @Column({ type: "text", nullable: true })
  resultXdr!: string | null;

  /** Why the record is in its current state. */
  @Column({ type: "text", nullable: true })
  lastReason!: string | null;

  @Column({ type: "timestamp", nullable: true })
  submittedAt!: Date | null;

  @Column({ type: "timestamp", nullable: true })
  resolvedAt!: Date | null;

  /** Matching transaction_lifecycle row, if any. */
  @Column({ type: "varchar", nullable: true })
  lifecycleId!: string | null;

  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
