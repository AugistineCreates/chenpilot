import AppDataSource from "../../config/Datasource";
import {
  AdminWorkflowPolicy,
  AdminWorkflowInstance,
  AdminWorkflowApproval,
} from "./workflow.entity";
import {
  SensitiveActionType,
  WorkflowStatus,
  ApprovalDecision,
  CreateWorkflowInstanceParams,
  WorkflowApprovalResult,
  AdminWorkflowPolicy as IAdminWorkflowPolicy,
  RiskLevel,
} from "./workflow.types";
import { auditLogService } from "../../AuditLog/auditLog.service";
import {
  AuditEventSeverity,
  EventCategory,
} from "../../AuditLog/auditEvent.types";
import { toolRegistry } from "../registry/ToolRegistry";
import { promptRolloutService } from "../registry/PromptRolloutService";
import logger from "../../config/logger";

const POLICY_REPOSITORY = () =>
  AppDataSource.getRepository(AdminWorkflowPolicy);
const INSTANCE_REPOSITORY = () =>
  AppDataSource.getRepository(AdminWorkflowInstance);
const APPROVAL_REPOSITORY = () =>
  AppDataSource.getRepository(AdminWorkflowApproval);

const DEFAULT_POLICIES: Omit<
  IAdminWorkflowPolicy,
  "id" | "createdAt" | "updatedAt"
>[] = [
  {
    actionType: SensitiveActionType.ENABLE_TOOL,
    name: "Enable Tool",
    description: "Enable a tool in the agent registry",
    riskLevel: RiskLevel.MEDIUM,
    requiredApprovals: 1,
    allowedApproverRoles: ["admin"],
    approvalTimeoutMinutes: 60,
    requireMfa: false,
    enabled: true,
    autoExecuteOnApproval: true,
  },
  {
    actionType: SensitiveActionType.DISABLE_TOOL,
    name: "Disable Tool",
    description: "Disable a tool in the agent registry",
    riskLevel: RiskLevel.MEDIUM,
    requiredApprovals: 1,
    allowedApproverRoles: ["admin"],
    approvalTimeoutMinutes: 60,
    requireMfa: false,
    enabled: true,
    autoExecuteOnApproval: true,
  },
  {
    actionType: SensitiveActionType.ACTIVATE_PROMPT,
    name: "Activate Prompt Version",
    description: "Activate a prompt version as the production rollout",
    riskLevel: RiskLevel.HIGH,
    requiredApprovals: 1,
    allowedApproverRoles: ["admin"],
    approvalTimeoutMinutes: 120,
    requireMfa: true,
    enabled: true,
    autoExecuteOnApproval: true,
  },
  {
    actionType: SensitiveActionType.UPDATE_PROMPT,
    name: "Update Prompt Version",
    description: "Update content or settings of a prompt version",
    riskLevel: RiskLevel.MEDIUM,
    requiredApprovals: 1,
    allowedApproverRoles: ["admin"],
    approvalTimeoutMinutes: 60,
    requireMfa: false,
    enabled: true,
    autoExecuteOnApproval: false,
  },
  {
    actionType: SensitiveActionType.DELETE_PROMPT,
    name: "Delete Prompt Version",
    description: "Permanently delete a prompt version",
    riskLevel: RiskLevel.HIGH,
    requiredApprovals: 2,
    allowedApproverRoles: ["admin"],
    approvalTimeoutMinutes: 120,
    requireMfa: true,
    enabled: true,
    autoExecuteOnApproval: false,
  },
  {
    actionType: SensitiveActionType.MODIFY_STRATEGY_SETTINGS,
    name: "Modify Strategy Settings",
    description: "Alter trading strategy or execution parameters",
    riskLevel: RiskLevel.CRITICAL,
    requiredApprovals: 2,
    allowedApproverRoles: ["admin"],
    approvalTimeoutMinutes: 240,
    requireMfa: true,
    enabled: true,
    autoExecuteOnApproval: false,
  },
  {
    actionType: SensitiveActionType.MODIFY_SECURITY_POSTURE,
    name: "Modify Security Posture",
    description:
      "Change rate limits, IP whitelists, blacklists, or auth settings",
    riskLevel: RiskLevel.CRITICAL,
    requiredApprovals: 2,
    allowedApproverRoles: ["admin"],
    approvalTimeoutMinutes: 240,
    requireMfa: true,
    enabled: true,
    autoExecuteOnApproval: false,
  },
  {
    actionType: SensitiveActionType.PURGE_AUDIT_LOGS,
    name: "Purge Audit Logs",
    description: "Delete audit log entries",
    riskLevel: RiskLevel.CRITICAL,
    requiredApprovals: 2,
    allowedApproverRoles: ["admin"],
    approvalTimeoutMinutes: 240,
    requireMfa: true,
    enabled: true,
    autoExecuteOnApproval: false,
  },
  {
    actionType: SensitiveActionType.UPDATE_IP_BLACKLIST,
    name: "Update IP Blacklist",
    description: "Add or remove IP addresses from the blacklist",
    riskLevel: RiskLevel.HIGH,
    requiredApprovals: 1,
    allowedApproverRoles: ["admin"],
    approvalTimeoutMinutes: 120,
    requireMfa: true,
    enabled: true,
    autoExecuteOnApproval: true,
  },
  {
    actionType: SensitiveActionType.MODIFY_RATE_LIMITS,
    name: "Modify Rate Limits",
    description: "Change abuse-prevention rate limit thresholds",
    riskLevel: RiskLevel.HIGH,
    requiredApprovals: 1,
    allowedApproverRoles: ["admin"],
    approvalTimeoutMinutes: 120,
    requireMfa: true,
    enabled: true,
    autoExecuteOnApproval: true,
  },
  {
    actionType: SensitiveActionType.UPDATE_ADMIN_ALLOWED_IPS,
    name: "Update Admin Allowed IPs",
    description: "Change the IP whitelist for admin endpoints",
    riskLevel: RiskLevel.HIGH,
    requiredApprovals: 1,
    allowedApproverRoles: ["admin"],
    approvalTimeoutMinutes: 120,
    requireMfa: true,
    enabled: true,
    autoExecuteOnApproval: true,
  },
  {
    actionType: SensitiveActionType.INTERVENTION_COMPENSATE,
    name: "Intervention: Compensate Step",
    description:
      "Apply a compensating transaction to undo the side-effects of a completed execution step. " +
      "Requires proof of an on-chain compensating transaction.",
    riskLevel: RiskLevel.CRITICAL,
    requiredApprovals: 2,
    allowedApproverRoles: ["admin"],
    approvalTimeoutMinutes: 120,
    requireMfa: true,
    enabled: true,
    autoExecuteOnApproval: true,
  },
  {
    actionType: SensitiveActionType.INTERVENTION_QUARANTINE,
    name: "Intervention: Quarantine Execution",
    description:
      "Freeze a running or failed execution to prevent automated retries while an investigation is conducted.",
    riskLevel: RiskLevel.CRITICAL,
    requiredApprovals: 2,
    allowedApproverRoles: ["admin"],
    approvalTimeoutMinutes: 120,
    requireMfa: true,
    enabled: true,
    autoExecuteOnApproval: true,
  },
];

export class AdminWorkflowService {
  private initialized = false;

  async initializeDefaultPolicies(): Promise<void> {
    if (this.initialized) return;

    const repo = POLICY_REPOSITORY();
    const existingCount = await repo.count();

    if (existingCount === 0) {
      for (const policy of DEFAULT_POLICIES) {
        const entity = repo.create(policy);
        await repo.save(entity);
      }
      logger.info("Default admin workflow policies initialized", {
        count: DEFAULT_POLICIES.length,
      });
    }

    this.initialized = true;
  }

  async getPolicy(
    actionType: SensitiveActionType
  ): Promise<AdminWorkflowPolicy | null> {
    return POLICY_REPOSITORY().findOne({
      where: { actionType, enabled: true },
    });
  }

  async getAllPolicies(): Promise<AdminWorkflowPolicy[]> {
    return POLICY_REPOSITORY().find({
      order: { createdAt: "ASC" },
    });
  }

  async upsertPolicy(
    actionType: SensitiveActionType,
    updates: Partial<IAdminWorkflowPolicy>
  ): Promise<AdminWorkflowPolicy> {
    const repo = POLICY_REPOSITORY();
    let policy = await repo.findOne({ where: { actionType } });

    if (!policy) {
      policy = repo.create({
        actionType,
        name: updates.name || String(actionType),
        description: updates.description || "",
        riskLevel: updates.riskLevel || RiskLevel.MEDIUM,
        requiredApprovals: updates.requiredApprovals ?? 1,
        allowedApproverRoles: updates.allowedApproverRoles || ["admin"],
        approvalTimeoutMinutes: updates.approvalTimeoutMinutes || 60,
        allowedIpRanges: Array.isArray(updates.allowedIpRanges)
          ? updates.allowedIpRanges.join(",")
          : updates.allowedIpRanges,
        requireMfa: updates.requireMfa ?? false,
        enabled: updates.enabled ?? true,
        autoExecuteOnApproval: updates.autoExecuteOnApproval ?? false,
        metadata: updates.metadata,
      });
    } else {
      if (updates.name !== undefined) policy.name = updates.name;
      if (updates.description !== undefined)
        policy.description = updates.description;
      if (updates.riskLevel !== undefined) policy.riskLevel = updates.riskLevel;
      if (updates.requiredApprovals !== undefined)
        policy.requiredApprovals = updates.requiredApprovals;
      if (updates.allowedApproverRoles !== undefined)
        policy.allowedApproverRoles = updates.allowedApproverRoles;
      if (updates.approvalTimeoutMinutes !== undefined)
        policy.approvalTimeoutMinutes = updates.approvalTimeoutMinutes;
      if (updates.allowedIpRanges !== undefined) {
        policy.allowedIpRanges = Array.isArray(updates.allowedIpRanges)
          ? updates.allowedIpRanges.join(",")
          : updates.allowedIpRanges;
      }
      if (updates.requireMfa !== undefined)
        policy.requireMfa = updates.requireMfa;
      if (updates.enabled !== undefined) policy.enabled = updates.enabled;
      if (updates.autoExecuteOnApproval !== undefined)
        policy.autoExecuteOnApproval = updates.autoExecuteOnApproval;
      if (updates.metadata !== undefined) policy.metadata = updates.metadata;
    }

    const saved = await repo.save(policy);
    logger.info("Admin workflow policy updated", {
      policyId: saved.id,
      actionType,
    });
    return saved;
  }

  async initiateWorkflow(
    params: CreateWorkflowInstanceParams
  ): Promise<AdminWorkflowInstance> {
    const policy = await this.getPolicy(params.actionType);

    if (!policy) {
      throw new Error(
        `No enabled workflow policy found for action: ${params.actionType}`
      );
    }

    const ttlMinutes = params.ttlMinutes || policy.approvalTimeoutMinutes;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

    const instance = INSTANCE_REPOSITORY().create({
      policyId: policy.id,
      actionType: params.actionType,
      initiatorId: params.initiatorId,
      status: WorkflowStatus.PENDING,
      payload: params.payload,
      metadata: params.metadata,
      expiresAt,
    });

    const saved = await INSTANCE_REPOSITORY().save(instance);

    await auditLogService.logEvent({
      action: "admin.workflow.initiated",
      category: EventCategory.ADMIN,
      severity: AuditEventSeverity.WARNING,
      actor: { userId: params.initiatorId, roles: [] },
      resource: {
        endpoint: `workflow:${params.actionType}`,
        type: "AdminWorkflowInstance",
        id: saved.id,
      },
      metadata: {
        actionType: params.actionType,
        policyId: policy.id,
        requiredApprovals: policy.requiredApprovals,
        riskLevel: policy.riskLevel,
        expiresAt: expiresAt.toISOString(),
        ...params.metadata,
      },
      success: true,
    });

    logger.info("Admin workflow instance created", {
      instanceId: saved.id,
      actionType: params.actionType,
      policyId: policy.id,
    });

    return saved;
  }

  async getPendingApprovals(
    approverId: string
  ): Promise<AdminWorkflowInstance[]> {
    const allApprovals = await APPROVAL_REPOSITORY().find({
      where: { approverId, decision: ApprovalDecision.PENDING },
      relations: ["instance"],
    });

    const instanceIds = allApprovals.map((a) => a.instanceId);

    if (instanceIds.length === 0) {
      return [];
    }

    const instances = await INSTANCE_REPOSITORY()
      .createQueryBuilder("instance")
      .where("instance.id IN (:...ids)", { ids: instanceIds })
      .andWhere("instance.status = :status", { status: WorkflowStatus.PENDING })
      .andWhere("instance.expiresAt > NOW()")
      .orderBy("instance.createdAt", "DESC")
      .getMany();

    return instances;
  }

  async approveInstance(
    instanceId: string,
    approverId: string,
    comment?: string
  ): Promise<WorkflowApprovalResult> {
    const instance = await INSTANCE_REPOSITORY().findOne({
      where: { id: instanceId },
    });

    if (!instance) {
      throw new Error("Workflow instance not found");
    }

    if (instance.status !== WorkflowStatus.PENDING) {
      throw new Error(
        `Workflow is not pending (current status: ${instance.status})`
      );
    }

    if (instance.expiresAt < new Date()) {
      instance.status = WorkflowStatus.EXPIRED;
      await INSTANCE_REPOSITORY().save(instance);
      throw new Error("Workflow has expired");
    }

    const policy = await POLICY_REPOSITORY().findOne({
      where: { id: instance.policyId },
    });

    if (!policy) {
      throw new Error("Workflow policy not found");
    }

    const existing = await APPROVAL_REPOSITORY().findOne({
      where: { instanceId, approverId },
    });

    const approval =
      existing ||
      APPROVAL_REPOSITORY().create({
        instanceId,
        approverId,
        decision: ApprovalDecision.APPROVED,
        comment,
        decidedAt: new Date(),
      });

    if (!existing) {
      await APPROVAL_REPOSITORY().save(approval);
    } else {
      approval.decision = ApprovalDecision.APPROVED;
      approval.comment = comment;
      approval.decidedAt = new Date();
      await APPROVAL_REPOSITORY().save(approval);
    }

    const approvalCount = await APPROVAL_REPOSITORY().count({
      where: {
        instanceId,
        decision: ApprovalDecision.APPROVED,
      },
    });

    let shouldAutoExecute = false;

    if (approvalCount >= policy.requiredApprovals) {
      instance.status = WorkflowStatus.APPROVED;
      await INSTANCE_REPOSITORY().save(instance);
      shouldAutoExecute = policy.autoExecuteOnApproval;

      await auditLogService.logEvent({
        action: "admin.workflow.approved",
        category: EventCategory.ADMIN,
        severity: AuditEventSeverity.WARNING,
        actor: { userId: approverId, roles: [] },
        resource: {
          endpoint: `workflow:${instance.actionType}`,
          type: "AdminWorkflowInstance",
          id: instance.id,
        },
        metadata: {
          actionType: instance.actionType,
          approvalCount,
          requiredApprovals: policy.requiredApprovals,
          autoExecute: policy.autoExecuteOnApproval,
        },
        success: true,
      });
    }

    logger.info("Admin workflow approved", {
      instanceId,
      approverId,
      approvalCount,
      requiredApprovals: policy.requiredApprovals,
    });

    const result: WorkflowApprovalResult = {
      instance,
      approval,
      action: "approved",
    };

    if (shouldAutoExecute) {
      try {
        await this.executeWorkflowAction(instance);
      } catch (execError) {
        logger.error("Auto-execution of approved workflow failed", {
          instanceId,
          error: execError,
        });
      }
    }

    return result;
  }

  async rejectInstance(
    instanceId: string,
    approverId: string,
    comment?: string
  ): Promise<WorkflowApprovalResult> {
    const instance = await INSTANCE_REPOSITORY().findOne({
      where: { id: instanceId },
    });

    if (!instance) {
      throw new Error("Workflow instance not found");
    }

    if (instance.status !== WorkflowStatus.PENDING) {
      throw new Error(
        `Workflow is not pending (current status: ${instance.status})`
      );
    }

    const existing = await APPROVAL_REPOSITORY().findOne({
      where: { instanceId, approverId },
    });

    const approval =
      existing ||
      APPROVAL_REPOSITORY().create({
        instanceId,
        approverId,
        decision: ApprovalDecision.REJECTED,
        comment,
        decidedAt: new Date(),
      });

    if (!existing) {
      await APPROVAL_REPOSITORY().save(approval);
    } else {
      approval.decision = ApprovalDecision.REJECTED;
      approval.comment = comment;
      approval.decidedAt = new Date();
      await APPROVAL_REPOSITORY().save(approval);
    }

    instance.status = WorkflowStatus.REJECTED;
    await INSTANCE_REPOSITORY().save(instance);

    await auditLogService.logEvent({
      action: "admin.workflow.rejected",
      category: EventCategory.ADMIN,
      severity: AuditEventSeverity.WARNING,
      actor: { userId: approverId, roles: [] },
      resource: {
        endpoint: `workflow:${instance.actionType}`,
        type: "AdminWorkflowInstance",
        id: instance.id,
      },
      metadata: {
        actionType: instance.actionType,
        comment,
      },
      success: true,
    });

    logger.info("Admin workflow rejected", {
      instanceId,
      approverId,
      comment,
    });

    return { instance, approval, action: "rejected" };
  }

  async completeWorkflow(instanceId: string): Promise<AdminWorkflowInstance> {
    const instance = await INSTANCE_REPOSITORY().findOne({
      where: { id: instanceId },
    });

    if (!instance) {
      throw new Error("Workflow instance not found");
    }

    if (instance.status !== WorkflowStatus.APPROVED) {
      throw new Error(
        `Workflow is not approved (current status: ${instance.status})`
      );
    }

    instance.status = WorkflowStatus.COMPLETED;
    instance.completedAt = new Date();
    await INSTANCE_REPOSITORY().save(instance);

    await auditLogService.logEvent({
      action: "admin.workflow.completed",
      category: EventCategory.ADMIN,
      severity: AuditEventSeverity.WARNING,
      resource: {
        endpoint: `workflow:${instance.actionType}`,
        type: "AdminWorkflowInstance",
        id: instance.id,
      },
      metadata: {
        actionType: instance.actionType,
        initiatorId: instance.initiatorId,
      },
      success: true,
    });

    logger.info("Admin workflow completed", {
      instanceId,
      actionType: instance.actionType,
    });

    return instance;
  }

  async executeWorkflowAction(instance: AdminWorkflowInstance): Promise<void> {
    const { actionType, payload } = instance;

    switch (actionType) {
      case SensitiveActionType.ENABLE_TOOL: {
        const toolName = (payload.toolName || payload.body?.toolName) as
          | string
          | undefined;
        if (!toolName) throw new Error("Missing toolName in workflow payload");
        const tool = toolRegistry.getTool(toolName);
        if (!tool) throw new Error(`Tool '${toolName}' not found`);
        break;
      }
      case SensitiveActionType.DISABLE_TOOL: {
        const toolName = (payload.toolName || payload.body?.toolName) as
          | string
          | undefined;
        if (!toolName) throw new Error("Missing toolName in workflow payload");
        const tool = toolRegistry.getTool(toolName);
        if (!tool) throw new Error(`Tool '${toolName}' not found`);
        break;
      }
      case SensitiveActionType.ACTIVATE_PROMPT: {
        const promptId = (payload.promptId ||
          payload.params?.id ||
          payload.body?.promptId) as string | undefined;
        if (!promptId) throw new Error("Missing promptId in workflow payload");
        const rollbackVersionId = (payload.rollbackVersionId ||
          payload.body?.rollbackVersionId) as string | undefined;
        await promptRolloutService.activateWithPolicy(
          promptId,
          rollbackVersionId
        );
        break;
      }
      case SensitiveActionType.INTERVENTION_COMPENSATE:
      case SensitiveActionType.INTERVENTION_QUARANTINE: {
        // Lazy-require to avoid circular imports at module load time
        const { interventionService } = await import(
          "../planner/intervention.service"
        );
        const interventionId = payload.interventionId as string | undefined;
        if (!interventionId) {
          throw new Error(
            "Missing interventionId in workflow payload for intervention action"
          );
        }
        await interventionService.applyApproved(interventionId, instance.id);
        break;
      }
      default:
        logger.warn("No auto-executor for workflow action type", {
          actionType,
        });
        return;
    }

    await this.completeWorkflow(instance.id);
  }

  async cancelWorkflow(
    instanceId: string,
    cancelledBy: string
  ): Promise<AdminWorkflowInstance> {
    const instance = await INSTANCE_REPOSITORY().findOne({
      where: { id: instanceId },
    });

    if (!instance) {
      throw new Error("Workflow instance not found");
    }

    if (
      ![WorkflowStatus.PENDING, WorkflowStatus.APPROVED].includes(
        instance.status
      )
    ) {
      throw new Error(`Cannot cancel workflow in status: ${instance.status}`);
    }

    instance.status = WorkflowStatus.CANCELLED;
    await INSTANCE_REPOSITORY().save(instance);

    await auditLogService.logEvent({
      action: "admin.workflow.cancelled",
      category: EventCategory.ADMIN,
      severity: AuditEventSeverity.WARNING,
      actor: { userId: cancelledBy, roles: [] },
      resource: {
        endpoint: `workflow:${instance.actionType}`,
        type: "AdminWorkflowInstance",
        id: instance.id,
      },
      metadata: {
        actionType: instance.actionType,
        initiatorId: instance.initiatorId,
      },
      success: true,
    });

    logger.info("Admin workflow cancelled", {
      instanceId,
      cancelledBy,
    });

    return instance;
  }

  async getInstance(instanceId: string): Promise<AdminWorkflowInstance | null> {
    return INSTANCE_REPOSITORY().findOne({
      where: { id: instanceId },
    });
  }

  async getInstances(filters?: {
    actionType?: SensitiveActionType;
    status?: WorkflowStatus;
    initiatorId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ instances: AdminWorkflowInstance[]; total: number }> {
    const qb = INSTANCE_REPOSITORY().createQueryBuilder("instance");

    if (filters?.actionType) {
      qb.andWhere("instance.actionType = :actionType", {
        actionType: filters.actionType,
      });
    }
    if (filters?.status) {
      qb.andWhere("instance.status = :status", { status: filters.status });
    }
    if (filters?.initiatorId) {
      qb.andWhere("instance.initiatorId = :initiatorId", {
        initiatorId: filters.initiatorId,
      });
    }

    const total = await qb.getCount();
    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;

    qb.orderBy("instance.createdAt", "DESC").skip(offset).take(limit);
    const instances = await qb.getMany();

    return { instances, total };
  }

  async getApprovals(instanceId: string): Promise<AdminWorkflowApproval[]> {
    return APPROVAL_REPOSITORY().find({
      where: { instanceId },
      order: { createdAt: "ASC" },
    });
  }

  async expireOldInstances(): Promise<number> {
    const result = await INSTANCE_REPOSITORY()
      .createQueryBuilder()
      .update(AdminWorkflowInstance)
      .set({ status: WorkflowStatus.EXPIRED })
      .where("status = :status", { status: WorkflowStatus.PENDING })
      .andWhere("expiresAt <= NOW()")
      .execute();

    const count = result.affected ?? 0;
    if (count > 0) {
      logger.info("Expired old admin workflow instances", { count });
    }
    return count;
  }
}

export const adminWorkflowService = new AdminWorkflowService();
