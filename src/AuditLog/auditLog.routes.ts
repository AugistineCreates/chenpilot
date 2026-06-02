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
import { auditLogService } from "./auditLog.service";
import { AuditAction, AuditSeverity } from "./auditLog.entity";
import {
  EventCategory,
  AuditEventSeverity,
  AuditEventAction,
} from "./auditEvent.types";

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
 *       - in: query
 *         name: correlationId
 *         schema: { type: string }
 *         description: Filter by distributed trace ID
 *       - in: query
 *         name: category
 *         schema: { type: string, enum: [Auth, Admin, Execution, Policy, Integration] }
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *       - in: query
 *         name: action
 *         schema: { type: string }
 *       - in: query
 *         name: severity
 *         schema: { type: string, enum: [info, warning, error, critical] }
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: success
 *         schema: { type: boolean }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: Events retrieved
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get(
  "/events",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const {
        correlationId,
        category,
        userId,
        action,
        severity,
        startDate,
        endDate,
        success,
        limit,
        offset,
      } = req.query;

      const result = await auditLogService.queryEvents({
        correlationId: correlationId as string,
        category: category as EventCategory,
        userId: userId as string,
        action: action as AuditEventAction,
        severity: severity as AuditEventSeverity,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        success:
          success === "true" ? true : success === "false" ? false : undefined,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });

      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      console.error("Error fetching audit events:", error);
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch audit events" });
    }
  }
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
 *       - in: path
 *         name: correlationId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Trace events retrieved
 */
router.get(
  "/correlation/:correlationId",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { correlationId } = req.params;
      const events = await auditLogService.getByCorrelationId(correlationId);
      return res
        .status(200)
        .json({ success: true, correlationId, events, total: events.length });
    } catch (error) {
      console.error("Error fetching correlated events:", error);
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch correlated events" });
    }
  }
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
 *       - in: path
 *         name: category
 *         required: true
 *         schema: { type: string, enum: [Auth, Admin, Execution, Policy, Integration] }
 *       - in: query
 *         name: hours
 *         schema: { type: integer, default: 24 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 100 }
 */
router.get(
  "/category/:category",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { category } = req.params;
      const { hours, limit } = req.query;

      const validCategories = Object.values(EventCategory) as string[];
      if (!validCategories.includes(category)) {
        return res.status(400).json({
          success: false,
          message: `Invalid category. Must be one of: ${validCategories.join(", ")}`,
        });
      }

      const events = await auditLogService.getByCategory(
        category as EventCategory,
        hours ? parseInt(hours as string, 10) : 24,
        limit ? parseInt(limit as string, 10) : 100
      );
      return res
        .status(200)
        .json({ success: true, category, events, total: events.length });
    } catch (error) {
      console.error("Error fetching events by category:", error);
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch events by category" });
    }
  }
);

// ─── NEW: Actor timeline ──────────────────────────────────────────────────────

/**
 * @swagger
 * /api/audit/actor/{actorId}:
 *   get:
 *     summary: Get the full event timeline for an actor
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: actorId
 *         required: true
 *         schema: { type: string }
 */
router.get(
  "/actor/:actorId",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { actorId } = req.params;
      const { limit, offset } = req.query;

      const result = await auditLogService.getActorTimeline(
        actorId,
        limit ? parseInt(limit as string, 10) : 50,
        offset ? parseInt(offset as string, 10) : 0
      );
      return res.status(200).json({ success: true, actorId, ...result });
    } catch (error) {
      console.error("Error fetching actor timeline:", error);
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch actor timeline" });
    }
  }
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
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 1000 }
 *         description: Number of recent events to verify
 */
router.get(
  "/chain/verify",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { limit } = req.query;
      const result = await auditLogService.verifyChainIntegrity(
        limit ? parseInt(limit as string, 10) : 1000
      );
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      console.error("Error verifying audit chain:", error);
      return res
        .status(500)
        .json({ success: false, message: "Failed to verify audit chain" });
    }
  }
);

// ─── LEGACY: All original endpoints unchanged ─────────────────────────────────

router.get(
  "/logs",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const {
        userId,
        action,
        severity,
        startDate,
        endDate,
        success,
        limit,
        offset,
      } = req.query;

      const result = await auditLogService.query({
        userId: userId as string,
        action: action as AuditAction,
        severity: severity as AuditSeverity,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        success:
          success === "true" ? true : success === "false" ? false : undefined,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });

      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      console.error("Error fetching audit logs:", error);
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch audit logs" });
    }
  }
);

router.get(
  "/user/:userId",
  authenticateToken,
  requireOwnerOrElevated("userId"),
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { limit, offset } = req.query;

      const result = await auditLogService.getUserAuditLogs(
        userId,
        limit ? parseInt(limit as string, 10) : 50,
        offset ? parseInt(offset as string, 10) : 0
      );

      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      console.error("Error fetching user audit logs:", error);
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch user audit logs" });
    }
  }
);

router.get(
  "/security-events",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { hours, limit } = req.query;

      const events = await auditLogService.getSecurityEvents(
        hours ? parseInt(hours as string, 10) : 24,
        limit ? parseInt(limit as string, 10) : 100
      );

      return res
        .status(200)
        .json({ success: true, events, total: events.length });
    } catch (error) {
      console.error("Error fetching security events:", error);
      return res
        .status(500)
        .json({ success: false, message: "Failed to fetch security events" });
    }
  }
);

router.get(
  "/failed-auth",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { userId, hours } = req.query;

      const attempts = await auditLogService.getFailedAuthAttempts(
        userId as string,
        hours ? parseInt(hours as string, 10) : 24
      );

      return res
        .status(200)
        .json({ success: true, attempts, total: attempts.length });
    } catch (error) {
      console.error("Error fetching failed auth attempts:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch failed auth attempts",
      });
    }
  }
);

export default router;
