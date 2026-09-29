export enum SensitiveActionType {
  ENABLE_TOOL = "enable_tool",
  DISABLE_TOOL = "disable_tool",
  ACTIVATE_PROMPT = "activate_prompt",
  UPDATE_PROMPT = "update_prompt",
  DELETE_PROMPT = "delete_prompt",
  MODIFY_STRATEGY_SETTINGS = "modify_strategy_settings",
  MODIFY_SECURITY_POSTURE = "modify_security_posture",
  PURGE_AUDIT_LOGS = "purge_audit_logs",
  UPDATE_IP_BLACKLIST = "update_ip_blacklist",
  MODIFY_RATE_LIMITS = "modify_rate_limits",
  UPDATE_ADMIN_ALLOWED_IPS = "update_admin_allowed_ips",
  /**
   * Operator intervention: compensate a completed execution step with an
   * on-chain compensating transaction.  HIGH-RISK: requires 2 approvals.
   */
  INTERVENTION_COMPENSATE = "intervention_compensate",
  /**
   * Operator intervention: freeze a running/failed execution for investigation.
   * HIGH-RISK: requires 2 approvals.
   */
  INTERVENTION_QUARANTINE = "intervention_quarantine",
}

export enum WorkflowStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
  EXPIRED = "expired",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
}

export enum ApprovalDecision {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
}

export enum RiskLevel {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

export interface AdminWorkflowPolicy {
  id: string;
  actionType: SensitiveActionType;
  name: string;
  description: string;
  riskLevel: RiskLevel;
  requiredApprovals: number;
  allowedApproverRoles: string[];
  approvalTimeoutMinutes: number;
  allowedIpRanges?: string[];
  requireMfa: boolean;
  enabled: boolean;
  autoExecuteOnApproval: boolean;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminWorkflowInstance {
  id: string;
  policyId: string;
  actionType: SensitiveActionType;
  initiatorId: string;
  status: WorkflowStatus;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  expiresAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminWorkflowApproval {
  id: string;
  instanceId: string;
  approverId: string;
  decision: ApprovalDecision;
  comment?: string;
  decidedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWorkflowInstanceParams {
  actionType: SensitiveActionType;
  initiatorId: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ttlMinutes?: number;
}

export interface WorkflowApprovalResult {
  instance: AdminWorkflowInstance;
  approval: AdminWorkflowApproval;
  action: string;
}
