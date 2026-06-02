import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
} from "typeorm";
import { DurableExecution } from "./DurableExecution.entity";

export enum StepStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  AWAITING_APPROVAL = "awaiting_approval",
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
  payload!: Record<string, any>;

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
  result!: any;

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

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
