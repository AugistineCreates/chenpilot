import { Router } from "express";
import { authenticateToken } from "../../Auth/auth.middleware";
import { requireAdminAuth } from "../../Gateway/middleware/adminAuth";
import { adminWorkflowService } from "./workflow.service";
import { SensitiveActionType, WorkflowStatus } from "./workflow.types";
import { auditLogService } from "../../AuditLog/auditLog.service";
import {
  AuditEventSeverity,
  EventCategory,
} from "../../AuditLog/auditEvent.types";
import logger from "../../config/logger";

const router = Router();

router.use(authenticateToken);

router.get("/policies", requireAdminAuth(), async (_req, res) => {
  try {
    const policies = await adminWorkflowService.getAllPolicies();
    return res.status(200).json({
      success: true,
      data: policies.map((p) => (p.toInterface ? p.toInterface() : p)),
      total: policies.length,
    });
  } catch (error) {
    logger.error("Error fetching workflow policies", { error });
    return res.status(500).json({
      success: false,
      message: "Failed to fetch workflow policies",
    });
  }
});

router.put("/policies/:actionType", requireAdminAuth(), async (req, res) => {
  try {
    const { actionType } = req.params;
    if (
      !Object.values(SensitiveActionType).includes(
        actionType as SensitiveActionType
      )
    ) {
      return res.status(400).json({
        success: false,
        message: `Invalid actionType. Must be one of: ${Object.values(SensitiveActionType).join(", ")}`,
      });
    }

    const updates = {
      ...req.body,
      allowedIpRanges: req.body.allowedIpRanges,
    };

    const policy = await adminWorkflowService.upsertPolicy(
      actionType as SensitiveActionType,
      updates
    );

    await auditLogService.logEvent({
      action: "admin.workflow.policy_updated",
      category: EventCategory.ADMIN,
      severity: AuditEventSeverity.WARNING,
      actor: { userId: req.user?.userId, roles: [req.user?.role] },
      resource: { type: "AdminWorkflowPolicy", id: policy.id },
      metadata: { actionType, updates },
      success: true,
    });

    return res.status(200).json({
      success: true,
      data: policy.toInterface ? policy.toInterface() : policy,
    });
  } catch (error) {
    logger.error("Error updating workflow policy", { error });
    return res.status(500).json({
      success: false,
      message: "Failed to update workflow policy",
    });
  }
});

router.post("/initiate", requireAdminAuth(), async (req, res) => {
  try {
    const { actionType, payload, metadata, ttlMinutes } = req.body;

    if (
      !actionType ||
      !Object.values(SensitiveActionType).includes(actionType)
    ) {
      return res.status(400).json({
        success: false,
        message: `Invalid actionType. Must be one of: ${Object.values(SensitiveActionType).join(", ")}`,
      });
    }

    const instance = await adminWorkflowService.initiateWorkflow({
      actionType,
      initiatorId: req.user!.userId,
      payload: payload || {},
      metadata,
      ttlMinutes,
    });

    return res.status(201).json({
      success: true,
      data: instance,
    });
  } catch (error) {
    logger.error("Error initiating workflow", { error });
    return res.status(400).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to initiate workflow",
    });
  }
});

router.get("/instances", requireAdminAuth(), async (req, res) => {
  try {
    const { actionType, status, initiatorId, limit, offset } = req.query;

    const result = await adminWorkflowService.getInstances({
      actionType: actionType as SensitiveActionType,
      status: status as WorkflowStatus,
      initiatorId: initiatorId as string,
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : 0,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error("Error fetching workflow instances", { error });
    return res.status(500).json({
      success: false,
      message: "Failed to fetch workflow instances",
    });
  }
});

router.get("/instances/:id", requireAdminAuth(), async (req, res) => {
  try {
    const instance = await adminWorkflowService.getInstance(req.params.id);

    if (!instance) {
      return res.status(404).json({
        success: false,
        message: "Workflow instance not found",
      });
    }

    const approvals = await adminWorkflowService.getApprovals(instance.id);

    return res.status(200).json({
      success: true,
      data: {
        instance,
        approvals,
      },
    });
  } catch (error) {
    logger.error("Error fetching workflow instance", { error });
    return res.status(500).json({
      success: false,
      message: "Failed to fetch workflow instance",
    });
  }
});

router.post("/instances/:id/approve", requireAdminAuth(), async (req, res) => {
  try {
    const { comment } = req.body;
    const result = await adminWorkflowService.approveInstance(
      req.params.id,
      req.user!.userId,
      comment
    );

    return res.status(200).json({
      success: true,
      message: "Workflow approved",
      data: result,
    });
  } catch (error) {
    logger.error("Error approving workflow", { error });
    return res.status(400).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to approve workflow",
    });
  }
});

router.post("/instances/:id/reject", requireAdminAuth(), async (req, res) => {
  try {
    const { comment } = req.body;
    const result = await adminWorkflowService.rejectInstance(
      req.params.id,
      req.user!.userId,
      comment
    );

    return res.status(200).json({
      success: true,
      message: "Workflow rejected",
      data: result,
    });
  } catch (error) {
    logger.error("Error rejecting workflow", { error });
    return res.status(400).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to reject workflow",
    });
  }
});

router.post("/instances/:id/complete", requireAdminAuth(), async (req, res) => {
  try {
    const instance = await adminWorkflowService.completeWorkflow(req.params.id);

    return res.status(200).json({
      success: true,
      message: "Workflow completed",
      data: instance,
    });
  } catch (error) {
    logger.error("Error completing workflow", { error });
    return res.status(400).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to complete workflow",
    });
  }
});

router.post("/instances/:id/cancel", requireAdminAuth(), async (req, res) => {
  try {
    const instance = await adminWorkflowService.cancelWorkflow(
      req.params.id,
      req.user!.userId
    );

    return res.status(200).json({
      success: true,
      message: "Workflow cancelled",
      data: instance,
    });
  } catch (error) {
    logger.error("Error cancelling workflow", { error });
    return res.status(400).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to cancel workflow",
    });
  }
});

router.get("/pending", requireAdminAuth(), async (req, res) => {
  try {
    const instances = await adminWorkflowService.getPendingApprovals(
      req.user!.userId
    );

    const instancesWithApprovals = await Promise.all(
      instances.map(async (instance) => {
        const approvals = await adminWorkflowService.getApprovals(instance.id);
        return { instance, approvals };
      })
    );

    return res.status(200).json({
      success: true,
      data: instancesWithApprovals,
      total: instances.length,
    });
  } catch (error) {
    logger.error("Error fetching pending approvals", { error });
    return res.status(500).json({
      success: false,
      message: "Failed to fetch pending approvals",
    });
  }
});

router.get("/review", requireAdminAuth(), async (_req, res) => {
  try {
    const pendingInstances = await adminWorkflowService.getInstances({
      status: WorkflowStatus.PENDING,
      limit: 100,
    });

    const approvedInstances = await adminWorkflowService.getInstances({
      status: WorkflowStatus.APPROVED,
      limit: 100,
    });

    const rejectedInstances = await adminWorkflowService.getInstances({
      status: WorkflowStatus.REJECTED,
      limit: 100,
    });

    return res.status(200).json({
      success: true,
      data: {
        pending: pendingInstances.instances,
        approved: approvedInstances.instances,
        rejected: rejectedInstances.instances,
        totals: {
          pending: pendingInstances.total,
          approved: approvedInstances.total,
          rejected: rejectedInstances.total,
        },
      },
    });
  } catch (error) {
    logger.error("Error fetching workflow review", { error });
    return res.status(500).json({
      success: false,
      message: "Failed to fetch workflow review",
    });
  }
});

export default router;
