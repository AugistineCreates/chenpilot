import { Router, Request, Response } from "express";
import { botIdentityService } from "./botIdentity.service";
import { authenticateToken } from "./auth.middleware";
import { BotPlatform } from "./botIdentity.entity";
import logger from "../config/logger";

const router = Router();

/**
 * POST /api/bot-identity/link-token
 * Generate a secure link token for bot identity linking
 */
router.post("/link-token", authenticateToken, async (req: Request, res: Response) => {
  try {
    const { userId } = req.user as { userId: string };
    const { platform } = req.body;

    if (!platform || !["telegram", "discord"].includes(platform)) {
      return res.status(400).json({
        success: false,
        message: "Invalid platform. Must be 'telegram' or 'discord'",
      });
    }

    const result = await botIdentityService.generateLinkToken({
      userId,
      platform: platform as BotPlatform,
    });

    res.json({
      success: true,
      token: result.token,
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    logger.error("Failed to generate link token", { error });
    res.status(500).json({
      success: false,
      message: "Failed to generate link token",
    });
  }
});

/**
 * POST /api/bot-identity/verify-link
 * Verify a link token and complete the identity linking
 */
router.post("/verify-link", async (req: Request, res: Response) => {
  try {
    const { token, platformUserId, platformUsername } = req.body;

    if (!token || !platformUserId) {
      return res.status(400).json({
        success: false,
        message: "Token and platformUserId are required",
      });
    }

    const result = await botIdentityService.verifyLinkToken({
      token,
      platformUserId,
      platformUsername,
    });

    // Link the identity
    await botIdentityService.linkBotIdentity({
      userId: result.userId,
      platform: result.platform,
      platformUserId,
      platformUsername,
    });

    res.json({
      success: true,
      message: "Account linked successfully",
      userId: result.userId,
    });
  } catch (error) {
    logger.error("Failed to verify link token", { error });
    res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to verify link token",
    });
  }
});

/**
 * GET /api/bot-identity/user-by-identity
 * Get user by bot identity (for authentication)
 */
router.get("/user-by-identity", async (req: Request, res: Response) => {
  try {
    const { platform, platformUserId } = req.query;

    if (!platform || !platformUserId) {
      return res.status(400).json({
        success: false,
        message: "Platform and platformUserId are required",
      });
    }

    const user = await botIdentityService.getUserByBotIdentity(
      platform as BotPlatform,
      platformUserId as string
    );

    if (!user) {
      return res.json({
        exists: false,
        userId: null,
      });
    }

    res.json({
      exists: true,
      userId: user.id,
    });
  } catch (error) {
    logger.error("Failed to get user by bot identity", { error });
    res.status(500).json({
      success: false,
      message: "Failed to get user by bot identity",
    });
  }
});

/**
 * GET /api/bot-identity/identities/:userId
 * Get all linked identities for a user
 */
router.get("/identities/:userId", authenticateToken, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const authUserId = (req.user as { userId: string }).userId;

    // Users can only view their own identities
    if (userId !== authUserId) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const identities = await botIdentityService.getUserBotIdentities(userId);

    res.json({
      success: true,
      identities,
    });
  } catch (error) {
    logger.error("Failed to get user identities", { error });
    res.status(500).json({
      success: false,
      message: "Failed to get user identities",
    });
  }
});

/**
 * DELETE /api/bot-identity/unlink
 * Unlink a bot identity
 */
router.delete("/unlink", authenticateToken, async (req: Request, res: Response) => {
  try {
    const { userId } = req.user as { userId: string };
    const { platform } = req.body;

    if (!platform || !["telegram", "discord"].includes(platform)) {
      return res.status(400).json({
        success: false,
        message: "Invalid platform. Must be 'telegram' or 'discord'",
      });
    }

    await botIdentityService.unlinkBotIdentity(userId, platform as BotPlatform);

    res.json({
      success: true,
      message: "Identity unlinked successfully",
    });
  } catch (error) {
    logger.error("Failed to unlink identity", { error });
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to unlink identity",
    });
  }
});

export default router;
