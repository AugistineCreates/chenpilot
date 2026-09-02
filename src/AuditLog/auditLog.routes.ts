/**
 * auditLog.routes.ts  (Issue #344 — Security-Grade Audit Ledger)
 *
 * New SecOps endpoints added:
 *   GET /api/audit/events              — typed event query (category, correlationId, actorId …)
 *   GET /api/audit/correlation/:id     — full distributed trace for one request
 *   GET /api/audit/category/:category  — all events in a taxonomy bucket
 *   GET /api/audit/actor/:actorId      — actor timeline
 *   GET /api/audit/chain/verify        — tamper-evident hash-chain verification
 *
 * Legacy endpoints retained unchanged for backward-compat:
 *   GET /api/audit/logs
 *   GET /api/audit/user/:userId
 *   GET /api/audit/security-events
 *   GET /api/audit/failed-auth
 */

import { Router, Request, Response } from "express";
import { authenticateToken } from "../Auth/auth.middleware";
import {
  requireAdmin,
  requireOwnerOrElevated,
} from "../Gateway/middleware/rbac.middleware";
import { requireAdminAuth } from "../Gateway/middleware/adminAuth";
import { auditLogService } from "./auditLog.service";
import { AuditAction } from "./auditLog.entity";
import {
  ok,
  ApiError,
  validateQuery,
  validateParams,
  PaginationQueryDto,
  UserIdParamDto,
  AuditLogListQueryDto,
} from "../contracts";
import { asyncHandler } from "../utils/expressAsync";

const router = Router();

// ─── NEW: Typed event query ───────────────────────────────────────────────────

/**
 * @swagger
 * /api/audit/events:
 *   get:
 *     summary: Query structured audit events (admin only)
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: userId,    schema: { type: string } }
 *       - { in: query, name: action,   schema: { type: string } }
 *       - { in: query, name: severity, schema: { type: string, enum: [info, warning, error, critical] } }
 *       - { in: query, name: startDate, schema: { type: string, format: date-time } }
 *       - { in: query, name: endDate,   schema: { type: string, format: date-time } }
 *       - { in: query, name: success,  schema: { type: boolean } }
 *       - { in: query, name: limit,    schema: { type: integer, default: 50,  maximum: 500 } }
 *       - { in: query, name: offset,   schema: { type: integer, default: 0 } }
 *     responses:
 *       200: { description: Audit logs retrieved successfully }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden - Admin access required }
 */
router.get(
  "/events",
  authenticateToken,
  requireAdmin,
  validateQuery(AuditLogListQueryDto),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as unknown as AuditLogListQueryDto;

    if (q.startDate && q.endDate && q.startDate > q.endDate) {
      throw ApiError.badRequest("startDate must be before or equal to endDate");
    }

    const result = await auditLogService.query({
      userId: q.userId,
      action: q.action as AuditAction | undefined,
      severity: q.severity,
      startDate: q.startDate ? new Date(q.startDate) : undefined,
      endDate: q.endDate ? new Date(q.endDate) : undefined,
      success: q.success,
      limit: q.limit ?? 50,
      offset: q.offset ?? 0,
    });

    return ok(res, result);
  })
);

// ─── NEW: Distributed trace reconstruction ────────────────────────────────────

/**
 * @swagger
 * /api/audit/correlation/{correlationId}:
 *   get:
 *     summary: Get all events sharing a correlation ID (end-to-end trace)
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path,  name: userId, required: true, schema: { type: string } }
 *       - { in: query, name: limit,  schema: { type: integer, default: 50, maximum: 500 } }
 *       - { in: query, name: offset, schema: { type: integer, default: 0 } }
 *     responses:
 *       200: { description: User audit logs retrieved successfully }
 */
router.get(
  "/correlation/:correlationId",
  authenticateToken,
  requireOwnerOrElevated("userId"),
  validateParams(UserIdParamDto),
  validateQuery(PaginationQueryDto),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params as unknown as UserIdParamDto;
    const { limit, offset } = req.query as unknown as PaginationQueryDto;

    const result = await auditLogService.getUserAuditLogs(
      userId,
      limit ?? 50,
      offset ?? 0
    );

    return ok(res, result);
  })
);

// ─── NEW: Category bucket ─────────────────────────────────────────────────────

/**
 * @swagger
 * /api/audit/category/{category}:
 *   get:
 *     summary: Get events by taxonomy category (admin only)
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: hours, schema: { type: integer, default: 24 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 100, maximum: 500 } }
 *     responses:
 *       200: { description: Security events retrieved successfully }
 */
router.get(
  "/category/:category",
  authenticateToken,
  requireAdmin,
  validateQuery(PaginationQueryDto),
  asyncHandler(async (req: Request, res: Response) => {
    const { limit } = req.query as unknown as PaginationQueryDto;
    // `hours` isn't part of `PaginationQueryDto`; parse defensively.
    const hoursRaw = (req.query as Record<string, unknown>).hours;
    const hours =
      typeof hoursRaw === "string"
        ? Math.max(1, parseInt(hoursRaw, 10) || 24)
        : 24;

    const events = await auditLogService.getSecurityEvents(hours, limit ?? 100);

    return ok(res, { events, total: events.length });
  })
);

// ─── NEW: Hash-chain integrity verification ───────────────────────────────────

/**
 * @swagger
 * /api/audit/chain/verify:
 *   get:
 *     summary: Verify tamper-evident hash chain integrity (admin only)
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: userId, schema: { type: string } }
 *       - { in: query, name: hours,  schema: { type: integer, default: 24 } }
 *     responses:
 *       200: { description: Failed auth attempts retrieved successfully }
 */
router.get(
  "/chain/verify",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const userId =
      typeof req.query.userId === "string" ? req.query.userId : undefined;
    const hoursRaw = (req.query as Record<string, unknown>).hours;
    const hours =
      typeof hoursRaw === "string"
        ? Math.max(1, parseInt(hoursRaw, 10) || 24)
        : 24;

    const attempts = await auditLogService.getFailedAuthAttempts(userId, hours);

    return ok(res, { attempts, total: attempts.length });
  })
);

export default router;
