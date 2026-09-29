import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export type JobStatus =
  | "pending"
  | "leased"
  | "completed"
  | "dead_letter"
  | "cancelled";

@Entity({ name: "job_queue" })
@Index(["queue", "status", "availableAt"])
@Index(["jobType", "status", "availableAt"])
@Index(["status", "leaseExpiresAt"])
@Index(["userId", "status"])
export class QueueJob {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 100 })
  queue!: string;

  @Column({ type: "varchar", length: 150 })
  jobType!: string;

  @Column({ type: "varchar", length: 32, default: "pending" })
  status!: JobStatus;

  @Column({ type: "uuid", nullable: true })
  userId?: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  correlationId?: string | null;

  @Column({ type: "jsonb" })
  payload!: Record<string, unknown>;

  @Column({ type: "jsonb", nullable: true })
  result?: Record<string, unknown> | null;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown> | null;

  @Column({ type: "timestamp", default: () => "now()" })
  availableAt!: Date;

  @Column({ type: "timestamp", nullable: true })
  leaseExpiresAt?: Date | null;

  @Column({ type: "varchar", length: 120, nullable: true })
  leasedBy?: string | null;

  @Column({ type: "int", default: 0 })
  attempts!: number;

  @Column({ type: "int", default: 5 })
  maxAttempts!: number;

  @Column({ type: "text", nullable: true })
  lastError?: string | null;

  @Column({ type: "timestamp", nullable: true })
  completedAt?: Date | null;

  @Column({ type: "timestamp", nullable: true })
  deadLetteredAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
