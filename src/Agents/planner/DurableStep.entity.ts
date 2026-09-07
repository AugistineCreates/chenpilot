import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
} from "typeorm";
import { DurableExecution } from "./DurableExecution.entity";
import { CompensationType, CompensationOutcome } from "../types";

export enum StepStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  AWAITING_APPROVAL = "awaiting_approval",
  COMPENSATING = "compensating",
  COMPENSATED = "compensated",
  /**
   * Terminal state set when:
   *  (a) the parent execution is cancelled and this step has not yet started,
   *  (b) an upstream step failure causes all downstream dependents to be
   *      cancelled by the ParallelScheduler, or
   *  (c) an explicit downstream-cancellation pass touches this step.
   *
   * A step that is already RUNNING when cancellation is requested is allowed
   * to complete the current attempt; the CANCELLED flag on the parent
   * execution causes the executor to stop before invoking the *next* step's
   * side effect.
   */
  CANCELLED = "cancelled",
}

@Entity()
export class DurableStep {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => DurableExecution, (execution) => execution.steps)
  execution!: DurableExecution;

  @Column({ type: "integer" })
  stepNumber!: number;

  @Column({ type: "varchar" })
  action!: string;

  @Column({ type: "jsonb" })
  payload!: Record<string, unknown>;

  @Column({ type: "boolean", default: false })
  requiresApproval!: boolean;

  @Column({ type: "timestamp", nullable: true })
  approvedAt?: Date;

  @Column({ type: "uuid", nullable: true })
  approvedBy?: string;

  @Column({
    type: "enum",
    enum: StepStatus,
    default: StepStatus.PENDING,
  })
  status!: StepStatus;

  @Column({ type: "jsonb", nullable: true })
  result!: unknown;

  @Column({ type: "text", nullable: true })
  error?: string;

  @Column({ type: "integer", default: 0 })
  retryCount!: number;

  @Column({ type: "integer", default: 3 })
  maxRetries!: number;

  @Column({ type: "timestamp", nullable: true })
  startedAt?: Date;

  @Column({ type: "timestamp", nullable: true })
  completedAt?: Date;

  // ── Compensation fields ──────────────────────────────────────────────────────

  /** Whether this step can be rolled back */
  @Column({ type: "varchar", default: CompensationType.REVERSIBLE })
  compensationType!: CompensationType;

  /** The action to execute for rollback (null if irreversible) */
  @Column({ type: "varchar", nullable: true })
  rollbackAction?: string;

  /** Payload for the rollback action */
  @Column({ type: "jsonb", nullable: true })
  rollbackPayload?: Record<string, unknown>;

  /** Human-readable description of how to compensate */
  @Column({ type: "text", nullable: true })
  compensationDescription?: string;

  /** Outcome of the compensation attempt */
  @Column({ type: "varchar", nullable: true })
  compensationOutcome?: CompensationOutcome;

  /** Error message from compensation attempt */
  @Column({ type: "text", nullable: true })
  compensationError?: string;

  /** Number of compensation retries attempted */
  @Column({ type: "integer", default: 0 })
  compensationRetryCount!: number;

  /** Maximum compensation retries */
  @Column({ type: "integer", default: 3 })
  maxCompensationRetries!: number;

  /**
   * Recorded when the step transitions to CANCELLED. Null for all other
   * terminal and non-terminal states.
   */
  @Column({ type: "timestamp", nullable: true })
  cancelledAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}