import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";
import {
  SensitiveActionType,
  WorkflowStatus,
  RiskLevel,
  AdminWorkflowPolicy as IAdminWorkflowPolicy,
} from "./workflow.types";

export enum WorkflowStatusEntity {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
  EXPIRED = "expired",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
}

export enum RiskLevelEntity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

@Entity("admin_workflow_policies")
@Index(["actionType"])
@Index(["enabled"])
export class AdminWorkflowPolicy {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({
    type: "varchar",
    unique: true,
  })
  actionType!: SensitiveActionType;

  @Column()
  name!: string;

  @Column("text")
  description!: string;

  @Column({
    type: "varchar",
    default: RiskLevelEntity.MEDIUM,
  })
  riskLevel!: RiskLevel;

  @Column({ type: "integer", default: 1 })
  requiredApprovals!: number;

  @Column({ type: "simple-array", default: "{admin}" })
  allowedApproverRoles!: string[];

  @Column({ type: "integer", default: 60 })
  approvalTimeoutMinutes!: number;

  @Column("text", { nullable: true })
  allowedIpRanges?: string;

  @Column({ type: "boolean", default: false })
  requireMfa!: boolean;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({ type: "boolean", default: false })
  autoExecuteOnApproval!: boolean;

  @Column("jsonb", { nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn()
  @Index()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  toInterface(): IAdminWorkflowPolicy {
    return {
      id: this.id,
      actionType: this.actionType,
      name: this.name,
      description: this.description,
      riskLevel: this.riskLevel as RiskLevel,
      requiredApprovals: this.requiredApprovals,
      allowedApproverRoles: this.allowedApproverRoles,
      approvalTimeoutMinutes: this.approvalTimeoutMinutes,
      allowedIpRanges: this.allowedIpRanges
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      requireMfa: this.requireMfa,
      enabled: this.enabled,
      autoExecuteOnApproval: this.autoExecuteOnApproval,
      metadata: this.metadata,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

@Entity("admin_workflow_instances")
@Index(["actionType"])
@Index(["status"])
@Index(["initiatorId"])
@Index(["policyId"])
@Index(["expiresAt"])
export class AdminWorkflowInstance {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column("uuid")
  policyId!: string;

  @Column({
    type: "varchar",
  })
  actionType!: SensitiveActionType;

  @Column("uuid")
  @Index()
  initiatorId!: string;

  @Column({
    type: "varchar",
    default: WorkflowStatusEntity.PENDING,
  })
  status!: WorkflowStatus;

  @Column("jsonb")
  payload!: Record<string, unknown>;

  @Column("jsonb", { nullable: true })
  metadata?: Record<string, unknown>;

  @Column({ type: "timestamp" })
  expiresAt!: Date;

  @Column({ type: "timestamp", nullable: true })
  completedAt?: Date;

  @CreateDateColumn()
  @Index()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity("admin_workflow_approvals")
@Index(["instanceId"])
@Index(["approverId"])
@Index(["decision"])
export class AdminWorkflowApproval {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column("uuid")
  @Index()
  instanceId!: string;

  @Column("uuid")
  @Index()
  approverId!: string;

  @Column({
    type: "varchar",
    default: "pending",
  })
  decision!: string;

  @Column("text", { nullable: true })
  comment?: string;

  @Column({ type: "timestamp", nullable: true })
  decidedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
