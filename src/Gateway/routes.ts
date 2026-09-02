import { Router, Request, Response } from "express";
import helmet from "helmet";
import RateLimiterService from "./middleware/rateLimiter.service";
import * as os from "os";
import * as StellarSdk from "@stellar/stellar-sdk";
import { container } from "tsyringe";
import AppDataSource from "../config/Datasource";
import { User } from "../Auth/user.entity";
import UserService from "../Auth/user.service";
import { stellarWebhookService } from "./webhook.service";
import { platformWebhookService } from "./platformWebhook.service";
import logger from "../config/logger";
import { sequenceLeaseService } from "../services/sequence";
import authRoutes from "../Auth/auth.routes";
import userPreferencesRoutes from "../Auth/userPreferences.routes";
import botIdentityRoutes from "../Auth/botIdentity.routes";
import dataExportRoutes from "../services/dataExport.routes";
import contractMetadataRoutes from "../services/contracts/contractMetadata.routes";
import contractIdentityRoutes from "../ContractIdentity/contractIdentity.routes";
import horizonProxyRoutes from "./horizonProxy.routes";
import auditLogRoutes from "../AuditLog/auditLog.routes";
import rlsAuditRoutes from "../Security/rlsAudit.routes";
import adminAgentRoutes from "../Agents/admin/adminAgent.routes";
import governanceRoutes from "../Agents/admin/governance.routes";
import experimentRoutes from "../Agents/admin/experiment.routes";
import simulationRoutes from "../Agents/admin/simulation.routes";
import workflowRoutes from "../Agents/admin/workflow.routes";
import { stellarLiquidityTool } from "../Agents/tools/stellarLiquidityTool";
import { auditLogService } from "../AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../AuditLog/auditLog.entity";
import kycRoutes from "../services/kyc/kyc.routes";
import { getSocketManager } from "./socketManager";
import { BotSessionService } from "../Bot/botSession.service";
import { BotSessionType, BotPlatform } from "../Bot/botSession.entity";
import { operatorReportingService } from "../services/operatorReporting.service";
import { authenticateToken } from "../Auth/auth.middleware";
import { requireAdmin, requireOwnerOrElevated } from "./middleware/rbac.middleware";
import { requireAdminAuth } from "./middleware/adminAuth";
import { verifyWebhookSignature } from "./middleware/webhookSignature";

const router = Router();
router.use(helmet());

// Redis-backed general rate limiter (shared across all instances)
const generalLimiter = RateLimiterService.createGeneralLimiter();
router.use(generalLimiter);

// Auth routes (includes login, logout, refresh, sessions)
router.use("/auth", authRoutes);
router.use("/auth", authExtraRoutes);

// Mount user preferences routes
router.use("/user/preferences", userPreferencesRoutes);

// Mount bot identity routes
router.use("/bot-identity", botIdentityRoutes);

// Mount data export routes
router.use("/export", dataExportRoutes);

// Mount contract metadata discovery routes
router.use("/contracts", contractMetadataRoutes);

// Signed deployment manifests + code identity (Issue #676)
router.use("/contract-identity", contractIdentityRoutes);

// Mount KYC submission routes (with strict rate limiting)
router.use("/kyc", kycRoutes);

// Mount Horizon proxy routes (authenticated)
router.use("/horizon", horizonProxyRoutes);

// Audit logs
router.use("/audit", auditLogRoutes);

// RLS bypass audit logs (admin only)
router.use("/security/rls-audit", rlsAuditRoutes);

// Admin agent routes
router.use("/admin/agents", adminAgentRoutes);
router.use("/admin/governance", governanceRoutes);

// Mount experiment management routes (requires admin role)
router.use("/admin/experiments", experimentRoutes);

// Mount simulation routes (requires admin role)
router.use("/admin/simulation", simulationRoutes);

// Mount workflow routes (requires admin role)
router.use("/admin/workflows", workflowRoutes);
router.get(
  "/admin/operator-report",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const startDate = req.query.startDate
        ? new Date(req.query.startDate as string)
        : undefined;
      const endDate = req.query.endDate
        ? new Date(req.query.endDate as string)
        : undefined;

      const report = await operatorReportingService.buildReport({
        startDate,
        endDate,
      });

      return res.status(200).json({
        success: true,
        data: report,
      });
    } catch (error) {
      logger.error("Error building operator report", { error });
      return res.status(500).json({
        success: false,
        message: "Failed to build operator report",
      });
    }
  }
);

// #149: Bot command performance metrics endpoint
router.post("/bot/metrics", async (req: Request, res: Response) => {
  try {
    const {
      command,
      platform,
      userId,
      executionTimeMs,
      success,
      error,
      timestamp,
    } = req.body;

    // Validate required fields
    if (!command || !platform || !userId || executionTimeMs === undefined) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: command, platform, userId, executionTimeMs",
      });
    }

    // Map bot command to audit action
    const auditAction = (
      {
        "!start": AuditAction.BOT_COMMAND_START,
        "/start": AuditAction.BOT_COMMAND_START,
        "!help": AuditAction.BOT_COMMAND_HELP,
        "/help": AuditAction.BOT_COMMAND_HELP,
        "!thread": AuditAction.BOT_COMMAND_THREAD,
        "!sponsor": AuditAction.BOT_COMMAND_SPONSOR,
        "!trustline": AuditAction.BOT_COMMAND_TRUSTLINE,
        "/trustline": AuditAction.BOT_COMMAND_TRUSTLINE,
        "!dashboard": AuditAction.BOT_COMMAND_DASHBOARD,
        "/dashboard": AuditAction.BOT_COMMAND_DASHBOARD,
        "!validate": AuditAction.BOT_COMMAND_VALIDATE,
        "/validate": AuditAction.BOT_COMMAND_VALIDATE,
        "!balance": AuditAction.BOT_COMMAND_BALANCE,
        "/balance": AuditAction.BOT_COMMAND_BALANCE,
        "!swap": AuditAction.BOT_COMMAND_SWAP,
        "/swap": AuditAction.BOT_COMMAND_SWAP,
      } as Record<string, AuditAction>
    )[command];

    // Realtime
    router.use("/realtime", realtimeRoutes);

    // Log to audit log
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

    // Also log to application logger for visibility
    logger.info("Bot command performance metrics received", {
      platform,
      command,
      userId,
      executionTimeMs,
      success,
    });

    return res.status(200).json({
      success: true,
      message: "Metrics logged successfully",
    });
  } catch (error) {
    logger.error("Error logging bot metrics", { error, body: req.body });
    return res.status(500).json({
      success: false,
      message: "Failed to log metrics",
    });
  }
});

// #126: Bot session management endpoints
const botSessionService = new BotSessionService();

// Create or update a bot session
router.post("/bot/session", async (req: Request, res: Response) => {
  try {
    const { userId, platform, sessionType, step, sessionData, expiresAt } =
      req.body;

    // Validate required fields
    if (
      !userId ||
      !platform ||
      !sessionType ||
      step === undefined ||
      !sessionData
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: userId, platform, sessionType, step, sessionData",
      });
    }

    // Validate platform
    if (!Object.values(BotPlatform).includes(platform)) {
      return res.status(400).json({
        success: false,
        message: `Invalid platform. Must be one of: ${Object.values(BotPlatform).join(", ")}`,
      });
    }

    // Validate session type
    if (!Object.values(BotSessionType).includes(sessionType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid session type. Must be one of: ${Object.values(BotSessionType).join(", ")}`,
      });
    }

    // Set default expiration (24 hours from now) if not provided
    const expiration = expiresAt
      ? new Date(expiresAt)
      : new Date(Date.now() + 24 * 60 * 60 * 1000);

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
      message: "Failed to create session",
    });
  }
});

// Get active session for a user
router.get("/bot/session", async (req: Request, res: Response) => {
  try {
    const { userId, platform, sessionType } = req.query;

    if (!userId || !platform || !sessionType) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required query parameters: userId, platform, sessionType",
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
        message: "No active session found",
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
      message: "Failed to get session",
    });
  }
});

// Update a bot session
router.put("/bot/session/:sessionId", async (req: Request, res: Response) => {
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
    logger.error("Error updating bot session", {
      error,
      params: req.params,
      body: req.body,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to update session",
    });
  }
});

// Deactivate a bot session
router.delete(
  "/bot/session/:sessionId",
  async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      await botSessionService.deactivateSession(sessionId);

      return res.status(200).json({
        success: true,
        message: "Session deactivated",
      });
    } catch (error) {
      logger.error("Error deactivating bot session", {
        error,
        params: req.params,
      });
      return res.status(500).json({
        success: false,
        message: "Failed to deactivate session",
      });
    }
  }
);

// Deactivate all sessions for a user
router.delete(
  "/bot/sessions/user/:userId",
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { platform } = req.query;

      const count = await botSessionService.deactivateUserSessions(
        userId,
        platform as BotPlatform
      );

      return res.status(200).json({
        success: true,
        message: `${count} session(s) deactivated`,
      });
    } catch (error) {
      logger.error("Error deactivating user sessions", {
        error,
        params: req.params,
      });
      return res.status(500).json({
        success: false,
        message: "Failed to deactivate sessions",
      });
    }
  }
);

// Public webhook endpoint for Stellar funding notifications
router.post(
  "/webhook/stellar/funding",
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
      } else {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }
    } catch (error) {
      console.error("Webhook processing error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Public webhook endpoint for Telegram
router.post(
  "/webhook/telegram",
  webhookAuth("telegram"),
  async (req: Request, res: Response) => {
    try {
      const result = await platformWebhookService.processTelegramWebhook(req);

      if (result.isDuplicate) {
        // Return 200 for duplicates to acknowledge receipt
        return res.status(200).json({
          success: true,
          message: result.message,
        });
      }

      if (result.success) {
        return res.status(200).json({
          success: true,
          message: result.message,
          data: result.data,
        });
      } else {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }
    } catch (error) {
      console.error("Telegram webhook processing error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Public webhook endpoint for Discord
router.post(
  "/webhook/discord",
  webhookAuth("discord"),
  async (req: Request, res: Response) => {
    try {
      const result = await platformWebhookService.processDiscordWebhook(req);

      // Discord ping response (type 1)
      if (
        result.data &&
        typeof result.data === "object" &&
        "type" in result.data &&
        result.data.type === 1
      ) {
        return res.status(200).json({ type: 1 });
      }

      if (result.isDuplicate) {
        // Return 200 for duplicates to acknowledge receipt
        return res.status(200).json({
          success: true,
          message: result.message,
        });
      }

      if (result.success) {
        return res.status(200).json({
          success: true,
          message: result.message,
          data: result.data,
        });
      } else {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }
    } catch (error) {
      console.error("Discord webhook processing error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

/**
 * @swagger
 * /api/signup:
 *   post:
 *     summary: Register a new user with wallet details
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: Unique username
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 userId:
 *                   type: string
 *                   format: uuid
 *       400:
 *         description: Missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: User with this name already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/signup", async (req: Request, res: Response) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "name is required",
      });
    }

    const userService = container.resolve(UserService);
    const user = await userService.createUser({ name });

    await auditLogService.log({
      userId: user.id,
      action: AuditAction.USER_CREATED,
      severity: AuditSeverity.INFO,
      ipAddress:
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        (req.headers["x-real-ip"] as string) ||
        req.socket.remoteAddress ||
        "unknown",
      userAgent: req.headers["user-agent"],
      metadata: { username: name, address: user.address },
    });

    return res.status(201).json({
      success: true,
      userId: user.id,
    });
  } catch (error) {
    logger.error("Signup error", { error, name: req.body?.name });
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Liquidity
router.post("/liquidity", async (req: Request, res: Response) => {
  try {
    const { assetCode, assetIssuer, depthLimit } = req.body;
    const result = await stellarLiquidityTool.execute({
      assetCode,
      assetIssuer,
      depthLimit,
    });
    res.json(result);
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "An unknown error occurred";
    res.status(500).json({ error: errorMessage });
  }
});

// Admin stats
router.get(
  "/admin/stats",
  requireAdminAuth(),
  (req: Request, res: Response) => {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      memory: {
        rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`,
        heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
        heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
        external: `${(memUsage.external / 1024 / 1024).toFixed(2)} MB`,
      },
      cpu: {
        user: `${(cpuUsage.user / 1000).toFixed(2)} ms`,
        system: `${(cpuUsage.system / 1000).toFixed(2)} ms`,
      },
      system: {
        totalMemory: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
        freeMemory: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
        uptime: `${(os.uptime() / 3600).toFixed(2)} hours`,
        loadAverage: os.loadavg(),
      },
      process: {
        uptime: `${(process.uptime() / 60).toFixed(2)} minutes`,
        pid: process.pid,
      },
    });
  }
);

router.get(
  "/admin/jobs/stats",
  authenticateToken,
  requireAdmin,
  async (_req: Request, res: Response) => {
    try {
      const stats = await jobQueueService.getQueueStats();
      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        stats,
      });
    } catch (error) {
      logger.error("Failed to fetch job queue stats", { error });
      res.status(500).json({
        success: false,
        message: "Failed to fetch job queue stats",
      });
    }
  }
);

router.get(
  "/admin/jobs/dead-letter",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 25, 100);
      const jobs = await jobQueueService.getDeadLetterJobs(limit);
      res.json({
        success: true,
        count: jobs.length,
        jobs,
      });
    } catch (error) {
      logger.error("Failed to fetch dead-letter jobs", { error });
      res.status(500).json({
        success: false,
        message: "Failed to fetch dead-letter jobs",
      });
    }
  }
);

// --- REAL-TIME UPDATES (Socket.io) ---

/**
 * @swagger
 * /api/realtime/stats:
 *   get:
 *     summary: Get real-time connection statistics
 *     description: Returns Socket.io connection statistics and connected clients info
 *     tags: [Real-time]
 *     responses:
 *       200:
 *         description: Socket.io statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 totalConnected:
 *                   type: number
 *                 connectedClients:
 *                   type: array
 */
router.get("/realtime/stats", (req: Request, res: Response) => {
  try {
    const socketManager = getSocketManager();

    const stats = {
      success: true,
      totalConnected: socketManager.getConnectedClientsCount(),
      connectedClients: socketManager
        .getAllConnectedClients()
        .map(
          (client: {
            socketId: string;
            userId?: string;
            connectedAt: Date;
          }) => ({
            socketId: client.socketId,
            userId: client.userId || "anonymous",
            connectedAt: client.connectedAt,
          })
        ),
    };

    res.json(stats);
  } catch (error) {
    logger.error("Error retrieving Socket.io stats:", { error });
    res.status(500).json({
      success: false,
      error: "Failed to retrieve Socket.io statistics",
    });
  }
});

/**
 * @swagger
 * /api/realtime/user/:userId/clients:
 *   get:
 *     summary: Get connected clients for a user
 *     description: Returns all Socket.io clients connected for a specific user
 *     tags: [Real-time]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User's connected clients
 */
router.get("/realtime/user/:userId/clients", (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const socketManager = getSocketManager();

    const clients = socketManager.getUserClients(userId);

    res.json({
      success: true,
      userId,
      connectedClients: clients.map(
        (client: { socketId: string; connectedAt: Date }) => ({
          socketId: client.socketId,
          connectedAt: client.connectedAt,
        })
      ),
      count: clients.length,
    });
  } catch (error) {
    logger.error("Error retrieving user clients:", { error });
    res.status(500).json({
      success: false,
      error: "Failed to retrieve user clients",
    });
  }
});

/**
 * POST /api/account/:userId/sponsor
 * Request sponsorship of the user's initial Stellar account reserves.
 * Requires SPONSOR_SECRET_KEY and STELLAR_NETWORK env vars.
 */
router.post(
  "/account/:userId/sponsor",
  authenticateToken,
  requireOwnerOrElevated("userId"),
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const userRepository = AppDataSource.getRepository(User);

      const user = await userRepository.findOne({ where: { id: userId } });
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      if (user.isFunded) {
        return res
          .status(409)
          .json({ success: false, message: "Account already sponsored" });
      }

      const sponsorSecret = process.env.SPONSOR_SECRET_KEY;
      if (!sponsorSecret) {
        return res.status(503).json({
          success: false,
          message: "Sponsorship service not configured",
        });
      }

      const networkPassphrase =
        process.env.STELLAR_NETWORK === "mainnet"
          ? StellarSdk.Networks.PUBLIC
          : StellarSdk.Networks.TESTNET;

      const sponsorKeypair = StellarSdk.Keypair.fromSecret(sponsorSecret);
      const sponsorPublicKey = sponsorKeypair.publicKey();
      const server = new StellarSdk.Horizon.Server(
        process.env.HORIZON_URL || "https://horizon-testnet.stellar.org"
      );

      // Acquire a sequence lease for the sponsor account to prevent races
      const sponsorLease = await sequenceLeaseService.acquireLease(
        sponsorPublicKey,
        `sponsor:${userId}`,
        120_000,
        server
      );

      // Build account with leased sequence to prevent races across instances
      const sponsorAccount = new StellarSdk.Account(
        sponsorPublicKey,
        sponsorLease.sequenceNumber.toString()
      );

      const txBuilder = new StellarSdk.TransactionBuilder(sponsorAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      });
      txBuilder.addOperation(
        StellarSdk.Operation.beginSponsoringFutureReserves({
          source: sponsorPublicKey,
          sponsored: user.address,
        })
      );
      txBuilder.addOperation(
        StellarSdk.Operation.createAccount({
          source: sponsorPublicKey,
          destination: user.address,
          startingBalance: "0",
        })
      );
      txBuilder.addOperation(
        StellarSdk.Operation.endSponsoringFutureReserves({
          source: user.address,
        })
      );

      const tx = txBuilder.setTimeout(300).build();
      tx.sign(sponsorKeypair);

      // Validate lease fencing before submission
      await sequenceLeaseService.validateLease(
        sponsorLease.lease.id,
        sponsorLease.fencingToken
      );

      await server.submitTransaction(tx);

      // Mark lease consumed after successful submission
      const txResult = await server
        .transactions()
        .transaction(tx.hash)
        .call();
      await sequenceLeaseService.consumeLease(
        sponsorLease.lease.id,
        `sponsor:${userId}`,
        txResult.hash
      );

      user.isFunded = true;
      user.updatedAt = new Date();
      await userRepository.save(user);

      await auditLogService.log({
        userId,
        action: AuditAction.USER_CREATED, // closest available action
        severity: AuditSeverity.INFO,
        ipAddress:
          (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
          req.socket.remoteAddress ||
          "unknown",
        userAgent: req.headers["user-agent"],
        metadata: { event: "account_sponsored", address: user.address },
      });

      return res.status(200).json({
        success: true,
        message: "Account sponsored successfully",
        address: user.address,
      });
    } catch (error) {
      logger.error("Sponsorship error", { error, userId: req.params.userId });
      return res.status(500).json({
        success: false,
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }
);

// ---------------------------------------------------------------------------
// Portfolio endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/portfolio/:userId?currency=USD
 *
 * Returns a formatted portfolio summary for the user's Stellar account,
 * including all asset balances and estimated net worth in the requested
 * currency (USD | XLM | BTC, default USD).
 */
router.get(
  "/portfolio/:userId",
  authenticateToken,
  requireOwnerOrElevated("userId"),
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const currency = (req.query.currency as string | undefined) ?? "USD";

      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({ where: { id: userId } });
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      const summary = await portfolioService.getPortfolio(
        user.address,
        currency
      );

      await auditLogService.log({
        userId,
        action: AuditAction.BOT_COMMAND_PORTFOLIO,
        severity: AuditSeverity.INFO,
        resource: `portfolio:${userId}`,
        metadata: { currency, address: user.address },
        success: true,
      });

      return res.status(200).json({
        success: true,
        address: summary.address,
        currency: summary.currency,
        totalValue: summary.totalValue,
        assets: summary.assets.map((a) => ({
          code: a.code,
          issuer: a.issuer,
          balance: a.amount,
          value: a.valueInCurrency,
        })),
        fetchedAt: summary.fetchedAt,
      });
    } catch (error) {
      logger.error("Portfolio fetch error", {
        error,
        userId: req.params.userId,
      });
      const message =
        error instanceof Error ? error.message : "Internal server error";
      const statusCode =
        message.includes("not found") || message.includes("unreachable")
          ? 404
          : 500;
      return res.status(statusCode).json({ success: false, message });
    }
  }
);

/**
 * GET /api/price/:assetCode?currency=USD
 *
 * Returns the current DEX price of an asset in the requested currency.
 * Used by the bot's price-alert polling loop and the !portfolio command.
 */
router.get("/price/:assetCode", async (req: Request, res: Response) => {
  try {
    const { assetCode } = req.params;
    const currency = (req.query.currency as string | undefined) ?? "USD";

    const result = await portfolioService.getAssetPrice(assetCode, currency);

    return res.status(200).json({
      success: true,
      assetCode: result.assetCode,
      currency: result.currency,
      price: result.price,
    });
  } catch (error) {
    logger.error("Price fetch error", {
      error,
      assetCode: req.params.assetCode,
    });
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

export default router;
