import { Request, Response, NextFunction } from "express";
import { SensitiveActionType } from "./workflow.types";
import { adminWorkflowService } from "./workflow.service";
import { UserRole } from "../../Auth/roles";
import { auditLogService } from "../../AuditLog/auditLog.service";
import {
  AuditEventSeverity,
  EventCategory,
} from "../../AuditLog/auditEvent.types";
import logger from "../../config/logger";

export function requireAdminWorkflow(actionType: SensitiveActionType) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: "Authentication required",
        });
        return;
      }

      const policy = await adminWorkflowService.getPolicy(actionType);

      if (!policy || !policy.enabled) {
        next();
        return;
      }

      const userRole = req.user.role as UserRole;
      const allowedRoles = policy.allowedApproverRoles;
      const hasRole = allowedRoles.some((role) =>
        hasRequiredRole(userRole, role as UserRole)
      );

      if (!hasRole) {
        await auditLogService.logEvent({
          action: "admin.workflow.permission_denied",
          category: EventCategory.POLICY,
          severity: AuditEventSeverity.WARNING,
          actor: { userId: req.user.userId, roles: [userRole] },
          resource: { endpoint: req.path },
          metadata: { actionType, policyId: policy.id },
          success: false,
        });

        res.status(403).json({
          success: false,
          message: "Insufficient permissions for this workflow action",
        });
        return;
      }

      const instance = await adminWorkflowService.initiateWorkflow({
        actionType,
        initiatorId: req.user.userId,
        payload: {
          method: req.method,
          path: req.path,
          body: req.body,
          query: req.query,
          params: req.params,
        },
        metadata: {
          ipAddress:
            ((req.headers["x-forwarded-for"] as string) ?? "")
              .split(",")[0]
              ?.trim() ||
            (req.headers["x-real-ip"] as string) ||
            req.socket.remoteAddress ||
            "unknown",
          userAgent: req.headers["user-agent"],
        },
      });

      res.status(202).json({
        success: true,
        message: "Workflow initiated. Awaiting approval.",
        data: {
          instanceId: instance.id,
          actionType: instance.actionType,
          status: instance.status,
          expiresAt: instance.expiresAt,
          requiredApprovals: policy.requiredApprovals,
          riskLevel: policy.riskLevel,
        },
      });
    } catch (error) {
      logger.error("Workflow middleware error", { error });
      res.status(500).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Workflow initialization failed",
      });
    }
  };
}
