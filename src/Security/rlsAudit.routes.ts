import { Router, Request, Response } from "express";
import { authenticateToken } from "../Auth/auth.middleware";
import { requireAdmin } from "../Gateway/middleware/rbac.middleware";
import { rlsAuditService } from "./rlsAudit.service";
import logger from "../config/logger";

const router = Router();

/**
 * @swagger
 * /api/security/rls-audit/logs:
 *   get:
 *     summary: Query RLS bypass audit logs
 *     tags: [Security]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: executedBy
 *         schema:
 *           type: string
 *       - in: query
 *         name: operation
 *         schema:
 *           type: string
 *       - in: query
 *         name: tableName
 *         schema:
 *           type: string
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: List of RLS bypass audit logs
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin only
 */
router.get(
  "/logs",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const filters = {
        executedBy: req.query.executedBy as string | undefined,
        operation: req.query.operation as string | undefined,
        tableName: req.query.tableName as string | undefined,
        startDate: req.query.startDate
          ? new Date(req.query.startDate as string)
          : undefined,
        endDate: req.query.endDate
          ? new Date(req.query.endDate as string)
          : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 100,
      };

      const logs = await rlsAuditService.queryBypassLogs(filters);

      return res.status(200).json({
        success: true,
        count: logs.length,
        logs,
      });
    } catch (error) {
      logger.error("Error querying RLS bypass logs", { error, query: req.query });
      return res.status(500).json({
        success: false,
        message: "Failed to query audit logs",
      });
    }
  }
);

/**
 * @swagger
 * /api/security/rls-audit/stats:
 *   get:
 *     summary: Get RLS bypass statistics
 *     tags: [Security]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: timeWindow
 *         schema:
 *           type: number
 *           description: Time window in hours (default 24)
 *     responses:
 *       200:
 *         description: RLS bypass statistics
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin only
 */
router.get(
  "/stats",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const timeWindow = req.query.timeWindow
        ? parseInt(req.query.timeWindow as string, 10)
        : 24;

      const stats = await rlsAuditService.getBypassStatistics(timeWindow);

      return res.status(200).json({
        success: true,
        timeWindow,
        stats,
      });
    } catch (error) {
      logger.error("Error fetching RLS bypass stats", { error });
      return res.status(500).json({
        success: false,
        message: "Failed to fetch statistics",
      });
    }
  }
);

export default router;
