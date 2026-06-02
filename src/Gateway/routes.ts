import { Router, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import * as os from "os";
import * as crypto from "crypto";
import * as StellarSdk from "@stellar/stellar-sdk";
import AppDataSource from "../config/Datasource";
import { User } from "../Auth/user.entity";
import { stellarWebhookService } from "./webhook.service";
import { platformWebhookService } from "./platformWebhook.service";
import { SponsorshipTransactionBuilder } from "../../packages/sdk/src/sponsorship";
import {
  transactionHistoryService,
  type TransactionQueryParams,
  type TransactionType,
} from "./transaction.service";
import logger from "../config/logger";
import authRoutes from "../Auth/auth.routes";
import dataExportRoutes from "../services/dataExport.routes";
import contractMetadataRoutes from "../services/contracts/contractMetadata.routes";
import horizonProxyRoutes from "./horizonProxy.routes";
import auditLogRoutes from "../AuditLog/auditLog.routes";
import adminAgentRoutes from "../Agents/admin/adminAgent.routes";
import { stellarLiquidityTool } from "../Agents/tools/stellarLiquidityTool";
import { authenticateToken } from "../Auth/auth.middleware";
import {
  requireAdmin,
  requireOwnerOrElevated,
} from "./middleware/rbac.middleware";
import { auditLogService } from "../AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../AuditLog/auditLog.entity";
import { getSocketManager } from "./socketManager";
import { BotSessionService } from "../Bot/botSession.service";
import { BotSessionType, BotPlatform } from "../Bot/botSession.entity";
import { operatorReportingService } from "../services/operatorReporting.service";

const router = Router();

router.use(helmet());

// --- WEBHOOK HMAC VERIFICATION ---

/**
 * Verify HMAC-SHA256 signature on incoming webhook requests.
 * Expects the signature in the `x-webhook-signature` header as `sha256=<hex>`.
 * Set WEBHOOK_SECRET in your environment to enable enforcement.
 */
function verifyWebhookSignature(
  req: Request,
  res: Response,
  next: () => void
): void {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    // If no secret is configured, skip verification (dev/test environments).
    // In production, WEBHOOK_SECRET must be set.
    logger.warn(
      "WEBHOOK_SECRET not configured — skipping webhook signature verification"
    );
    next();
    return;
  }

  const signature = req.headers["x-webhook-signature"] as string | undefined;
  if (!signature) {
    res
      .status(401)
      .json({ success: false, message: "Missing webhook signature" });
    return;
  }

  const rawBody = JSON.stringify(req.body);
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    logger.warn("Webhook signature mismatch", { receivedSignature: signature });
    res
      .status(401)
      .json({ success: false, message: "Invalid webhook signature" });
    return;
  }

  next();
}

// --- RATE LIMITING STRATEGIES ---

// AC: 100 req/min per IP for public/general routes
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please slow down." },
});

// Apply general limiter to all routes by default
router.use(generalLimiter);

// --- ROUTES ---

// Mount auth routes
router.use("/auth", authRoutes);

// Mount data export routes
router.use("/export", dataExportRoutes);

// Mount contract metadata discovery routes
router.use("/contracts", contractMetadataRoutes);

// Mount Horizon proxy routes (authenticated)
router.use("/horizon", horizonProxyRoutes);
// Mount audit log routes
router.use("/audit", auditLogRoutes);

// Mount admin agent management routes (requires admin role)
router.use("/admin/agents", adminAgentRoutes);

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
    const { command, platform, userId, executionTimeMs, success, error, timestamp } = req.body;

    // Validate required fields
    if (!command || !platform || !userId || executionTimeMs === undefined) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: command, platform, userId, executionTimeMs"
      });
    }

    // Map bot command to audit action
    const commandMap: Record<string, AuditAction> = {
      '!start': AuditAction.BOT_COMMAND_START,
      '/start': AuditAction.BOT_COMMAND_START,
      '!help': AuditAction.BOT_COMMAND_HELP,
      '/help': AuditAction.BOT_COMMAND_HELP,
      '!thread': AuditAction.BOT_COMMAND_THREAD,
      '!sponsor': AuditAction.BOT_COMMAND_SPONSOR,
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

// #126: Bot session management endpoints
const botSessionService = new BotSessionService();

// Create or update a bot session
router.post("/bot/session", async (req: Request, res: Response) => {
  try {
    const { userId, platform, sessionType, step, sessionData, expiresAt } = req.body;

    // Validate required fields
    if (!userId || !platform || !sessionType || step === undefined || !sessionData) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: userId, platform, sessionType, step, sessionData"
      });
    }

    // Validate platform
    if (!Object.values(BotPlatform).includes(platform)) {
      return res.status(400).json({
        success: false,
        message: `Invalid platform. Must be one of: ${Object.values(BotPlatform).join(', ')}`
      });
    }

    // Validate session type
    if (!Object.values(BotSessionType).includes(sessionType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid session type. Must be one of: ${Object.values(BotSessionType).join(', ')}`
      });
    }

    // Set default expiration (24 hours from now) if not provided
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
router.get("/bot/session", async (req: Request, res: Response) => {
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
    logger.error("Error updating bot session", { error, params: req.params, body: req.body });
    return res.status(500).json({
      success: false,
      message: "Failed to update session"
    });
  }
});

// Deactivate a bot session
router.delete("/bot/session/:sessionId", async (req: Request, res: Response) => {
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
router.delete("/bot/sessions/user/:userId", async (req: Request, res: Response) => {
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

// Public webhook endpoint for Stellar funding notifications
router.post(
  "/webhook/stellar/funding",
  verifyWebhookSignature,
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
  verifyWebhookSignature,
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
  verifyWebhookSignature,
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
 *               - address
 *               - pk
 *             properties:
 *               name:
 *                 type: string
 *                 description: Unique username
 *               address:
 *                 type: string
 *                 description: Stellar public address
 *               pk:
 *                 type: string
 *                 description: Private key
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
    const { name, address, pk } = req.body;

    // Validate required fields
    if (!name || !address || !pk) {
      return res.status(400).json({
        success: false,
        message: "name, address, and pk are required",
      });
    }

    const userRepository = AppDataSource.getRepository(User);

    // Check for existing user (name is unique)
    const existingUser = await userRepository.findOne({
      where: { name },
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User with this name already exists",
      });
    }

    // Create user
    const user = userRepository.create({
      name,
      address,
      pk,
      // isDeployed and tokenType will use defaults
    });

    // Save user
    const savedUser = await userRepository.save(user);

    // Log user creation
    await auditLogService.log({
      userId: savedUser.id,
      action: AuditAction.USER_CREATED,
      severity: AuditSeverity.INFO,
      ipAddress:
        (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        (req.headers["x-real-ip"] as string) ||
        req.socket.remoteAddress ||
        "unknown",
      userAgent: req.headers["user-agent"],
      metadata: { username: name, address },
    });

    //  Return success
    return res.status(201).json({
      success: true,
      userId: savedUser.id,
    });
  } catch (error) {
    logger.error("Signup error", { error, name: req.body?.name });
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * @swagger
 * /api/account/{userId}/transactions:
 *   get:
 *     summary: Get paginated Stellar transaction history
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the user
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [funding, deployment, swap, transfer, all]
 *         description: Filter by transaction type
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start date filter (ISO 8601)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End date filter (ISO 8601)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of transactions per page
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Pagination cursor from previous response
 *     responses:
 *       200:
 *         description: Paginated transaction list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 transactions:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/TransactionHistoryItem'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     nextCursor:
 *                       type: string
 *                     prevCursor:
 *                       type: string
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User not found
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
router.get(
  "/account/:userId/transactions",
  authenticateToken,
  requireOwnerOrElevated("userId"),
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;

      // Ensure userId is a string
      if (!userId || Array.isArray(userId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid userId parameter",
        });
      }

      // Extract and validate query parameters
      const { type, startDate, endDate, limit, cursor } = req.query as Record<
        string,
        string | undefined
      >;

      // Validate type parameter
      const validTypes = ["funding", "deployment", "swap", "transfer", "all"];
      if (type && !validTypes.includes(type)) {
        return res.status(400).json({
          success: false,
          message: `Invalid type. Must be one of: ${validTypes.join(", ")}`,
        });
      }

      // Validate limit parameter
      const parsedLimit = limit ? parseInt(limit, 10) : 20;
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
        return res.status(400).json({
          success: false,
          message: "Limit must be a number between 1 and 100",
        });
      }

      // Validate date parameters
      if (startDate && isNaN(Date.parse(startDate))) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid startDate format. Use ISO 8601 format (e.g., 2024-01-01T00:00:00Z)",
        });
      }

      if (endDate && isNaN(Date.parse(endDate))) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid endDate format. Use ISO 8601 format (e.g., 2024-01-01T00:00:00Z)",
        });
      }

      // Build query parameters
      const queryParams: TransactionQueryParams = {
        type: type as TransactionType,
        startDate,
        endDate,
        limit: parsedLimit,
        cursor,
      };

      // Fetch transaction history
      const result = await transactionHistoryService.getTransactionHistory(
        userId,
        queryParams
      );

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error("Transaction history error:", error);
      const message =
        error instanceof Error ? error.message : "Internal server error";
      const statusCode = message.includes("User not found") ? 404 : 500;

      return res.status(statusCode).json({
        success: false,
        message,
      });
    }
  },

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
      // Check if it's a standard Error object
      const errorMessage =
        err instanceof Error ? err.message : "An unknown error occurred";

      res.status(500).json({ error: errorMessage });
    }
  })
);

// GET /admin/stats - Internal admin route for CPU and memory usage
router.get(
  "/admin/stats",
  authenticateToken,
  requireAdmin,
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
    // Dynamic import to avoid circular dependency issues
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSocketManager } = require("./socketManager");
    const socketManager = getSocketManager();

    interface SocketClient {
      socketId: string;
      userId?: string;
      connectedAt: Date;
    }

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
    // Dynamic import to avoid circular dependency issues
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSocketManager } = require("./socketManager");
    const socketManager = getSocketManager();

    interface SocketClient {
      socketId: string;
      connectedAt: Date;
    }

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
        return res
          .status(503)
          .json({
            success: false,
            message: "Sponsorship service not configured",
          });
      }

      const networkPassphrase =
        process.env.STELLAR_NETWORK === "mainnet"
          ? StellarSdk.Networks.PUBLIC
          : StellarSdk.Networks.TESTNET;

      const sponsorKeypair = StellarSdk.Keypair.fromSecret(sponsorSecret);
      const server = new StellarSdk.Horizon.Server(
        process.env.HORIZON_URL || "https://horizon-testnet.stellar.org"
      );

      await server.loadAccount(sponsorKeypair.publicKey());

      const builder = new SponsorshipTransactionBuilder(
        sponsorKeypair,
        networkPassphrase
      );
      builder.addBeginSponsorship({
        sponsor: sponsorKeypair.publicKey(),
        sponsoredAccount: user.address,
      });
      // Create the sponsored account entry
      builder.addSponsoredOperation(
        StellarSdk.Operation.createAccount({
          source: sponsorKeypair.publicKey(),
          destination: user.address,
          startingBalance: "0",
        })
      );
      builder.addEndSponsorship();

      const tx = builder.build();
      tx.sign(sponsorKeypair);

      await server.submitTransaction(tx);

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

export default router;
