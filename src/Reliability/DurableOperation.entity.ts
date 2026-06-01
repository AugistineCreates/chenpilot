import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

export enum OperationStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

@Entity()
@Index(["idempotentKey", "category"], { unique: true, where: '"idempotentKey" IS NOT NULL' })
@Index(["status", "nextRetryAt"])
@Index(["status", "scheduledAt"])
export class DurableOperation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", nullable: true })
  idempotentKey?: string;

  @Column({ type: "varchar" })
  @Index()
  category!: string;

  @Column({
    type: "enum",
    enum: OperationStatus,
    default: OperationStatus.PENDING,
  })
  status!: OperationStatus;

  @Column({ type: "jsonb" })
  payload!: Record<string, any>;

  @Column({ type: "jsonb", nullable: true })
  result?: any;

  @Column({ type: "text", nullable: true })
  errorMessage?: string;

  @Column({ type: "integer", default: 0 })
  retries!: number;

  @Column({ type: "integer", default: 3 })
  maxRetries!: number;

  @Column({ type: "timestamp", nullable: true })
  nextRetryAt?: Date;

  @Column({ type: "timestamp", nullable: true })
  scheduledAt?: Date;

  @Column({ type: "jsonb", nullable: true })
  conditions?: Record<string, any>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: "timestamp", nullable: true })
  completedAt?: Date;
}
