import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

// ── Event status ──────────────────────────────────────────────────────────────

export type OutboxEventStatus = "pending" | "dispatched" | "failed";

// ── Aggregate types used for per-aggregate ordering ───────────────────────────

export type AggregateType =
  | "transaction"
  | "bot"
  | "deployment"
  | "agent"
  | "user"
  | "contact"
  | "contract"
  | "audit"
  | "generic";

// ── Entity ────────────────────────────────────────────────────────────────────

/**
 * Transactional outbox entity.
 *
 * Records are inserted **in the same DB transaction** that performs the business
 * state change, guaranteeing atomicity.  A background dispatcher polls pending
 * rows, dispatches them to consumers, and marks them dispatched.
 *
 * Consumers deduplicate by the stable `eventId` column; ordering within an
 * aggregate is enforced by the monotonically-increasing `sequence` column.
 */
@Entity("outbox_event")
@Index(["aggregateType", "aggregateId", "sequence"])
@Index(["status", "nextRetryAt"])
@Index(["createdAt"])
@Index(["eventId"], { unique: true })
export class OutboxEvent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /**
   * Stable, caller-supplied event identity.
   * Consumers use this to deduplicate redeliveries.
   */
  @Column({ type: "varchar", length: 255 })
  @Index()
  eventId!: string;

  /** Dot-separated event type, e.g. "transaction.created" */
  @Column({ type: "varchar", length: 128 })
  eventType!: string;

  /** Aggregate category for per-aggregate ordering */
  @Column({ type: "varchar", length: 64 })
  @Index()
  aggregateType!: AggregateType;

  /** ID of the aggregate this event relates to (nullable for global events) */
  @Column({ type: "varchar", length: 255, nullable: true })
  aggregateId!: string | null;

  /**
   * Monotonically-increasing sequence number **within an aggregate**.
   * Guarantees ordering for aggregates that require it (e.g. transaction lifecycle).
   */
  @Column({ type: "bigint", default: 0 })
  sequence!: number;

  /** The event payload */
  @Column({ type: "jsonb" })
  payload!: Record<string, unknown>;

  /** Optional correlation / tracing metadata */
  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  /** Processing status */
  @Column({
    type: "enum",
    enum: ["pending", "dispatched", "failed"] as const,
    default: "pending",
  })
  status!: OutboxEventStatus;

  /** Number of dispatch attempts so far */
  @Column({ type: "integer", default: 0 })
  retryCount!: number;

  /** Maximum retries before giving up */
  @Column({ type: "integer", default: 5 })
  maxRetries!: number;

  /** When the next retry should be attempted (for exponential back-off) */
  @Column({ type: "timestamp", nullable: true })
  nextRetryAt!: Date | null;

  /** Timestamp when the event was successfully dispatched */
  @Column({ type: "timestamp", nullable: true })
  dispatchedAt!: Date | null;

  /** Last error message (cleared on retry) */
  @Column({ type: "text", nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
