import express from "express";
import path from "path";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { container } from "tsyringe";
import swaggerUi from "swagger-ui-express";
import routes from "./routes";
import authRoutes from "./auth.routes";
import { swaggerSpec } from "./swagger";
import requestLogger from "../middleware/requestLogger";
import { ipBlacklistMiddleware, ipBlacklistRoutes } from "../Security";

import { authenticate } from "../Auth/auth";
import UserService from "../Auth/user.service";
import { validateQuery } from "../Agents/validationService";
import { intentAgent } from "../Agents/agents/intentagent";
import { ErrorHandler } from "./middleware/errorHandler";
import { UnauthorizedError, ValidationError, BadError } from "../utils/error";
import { healthService } from "../services/healthService";

const app = express();

// Serve static files for Telegram WebApp
app.use("/settings", express.static(path.join(__dirname, "../../public")));

// --- GLOBAL SECURITY MIDDLEWARE ---
// AC: Helmet configured securely
app.use(helmet());

// AC: CORS configured securely
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS || "*", // In production, replace * with your domain
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);

app.use(express.json());
app.use(requestLogger);
app.use(ipBlacklistMiddleware);

// --- SWAGGER API DOCS ---
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// --- RATE LIMITING STRATEGY (GLOBAL/SENSITIVE) ---

/**
 * AC: Authenticated/Sensitive Rate Limit
 * Applied to AI queries and wallet-related operations.
 * Limit: 20 requests per minute per IP.
 */
const sensitiveLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    error:
      "Sensitive action limit reached. Please wait a moment before trying again.",
  },
});

function createSuccess<T>(data: T, message: string) {
  return {
    success: true,
    data,
    message,
  };
}

/**
 * @swagger
 * /signup:
 *   post:
 *     summary: Create a new user
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
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Name is required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
app.post("/signup", async (req, res, next) => {
  try {
    const { name } = req.body;

    if (!name) {
      throw new BadError("Name is required");
    }

    const userService = container.resolve(UserService);
    const user = await userService.createUser({ name });

    res.status(201).json(createSuccess(user, "User created successfully"));
  } catch (error) {
    next(error);
  }
});

// Auth routes (password reset, email verification)
app.use("/auth", authRoutes);

app.post("/query", sensitiveLimiter, async (req, res, next) => {
  /**
   * @swagger
   * /query:
   *   post:
   *     summary: Send a natural-language query to the AI agent
   *     tags: [AI Agent]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - userId
   *               - query
   *             properties:
   *               userId:
   *                 type: string
   *                 format: uuid
   *                 description: ID of the authenticated user
   *               query:
   *                 type: string
   *                 description: Natural language command (e.g. "swap 100 XLM to USDC")
   *     responses:
   *       200:
   *         description: Query processed successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 result:
   *                   type: object
   *       401:
   *         description: Invalid credentials
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       422:
   *         description: Invalid query
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  // app.post("/query", async (req, res, next) => {
  try {
    const { userId, query } = req.body;

    const user = await authenticate(userId);

    if (!user) throw new UnauthorizedError("invalid credentials");

    const valid = await validateQuery(query, userId);
    if (!valid) throw new ValidationError("invalid query");

    // 3. intent → execution
    const result = await intentAgent.handle(query, userId);

    res.json({ result });
  } catch (error) {
    next(error);
  }
});

app.use("/api", routes);
app.use("/api/security/blacklist", ipBlacklistRoutes);
app.use("/api/prompts", promptRoutes);

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Liveness probe — always 200 while the process is running
 *     tags: [Ops]
 *     responses:
 *       200:
 *         description: Process is alive
 */
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "UP", timestamp: new Date().toISOString() });
});

/**
 * @swagger
 * /ready:
 *   get:
 *     summary: Readiness probe — 200 if healthy/degraded, 503 if critical deps are down
 *     tags: [Ops]
 *     responses:
 *       200:
 *         description: Service is ready (HEALTHY or DEGRADED)
 *       503:
 *         description: Service is not ready (UNHEALTHY — critical dependency down)
 */
app.get("/ready", async (_req, res) => {
  try {
    const report = await healthService.getFullReport();
    const httpStatus = report.overallStatus === "UNHEALTHY" ? 503 : 200;
    res.status(httpStatus).json(report);
  } catch (err) {
    res.status(503).json({
      overallStatus: "UNHEALTHY",
      timestamp: new Date().toISOString(),
      error: err instanceof Error ? err.message : "Health check failed",
    });
  }
});

app.use(ErrorHandler);

export default app;
