import express, { Router, Request, Response, NextFunction } from "express";
import { ipBlacklistService } from "./ipBlacklist.service";
import { BlacklistReason } from "./ipBlacklist.entity";
import { authenticate } from "../Auth/auth";
import logger from "../config/logger";

const router = Router();

/**
 * Admin middleware - verify user is admin
 * Can be customized based on actual role management
 */
const isAdmin = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;

  if (!user || user.role !== "admin") {
    return res.status(403).json({
      success: false,
      error: "Forbidden",
      message: "Only administrators can manage IP blacklist",
    });
  }

  next();
};

/**
 * Check if an IP is blacklisted
 * GET /security/blacklist/check/:ip
 */
router.get("/check/:ip", authenticate, async (req: Request, res: Response) => {
  try {
    const { ip } = req.params;

    const isBlacklisted = await ipBlacklistService.isBlacklisted(ip);
    const entry = await ipBlacklistService.getBlacklistEntry(ip);

    res.json({
      success: true,
      data: {
        isBlacklisted,
        entry,
      },
    });
  } catch (error) {
    logger.error("Error checking blacklist status", { error });
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: "Failed to check blacklist status",
    });
  }
});

/**
 * List all blacklisted IPs
 * GET /security/blacklist?limit=50&offset=0&activeOnly=true&reason=malicious_activity
 */
router.get("/", authenticate, isAdmin, async (req: Request, res: Response) => {
  try {
    const { limit = 50, offset = 0, activeOnly = "true", reason } = req.query;

    const options = {
      limit: Math.min(parseInt(limit as string) || 50, 500),
      offset: Math.max(parseInt(offset as string) || 0, 0),
      activeOnly: activeOnly === "true",
      reason: reason as BlacklistReason | undefined,
    };

    const result = await ipBlacklistService.listBlacklist(options);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error("Error listing blacklist", { error });
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: "Failed to list blacklist",
    });
  }
});

/**
 * Get blacklist statistics
 * GET /security/blacklist/stats
 */
router.get(
  "/stats",
  authenticate,
  isAdmin,
  async (req: Request, res: Response) => {
    try {
      const stats = await ipBlacklistService.getStatistics();

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error("Error getting blacklist statistics", { error });
      res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to retrieve statistics",
      });
    }
  }
);

/**
 * Add an IP to the blacklist
 * POST /security/blacklist
 */
router.post("/", authenticate, isAdmin, async (req: Request, res: Response) => {
  try {
    const {
      ipAddress,
      reason = BlacklistReason.MALICIOUS_ACTIVITY,
      description,
      expiresAt,
      metadata,
    } = req.body;

    // Validate input
    if (!ipAddress || typeof ipAddress !== "string") {
      return res.status(400).json({
        success: false,
        error: "Bad request",
        message: "Valid ipAddress is required",
      });
    }

    // Validate reason
    if (reason && !Object.values(BlacklistReason).includes(reason)) {
      return res.status(400).json({
        success: false,
        error: "Bad request",
        message: "Invalid blacklist reason",
      });
    }

    const entry = await ipBlacklistService.addToBlacklist(ipAddress, {
      reason,
      description,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      addedBy: (req as any).user?.id,
      metadata,
    });

    logger.info("IP added to blacklist via API", {
      ipAddress,
      reason,
      addedBy: (req as any).user?.id,
    });

    res.status(201).json({
      success: true,
      data: entry,
      message: "IP address added to blacklist",
    });
  } catch (error) {
    logger.error("Error adding IP to blacklist", { error });
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: "Failed to add IP to blacklist",
    });
  }
});

/**
 * Bulk add IPs to the blacklist
 * POST /security/blacklist/bulk
 */
router.post(
  "/bulk",
  authenticate,
  isAdmin,
  async (req: Request, res: Response) => {
    try {
      const {
        ips,
        reason = BlacklistReason.MALICIOUS_ACTIVITY,
        description,
      } = req.body;

      // Validate input
      if (!Array.isArray(ips) || ips.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Bad request",
          message: "Array of IP addresses is required",
        });
      }

      if (ips.length > 1000) {
        return res.status(400).json({
          success: false,
          error: "Bad request",
          message: "Maximum 1000 IPs per bulk request",
        });
      }

      const entries = await ipBlacklistService.bulkAddToBlacklist(
        ips.map((ip: string) => ({
          ip,
          options: {
            reason,
            description,
            addedBy: (req as any).user?.id,
          },
        }))
      );

      logger.info("Bulk IPs added to blacklist via API", {
        count: entries.length,
        reason,
        addedBy: (req as any).user?.id,
      });

      res.status(201).json({
        success: true,
        data: { added: entries.length, entries },
        message: `${entries.length} IP addresses added to blacklist`,
      });
    } catch (error) {
      logger.error("Error bulk adding IPs to blacklist", { error });
      res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to bulk add IPs to blacklist",
      });
    }
  }
);

/**
 * Remove an IP from the blacklist
 * DELETE /security/blacklist/:ip
 */
router.delete(
  "/:ip",
  authenticate,
  isAdmin,
  async (req: Request, res: Response) => {
    try {
      const { ip } = req.params;

      const removed = await ipBlacklistService.removeFromBlacklist(ip);

      if (!removed) {
        return res.status(404).json({
          success: false,
          error: "Not found",
          message: "IP address not found in blacklist",
        });
      }

      logger.info("IP removed from blacklist via API", {
        ip,
        removedBy: (req as any).user?.id,
      });

      res.json({
        success: true,
        message: "IP address removed from blacklist",
      });
    } catch (error) {
      logger.error("Error removing IP from blacklist", { error });
      res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to remove IP from blacklist",
      });
    }
  }
);

/**
 * Cleanup expired entries
 * POST /security/blacklist/cleanup
 */
router.post(
  "/cleanup",
  authenticate,
  isAdmin,
  async (req: Request, res: Response) => {
    try {
      const count = await ipBlacklistService.cleanupExpiredEntries();

      logger.info("Cleaned up expired blacklist entries", {
        count,
        cleanedBy: (req as any).user?.id,
      });

      res.json({
        success: true,
        data: { cleaned: count },
        message: `${count} expired entries cleaned up`,
      });
    } catch (error) {
      logger.error("Error cleaning up expired entries", { error });
      res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to cleanup expired entries",
      });
    }
  }
);

export default router;
