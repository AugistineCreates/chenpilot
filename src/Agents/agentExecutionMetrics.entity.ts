import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

export enum AgentType {
  INTENT = "intent",
  EXECUTION = "execution",
  RESPONSE = "response",
  PLANNER = "planner",
}

export enum ExecutionStatus {
  SUCCESS = "success",
  FAILED = "failed",
  PARTIAL = "partial",
  TIMEOUT = "timeout",
}

@Entity()
@Index(["agentType", "createdAt"])
@Index(["userId", "createdAt"])
@Index(["status", "createdAt"])
export class AgentExecutionMetrics {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  @Index()
  agentType!: AgentType;

  @Column("uuid", { nullable: true })
  @Index()
  userId?: string;

  @Column({ type: "varchar", nullable: true })
  sessionId?: string;

  @Column({ type: "varchar", nullable: true })
  planId?: string;

  @Column({ type: "varchar", default: ExecutionStatus.SUCCESS })
  status!: ExecutionStatus;

  @Column({ type: "integer" })
  executionTimeMs!: number;

  @Column({ type: "integer", nullable: true })
  tokensUsed?: number;

  @Column({ type: "integer", nullable: true })
  inputTokens?: number;

  @Column({ type: "integer", nullable: true })
  outputTokens?: number;

  @Column({ type: "decimal", precision: 18, scale: 8, nullable: true })
  estimatedCostUsd?: number;

  @Column({ type: "boolean", default: false })
  tokenUsageAnomalous!: boolean;

  @Column({ type: "integer", default: 0 })
  stepsCompleted!: number;

  @Column({ type: "integer", default: 0 })
  totalSteps!: number;

  @Column({ type: "text", nullable: true })
  errorMessage?: string;

  @Column({ type: "jsonb", nullable: true })
  inputMetadata?: Record<string, unknown>;

  @Column({ type: "jsonb", nullable: true })
  outputMetadata?: Record<string, unknown>;

  @CreateDateColumn()
  @Index()
  createdAt!: Date;
}
