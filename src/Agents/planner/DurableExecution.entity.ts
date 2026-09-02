import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from "typeorm";
import { DurableStep } from "./DurableStep.entity";
import { FailureState } from "../types";

export enum ExecutionStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  PAUSED = "paused",
  AWAITING_APPROVAL = "awaiting_approval",
  COMPENSATING = "compensating",
}

/**
 * The set of statuses from which an execution may legally be cancelled.
 *
 * COMPLETED and FAILED are excluded because they are terminal states that
 * reflect irreversible outcomes already recorded on-chain or in external
 * systems.  Accepting a cancellation request for those states would create a
 * false historical record.
 *
 * CANCELLED itself is excluded from this set — attempting to cancel an
 * already-cancelled execution is handled as an idempotent no-op in
 * DurableExecutor.cancelExecution rather than an error.
 */
export const CANCELLABLE_EXECUTION_STATUSES = new Set<ExecutionStatus>([
  ExecutionStatus.PENDING,
  ExecutionStatus.RUNNING,
  ExecutionStatus.PAUSED,
  ExecutionStatus.AWAITING_APPROVAL,
]);

@Entity()
export class DurableExecution {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  @Index()
  planId!: string;

  @Column({ type: "uuid" })
  @Index()
  userId!: string;

  @Column({
    type: "enum",
    enum: ExecutionStatus,
    default: ExecutionStatus.PENDING,
  })
  status!: ExecutionStatus;

  @Column({ type: "varchar", nullable: true })
  riskLevel?: string;

  @Column({ type: "boolean", default: false })
  requiresApproval!: boolean;

  @Column({ type: "timestamp", nullable: true })
  approvedAt?: Date;

  @Column({ type: "uuid", nullable: true })
  approvedBy?: string;

  @Column({ type: "integer", default: 1 })
  currentStepNumber!: number;

  @Column({ type: "jsonb", nullable: true })
  context!: Record<string, unknown>;

  @OneToMany(() => DurableStep, (step) => step.execution, { cascade: true })
  steps!: DurableStep[];

  @Column({ type: "text", nullable: true })
  errorMessage?: string;

  // ── Compensation / failure classification ──────────────────────────────────

  /** How the failure was classified after compensation attempts */
  @Column({ type: "varchar", nullable: true })
  failureState?: FailureState;

  /** Summary of compensation results */
  @Column({ type: "jsonb", nullable: true })
  compensationSummary?: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
