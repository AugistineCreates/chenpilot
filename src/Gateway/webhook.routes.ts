import { Router, Request, Response } from "express";
import { stellarWebhookService } from "./webhook.service";
import { platformWebhookService } from "./platformWebhook.service";
import logger from "../config/logger";
import { webhookAuth } from "./middleware/webhookAuthMiddleware";

const router = Router();

// Stellar funding webhook - now using edge signature verification
router.post(
  "/stellar/funding",
  webhookAuth("stellar"),
  async (req: Request, res: Response) => {
    try {
      const result = await stellarWebhookService.processFundingWebhook(req);
      if (result.success) {
        return res.status(200).json({
          success: true,
          message: result.message,
          userId: result.userId,
          deploymentTriggered: result.deploymentTriggered,
        });
      }
      return res.status(400).json({
        success: false,
        message: result.message,
      });
    } catch (error) {
      console.error("Webhook processing error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Telegram webhook - now using edge signature verification
router.post(
  "/telegram",
  webhookAuth("telegram"),
  async (req: Request, res: Response) => {
    try {
      const result = await platformWebhookService.processTelegramWebhook(req);
      if (result.isDuplicate) {
        return res.status(200).json({ success: true, message: result.message });
      }
      if (result.success) {
        return res.status(200).json({ success: true, message: result.message, data: result.data });
      }
      return res.status(400).json({ success: false, message: result.message });
    } catch (error) {
      console.error("Telegram webhook processing error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Discord webhook - now using edge signature verification
router.post(
  "/discord",
  webhookAuth("discord"),
  async (req: Request, res: Response) => {
    try {
      const result = await platformWebhookService.processDiscordWebhook(req);
      if (
        result.data &&
        typeof result.data === "object" &&
        "type" in result.data &&
        result.data.type === 1
      ) {
        return res.status(200).json({ type: 1 });
      }

      if (result.isDuplicate) {
        return res.status(200).json({ success: true, message: result.message });
      }

      if (result.success) {
        return res.status(200).json({ success: true, message: result.message, data: result.data });
      }

      return res.status(400).json({ success: false, message: result.message });
    } catch (error) {
      console.error("Discord webhook processing error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

export default router;
