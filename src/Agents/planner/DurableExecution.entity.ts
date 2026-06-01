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

export enum ExecutionStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  PAUSED = "paused",
  AWAITING_APPROVAL = "awaiting_approval",
}

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
  context!: Record<string, any>;

  @OneToMany(() => DurableStep, (step) => step.execution, { cascade: true })
  steps!: DurableStep[];

  @Column({ type: "text", nullable: true })
  errorMessage?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
