import { Router, Request, Response } from "express";
import { userPreferencesService } from "./userPreferences.service";
import logger from "../config/logger";

const router = Router();

/**
 * GET /api/user/preferences/:userId
 * Get user preferences by platform userId
 * Note: In a real app, this should probably be restricted to the bot's identity
 */
router.get("/:userId", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    // We try to get preferences. If user doesn't exist in our DB yet,
    // this might fail or create defaults if the userId is a backend UUID.
    // For platform IDs, we might need a mapping.

    const preferences =
      await userPreferencesService.getPreferencesForAgent(userId);

    return res.status(200).json({
      success: true,
      data: preferences,
    });
  } catch (error) {
    logger.error("Error fetching user preferences", {
      error,
      userId: req.params.userId,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user preferences",
    });
  }
});

/**
 * POST /api/user/preferences/:userId/check-risk
 * Check if a risk level is allowed for a user
 */
router.post("/:userId/check-risk", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { riskLevel } = req.body;

    if (!riskLevel) {
      return res.status(400).json({
        success: false,
        message: "riskLevel is required",
      });
    }

    const result = await userPreferencesService.checkRiskTolerance(
      userId,
      riskLevel
    );

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error("Error checking risk tolerance", {
      error,
      userId: req.params.userId,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to check risk tolerance",
    });
  }
});

export default router;
