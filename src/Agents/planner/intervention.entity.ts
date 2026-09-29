/**
 * intervention.entity.ts
 *
 * Immutable record of every operator intervention applied to a
 * DurableExecution.  Rows are INSERT-only — no UPDATE is ever issued against
 * this table after the row is created, enforcing tamper-evidence at the
 * application layer.
 *
 * Each record is linked to:
 *   - the DurableExecution via executionId
 *   - the corresponding audit_log row via auditLogId
 *   - optionally the AdminWorkflowInstance that approved it (high-risk cmds)
 *
 * The executionTranscriptHash binds the record to the exact execution state
 * at the time of intervention, so any retrospective modification of the
 * execution steps is detectable.
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { DurableExecution } from "./DurableExecution.entity";
import {
  InterventionCommand,
  InterventionStatus,
  InterventionPayload,
} from "./intervention.types";

@Entity("intervention_records")
@Index("IDX_ir_executionId_createdAt", ["executionId", "createdAt"])
@Index("IDX_ir_operatorId_createdAt", ["operatorId", "createdAt"])
@Index("IDX_ir_command_status", ["command", "status"])
@Index("IDX_ir_workflowInstanceId", ["workflowInstanceId"])
export class InterventionRecord {
  // ── Primary Key ────────────────────────────────────────────────────────────

  @PrimaryGeneratedColumn("uuid")
  id!: string;

  // ── Execution linkage ──────────────────────────────────────────────────────

  /**
   * FK → durable_execution.id
   * Indexes allow forensic reconstruction: "show me all interventions for
   * execution X in chronological order".
   */
  @Column({ type: "uuid" })
  @Index("IDX_ir_executionId")
  executionId!: string;

  @ManyToOne(() => DurableExecution, { nullable: false, eager: false })
  @JoinColumn({ name: "executionId" })
  execution!: DurableExecution;

  /**
   * Step targeted by RETRY / SKIP / COMPENSATE.
   * Null for execution-level commands (QUARANTINE / RESOLVE).
   */
  @Column({ type: "integer", nullable: true })
  targetStepNumber?: number;

  // ── Command & Status ───────────────────────────────────────────────────────

  @Column({ type: "varchar" })
  command!: InterventionCommand;

  @Column({ type: "varchar", default: InterventionStatus.PENDING_APPROVAL })
  status!: InterventionStatus;

  // ── Operator ───────────────────────────────────────────────────────────────

  @Column({ type: "uuid" })
  @Index("IDX_ir_operatorId")
  operatorId!: string;

  // ── Signed payload ─────────────────────────────────────────────────────────

  /**
   * The payload submitted with the command (PII-scrubbed before persist).
   * Stored as-received so the record captures operator intent exactly.
   */
  @Column({ type: "jsonb" })
  payload!: InterventionPayload;

  /**
   * HMAC-SHA256 hex digest from the SignedInterventionCommand envelope.
   * Recorded so auditors can verify the command was properly signed at
   * the time of submission.
   */
  @Column({ type: "varchar", length: 64 })
  signature!: string;

  /** One-time nonce from the signed envelope */
  @Column({ type: "varchar", length: 128 })
  nonce!: string;

  /** ISO-8601 timestamp from the signed envelope */
  @Column({ type: "varchar", length: 32 })
  issuedAt!: string;

  // ── Execution transcript binding ───────────────────────────────────────────

  /**
   * SHA-256 hex digest of the execution's canonical state snapshot at the
   * moment the intervention was evaluated.
   *
   * Computed over: executionId + status + currentStepNumber +
   *   steps[].{stepNumber, status, retryCount, completedAt}
   *
   * Verifying this hash against the live execution state detects any
   * retrospective modification of the transcript.
   */
  @Column({ type: "varchar", length: 64 })
  executionTranscriptHash!: string;

  // ── Dry-run flag ───────────────────────────────────────────────────────────

  /**
   * True when the operator requested dry-run mode.
   * Dry-run records capture the preview output but are never applied.
   */
  @Column({ type: "boolean", default: false })
  dryRun!: boolean;

  /**
   * For dry-run records: the JSON preview of state changes that would have
   * been made.  Null for non-dry-run records.
   */
  @Column({ type: "jsonb", nullable: true })
  dryRunOutput?: Record<string, unknown>;

  // ── Multi-party approval linkage ───────────────────────────────────────────

  /**
   * FK → admin_workflow_instances.id
   * Set for COMPENSATE / QUARANTINE commands that route through the
   * AdminWorkflowService for multi-party approval.
   * Null for low-risk single-operator commands.
   */
  @Column({ type: "uuid", nullable: true })
  workflowInstanceId?: string;

  // ── Audit log linkage ──────────────────────────────────────────────────────

  /**
   * FK → audit_log.id
   * Created when the intervention is applied.  Links the immutable
   * intervention record to the tamper-evident audit log chain.
   */
  @Column({ type: "uuid", nullable: true })
  auditLogId?: string;

  // ── Application result ─────────────────────────────────────────────────────

  /**
   * Human-readable result message (success text or error description).
   * Null until the intervention is applied or fails.
   */
  @Column({ type: "text", nullable: true })
  resultMessage?: string;

  /**
   * If status = FAILED: full error message.
   */
  @Column({ type: "text", nullable: true })
  errorMessage?: string;

  // ── Timestamps ─────────────────────────────────────────────────────────────

  /**
   * Creation timestamp.  This is also the "submitted" timestamp because
   * records are created at submission time, before approval.
   */
  @CreateDateColumn()
  @Index("IDX_ir_createdAt")
  createdAt!: Date;

  /**
   * Timestamp when the intervention was applied (status → APPLIED or FAILED).
   * Null until then.
   */
  @Column({ type: "timestamp", nullable: true })
  appliedAt?: Date;

  /**
   * The execution's status at the time of application.
   * Recorded for forensic reconstruction of the before/after state.
   */
  @Column({ type: "varchar", nullable: true })
  executionStatusBefore?: string;

  /**
   * The execution's status after the intervention was applied.
   */
  @Column({ type: "varchar", nullable: true })
  executionStatusAfter?: string;
}
