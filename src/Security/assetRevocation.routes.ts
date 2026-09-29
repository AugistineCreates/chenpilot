import { Router, Request, Response } from "express";
import { assetRevocationService } from "./assetRevocation.service";
import { requireAdminAuth } from "../Gateway/middleware/adminAuth";
import logger from "../config/logger";

const router = Router();

// ── Public: check revocation status ──────────────────────────────────────────

/**
 * GET /api/security/revocation/check/:type/:code
 * Check if an asset or issuer is revoked.
 */
router.get(
  "/check/:type/:code",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { type, code } = req.params;
      const userId = req.query.userId as string | undefined;

      if (type !== "asset" && type !== "issuer") {
        res.status(400).json({ success: false, message: "Type must be 'asset' or 'issuer'" });
        return;
      }

      const result = await assetRevocationService.isRevoked(code, type, userId);

      res.json({
        success: true,
        data: {
          revoked: result.revoked,
          reason: result.reason || null,
          entryId: result.entry?.id || null,
        },
      });
    } catch (error) {
      logger.error("Error checking revocation status", { error });
      res.status(500).json({ success: false, message: "Failed to check revocation status" });
    }
  }
);

// ── Admin: list active revocations ───────────────────────────────────────────

/**
 * GET /api/security/revocation
 * List all active revocations.
 */
router.get(
  "/",
  requireAdminAuth(),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const revocations = await assetRevocationService.getActiveRevocations();
      res.json({ success: true, data: revocations });
    } catch (error) {
      logger.error("Error listing revocations", { error });
      res.status(500).json({ success: false, message: "Failed to list revocations" });
    }
  }
);

// ── Admin: get revocation feed ───────────────────────────────────────────────

/**
 * GET /api/security/revocation/feed
 * Get the revocation feed (all entries with signatures).
 */
router.get(
  "/feed",
  requireAdminAuth(),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const feed = await assetRevocationService.getRevocationFeed(limit);
      res.json({ success: true, data: feed });
    } catch (error) {
      logger.error("Error getting revocation feed", { error });
      res.status(500).json({ success: false, message: "Failed to get revocation feed" });
    }
  }
);

// ── Admin: create revocation ─────────────────────────────────────────────────

/**
 * POST /api/security/revocation
 * Create a new revocation entry.
 */
router.post(
  "/",
  requireAdminAuth(),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { type, code, reason, scope, userId, description, expiresAt, metadata } = req.body;

      if (!type || !code || !reason) {
        res.status(400).json({
          success: false,
          message: "Required fields: type, code, reason",
        });
        return;
      }

      if (type !== "asset" && type !== "issuer") {
        res.status(400).json({ success: false, message: "Type must be 'asset' or 'issuer'" });
        return;
      }

      const addedBy = (req as any).user?.userId || "admin";

      const entry = await assetRevocationService.revoke({
        type,
        code,
        reason,
        scope: scope || "global",
        userId: userId || null,
        description: description || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        addedBy,
        metadata: metadata || null,
      });

      res.status(201).json({ success: true, data: entry });
    } catch (error) {
      logger.error("Error creating revocation", { error });
      res.status(500).json({ success: false, message: "Failed to create revocation" });
    }
  }
);

// ── Admin: emergency issuer revocation ───────────────────────────────────────

/**
 * POST /api/security/revocation/issuer
 * Emergency revocation of all assets from an issuer.
 */
router.post(
  "/issuer",
  requireAdminAuth(),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { issuerPublicKey, reason, description } = req.body;

      if (!issuerPublicKey || !reason) {
        res.status(400).json({
          success: false,
          message: "Required fields: issuerPublicKey, reason",
        });
        return;
      }

      const addedBy = (req as any).user?.userId || "admin";

      const entry = await assetRevocationService.revokeIssuer(
        issuerPublicKey,
        reason,
        addedBy,
        description
      );

      res.status(201).json({ success: true, data: entry });
    } catch (error) {
      logger.error("Error revoking issuer", { error });
      res.status(500).json({ success: false, message: "Failed to revoke issuer" });
    }
  }
);

// ── Admin: cleanup expired revocations ───────────────────────────────────────

/**
 * POST /api/security/revocation/cleanup
 * Mark expired revocations as inactive.
 */
router.post(
  "/cleanup",
  requireAdminAuth(),
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const cleaned = await assetRevocationService.cleanupExpired();
      res.json({ success: true, data: { cleaned } });
    } catch (error) {
      logger.error("Error cleaning up revocations", { error });
      res.status(500).json({ success: false, message: "Failed to cleanup revocations" });
    }
  }
);

export default router;
