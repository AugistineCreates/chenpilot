import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

export enum ExperimentStatus {
  DRAFT = "draft",
  ACTIVE = "active",
  PAUSED = "paused",
  COMPLETED = "completed",
  ARCHIVED = "archived",
}

export enum ExperimentType {
  AB_PROMPT = "ab_prompt",
  AB_PLANNER = "ab_planner",
  AGENT_BEHAVIOR = "agent_behavior",
}

@Entity()
export class Experiment {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  name!: string;

  @Column({ type: "text", nullable: true })
  description?: string;

  @Column({
    type: "varchar",
    default: ExperimentStatus.DRAFT,
  })
  @Index()
  status!: ExperimentStatus;

  @Column({
    type: "varchar",
    default: ExperimentType.AB_PROMPT,
  })
  type!: ExperimentType;

  @Column("jsonb")
  variants!: Array<{
    id: string;
    name: string;
    promptVersionId?: string;
    weight: number; // 0-100
    config?: Record<string, unknown>;
  }>;

  @Column({ type: "timestamp", nullable: true })
  startDate?: Date;

  @Column({ type: "timestamp", nullable: true })
  endDate?: Date;

  @Column("jsonb", { nullable: true })
  targetCriteria?: {
    userRoles?: string[];
    platforms?: string[];
    trafficAllocation?: number; // 0-100 percentage
  };

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity()
export class ExperimentMetric {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column("uuid")
  @Index()
  experimentId!: string;

  @Column()
  variantId!: string;

  @Column("uuid", { nullable: true })
  userId?: string;

  @Column({ type: "varchar", nullable: true })
  traceId?: string;

  @Column()
  success!: boolean;

  @Column({ type: "integer", nullable: true })
  responseTimeMs?: number;

  @Column("jsonb", { nullable: true })
  metrics?: Record<string, unknown>; // e.g., stepsCompleted, totalSteps, score

  @CreateDateColumn()
  @Index()
  createdAt!: Date;
}
