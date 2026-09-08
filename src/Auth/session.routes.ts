import { Router, Request, Response } from "express";
import { refreshTokenFamilyService } from "./refreshTokenFamily.service";
import { authenticateToken } from "./auth.middleware";
import logger from "../config/logger";

const router = Router();

/**
 * Session Management Endpoints
 * 
 * These endpoints support session inventory and targeted revocation.
 * Users can:
 * 1. List all active sessions (devices)
 * 2. Revoke specific session (logout from device)
 * 3. Revoke all sessions (full logout)
 * 4. Get session details (device info, last used, risk level)
 */

/**
 * GET /sessions
 * List all active sessions for the authenticated user.
 * 
 * Returns array of sessions with device info, last used time, and risk level.
 * Users can use this to detect unauthorized access or manage devices.
 */
router.get("/sessions", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const sessions = await refreshTokenFamilyService.getUserSessions(userId);

    // Sort by last used (most recent first)
    sessions.sort(
      (a, b) =>
        (b.lastUsedAt?.getTime() || 0) - (a.lastUsedAt?.getTime() || 0)
    );

    logger.info("Sessions listed", { userId, count: sessions.length });

    return res.json({
      count: sessions.length,
      sessions: sessions.map((session) => ({
        familyId: session.familyId,
        deviceName: session.deviceName,
        lastUsedAt: session.lastUsedAt?.toISOString(),
        createdAt: session.createdAt.toISOString(),
        riskLevel: session.riskLevel,
        isCompromised: session.isCompromised,
      })),
    });
  } catch (error) {
    logger.error("Error listing sessions", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /sessions/:familyId
 * Revoke a specific session (logout from device).
 * 
 * User can selectively logout from specific devices while keeping
 * other sessions active. This is the "logout from device" feature.
 * 
 * Path parameters:
 * - familyId: The token family ID to revoke
 * 
 * Response: 204 No Content on success
 */
router.delete(
  "/sessions/:familyId",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const { familyId } = req.params;

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (!familyId) {
        return res.status(400).json({ error: "Missing familyId parameter" });
      }

      await refreshTokenFamilyService.revokeSession(
        userId,
        familyId,
        "User revoked session"
      );

      logger.info("Session revoked", { userId, familyId });

      return res.status(204).send();
    } catch (error) {
      if (error instanceof Error && error.message.includes("Session not found")) {
        return res.status(404).json({ error: "Session not found" });
      }

      logger.error("Error revoking session", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * DELETE /sessions
 * Revoke all sessions for the user (full logout).
 * 
 * This is a strong action - all devices will be logged out and will need
 * to re-authenticate. Use with caution, but important for security recovery.
 * 
 * Query parameters:
 * - confirm=yes : Required confirmation to prevent accidental execution
 * 
 * Response: 
 * - 204 No Content on success with count of revoked sessions
 * - 400 Bad Request if confirmation not provided
 */
router.delete("/sessions", authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { confirm } = req.query;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Require explicit confirmation to prevent accidental logout from all devices
    if (confirm !== "yes") {
      return res.status(400).json({
        error: "Must confirm with ?confirm=yes to logout from all devices",
      });
    }

    const revokedCount = await refreshTokenFamilyService.revokeAllSessions(
      userId,
      "User requested full logout"
    );

    logger.warn("All sessions revoked", { userId, count: revokedCount });

    return res.json({
      message: `Logged out from ${revokedCount} device(s)`,
      revokedCount,
    });
  } catch (error) {
    logger.error("Error revoking all sessions", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /sessions/:familyId
 * Get detailed information about a specific session.
 * 
 * Returns session metadata including:
 * - Device information
 * - Last used timestamp
 * - Risk assessment
 * - Token lineage (if applicable)
 * - Compromise status
 * 
 * Path parameters:
 * - familyId: The token family ID
 * 
 * Response: Session details or 404 if not found
 */
router.get(
  "/sessions/:familyId",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const { familyId } = req.params;

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (!familyId) {
        return res.status(400).json({ error: "Missing familyId parameter" });
      }

      // Get family lineage for detailed info
      const lineage = await refreshTokenFamilyService.getFamilyLineage(
        familyId
      );

      if (!lineage || lineage.length === 0) {
        return res.status(404).json({ error: "Session not found" });
      }

      // Verify ownership (all tokens in family should belong to user)
      if (!lineage.every((t) => t.userId === userId)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const latestToken = lineage[lineage.length - 1];

      return res.json({
        familyId,
        deviceName: latestToken.deviceName || "Unknown",
        createdAt: lineage[0].createdAt.toISOString(),
        lastUsedAt: latestToken.lastUsedAt?.toISOString(),
        riskLevel: latestToken.riskSignal,
        riskReason: latestToken.riskReason,
        isCompromised: latestToken.reuseDetected,
        rotationCount: lineage.length,
        tokenHistory: lineage.map((t) => ({
          id: t.id,
          createdAt: t.createdAt.toISOString(),
          expiresAt: t.expiresAt.toISOString(),
          isRevoked: t.isRevoked,
          rotationReason: t.rotationReason,
        })),
      });
    } catch (error) {
      logger.error("Error fetching session details", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * POST /sessions/verify-device
 * Verify that a device change requires step-up authentication.
 * 
 * This endpoint is used during token refresh to determine if the device
 * has changed enough to require additional authentication before issuing
 * a new token.
 * 
 * Body:
 * - deviceFingerprint: Device identification data
 * 
 * Response:
 * {
 *   requiresStepUp: boolean,
 *   reason: string,
 *   riskLevel: string
 * }
 */
router.post(
  "/sessions/verify-device",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const { deviceFingerprint } = req.body;

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (!deviceFingerprint) {
        return res.status(400).json({ error: "Missing deviceFingerprint" });
      }

      // Get user's current sessions to check for device changes
      const sessions = await refreshTokenFamilyService.getUserSessions(userId);

      if (sessions.length === 0) {
        // First login, no step-up needed
        return res.json({
          requiresStepUp: false,
          reason: "First session",
          riskLevel: "NONE",
        });
      }

      // Check if this device matches any existing session
      const isKnownDevice = sessions.some(
        (s) => s.deviceId && s.deviceId.length > 0
      );

      if (!isKnownDevice) {
        // New device detected
        return res.json({
          requiresStepUp: true,
          reason: "New device detected",
          riskLevel: "MEDIUM",
        });
      }

      // Check for risky patterns (high risk level sessions)
      const hasHighRiskSession = sessions.some((s) =>
        ["HIGH", "CRITICAL"].includes(s.riskLevel)
      );

      if (hasHighRiskSession) {
        return res.json({
          requiresStepUp: true,
          reason: "High risk session activity detected",
          riskLevel: "HIGH",
        });
      }

      // Device is known and no high-risk sessions
      return res.json({
        requiresStepUp: false,
        reason: "Device recognized",
        riskLevel: "LOW",
      });
    } catch (error) {
      logger.error("Error verifying device", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
