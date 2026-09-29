import { Router, Request, Response } from "express";
import { BotSessionService } from "../Bot/botSession.service";
import { BotSessionType, BotPlatform } from "../Bot/botSession.entity";
import logger from "../config/logger";
import { auditLogService } from "../AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../AuditLog/auditLog.entity";

const router = Router();

const botSessionService = new BotSessionService();

// Log bot command metrics
router.post("/metrics", async (req: Request, res: Response) => {
  try {
    const { command, platform, userId, executionTimeMs, success, error, timestamp } = req.body;

    if (!command || !platform || !userId || executionTimeMs === undefined) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: command, platform, userId, executionTimeMs"
      });
    }

    const commandMap: Record<string, AuditAction> = {
      '!start': AuditAction.BOT_COMMAND_START,
      '/start': AuditAction.BOT_COMMAND_START,
      '!help': AuditAction.BOT_COMMAND_HELP,
      '/help': AuditAction.BOT_COMMAND_HELP,
      '!thread': AuditAction.BOT_COMMAND_THREAD,
      '!sponsor': AuditAction.BOT_COMMAND_SPONSOR,
      '/sponsor': AuditAction.BOT_COMMAND_SPONSOR,
      '!trustline': AuditAction.BOT_COMMAND_TRUSTLINE,
      '/trustline': AuditAction.BOT_COMMAND_TRUSTLINE,
      '!dashboard': AuditAction.BOT_COMMAND_DASHBOARD,
      '/dashboard': AuditAction.BOT_COMMAND_DASHBOARD,
      '!validate': AuditAction.BOT_COMMAND_VALIDATE,
      '/validate': AuditAction.BOT_COMMAND_VALIDATE,
      '!balance': AuditAction.BOT_COMMAND_BALANCE,
      '/balance': AuditAction.BOT_COMMAND_BALANCE,
      '!swap': AuditAction.BOT_COMMAND_SWAP,
      '/swap': AuditAction.BOT_COMMAND_SWAP,
    };

    const auditAction = commandMap[command] || AuditAction.BOT_COMMAND_START;

    await auditLogService.log({
      userId,
      action: auditAction,
      severity: success ? AuditSeverity.INFO : AuditSeverity.WARNING,
      resource: `${platform}:${command}`,
      metadata: {
        platform,
        command,
        executionTimeMs,
        timestamp,
      },
      errorMessage: error,
      success,
    });

    logger.info("Bot command performance metrics received", {
      platform,
      command,
      userId,
      executionTimeMs,
      success,
    });

    return res.status(200).json({
      success: true,
      message: "Metrics logged successfully"
    });
  } catch (error) {
    logger.error("Error logging bot metrics", { error, body: req.body });
    return res.status(500).json({
      success: false,
      message: "Failed to log metrics"
    });
  }
});

// Create or update a bot session
router.post("/session", async (req: Request, res: Response) => {
  try {
    const { userId, platform, sessionType, step, sessionData, expiresAt } = req.body;

    if (!userId || !platform || !sessionType || step === undefined || !sessionData) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: userId, platform, sessionType, step, sessionData"
      });
    }

    if (!Object.values(BotPlatform).includes(platform)) {
      return res.status(400).json({
        success: false,
        message: `Invalid platform. Must be one of: ${Object.values(BotPlatform).join(', ')}`
      });
    }

    if (!Object.values(BotSessionType).includes(sessionType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid session type. Must be one of: ${Object.values(BotSessionType).join(', ')}`
      });
    }

    const expiration = expiresAt ? new Date(expiresAt) : new Date(Date.now() + 24 * 60 * 60 * 1000);

    const session = await botSessionService.create({
      userId,
      platform,
      sessionType,
      step,
      sessionData,
      expiresAt: expiration,
    });

    return res.status(200).json({
      success: true,
      session,
    });
  } catch (error) {
    logger.error("Error creating bot session", { error, body: req.body });
    return res.status(500).json({
      success: false,
      message: "Failed to create session"
    });
  }
});

// Get active session for a user
router.get("/session", async (req: Request, res: Response) => {
  try {
    const { userId, platform, sessionType } = req.query;

    if (!userId || !platform || !sessionType) {
      return res.status(400).json({
        success: false,
        message: "Missing required query parameters: userId, platform, sessionType"
      });
    }

    const session = await botSessionService.findActiveSession(
      userId as string,
      platform as BotPlatform,
      sessionType as BotSessionType
    );

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "No active session found"
      });
    }

    return res.status(200).json({
      success: true,
      session,
    });
  } catch (error) {
    logger.error("Error getting bot session", { error, query: req.query });
    return res.status(500).json({
      success: false,
      message: "Failed to get session"
    });
  }
});

// Update a bot session
router.put("/session/:sessionId", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { step, sessionData, expiresAt, isActive } = req.body;

    const session = await botSessionService.update(sessionId, {
      step,
      sessionData,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      isActive,
    });

    return res.status(200).json({
      success: true,
      session,
    });
  } catch (error) {
    logger.error("Error updating bot session", { error, params: req.params, body: req.body });
    return res.status(500).json({
      success: false,
      message: "Failed to update session"
    });
  }
});

// Deactivate a bot session
router.delete("/session/:sessionId", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    await botSessionService.deactivateSession(sessionId);

    return res.status(200).json({
      success: true,
      message: "Session deactivated"
    });
  } catch (error) {
    logger.error("Error deactivating bot session", { error, params: req.params });
    return res.status(500).json({
      success: false,
      message: "Failed to deactivate session"
    });
  }
});

// Deactivate all sessions for a user
router.delete("/sessions/user/:userId", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { platform } = req.query;

    const count = await botSessionService.deactivateUserSessions(
      userId,
      platform as BotPlatform
    );

    return res.status(200).json({
      success: true,
      message: `${count} session(s) deactivated`
    });
  } catch (error) {
    logger.error("Error deactivating user sessions", { error, params: req.params });
    return res.status(500).json({
      success: false,
      message: "Failed to deactivate sessions"
    });
  }
});

export default router;
