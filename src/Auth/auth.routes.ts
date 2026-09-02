import { Router } from "express";
import { container } from "tsyringe";
import JwtService from "./jwt.service";
import UserService from "./user.service";
import { authenticateToken } from "./auth.middleware";
import { validateBody, ApiError, ok } from "../contracts";
import {
  LoginDto,
  RefreshTokenDto,
  LogoutDto,
} from "../validators/dto/AuthDto";
import { asyncHandler } from "../utils/expressAsync";
import logger from "../config/logger";
import { auditLogService } from "../AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../AuditLog/auditLog.entity";

const router = Router();

/**
 * POST /auth/login — Login and get token pair
 *
 * Contract:
 *   - body: `{ name: string }` (validated by `LoginDto`)
 *   - 200 OK on success: `{ success: true, data: { user, ...tokens } }`
 *   - 404 NOT_FOUND: `{ success: false, status: 404, error: { code: "NOT_FOUND", ... } }`
 *   - 422 VALIDATION_ERROR: same envelope, auto via `validateBody`
 *   - 500 INTERNAL_SERVER_ERROR: same envelope via central handler
 */
router.post(
  "/login",
  validateBody(LoginDto),
  asyncHandler(async (req, res) => {
    const { name } = req.body as LoginDto;
    const userService = container.resolve(UserService);
    const user = await userService.getUserByName(name);

    if (!user) {
      await auditLogService.logFromRequest(req, AuditAction.LOGIN_FAILED, {
        severity: AuditSeverity.WARNING,
        success: false,
        metadata: { username: name, reason: "User not found" },
      });

      throw ApiError.notFound("User not found");
    }

    const jwtService = container.resolve(JwtService);
    const tokens = await jwtService.generateTokenPair(
      user.id,
      user.name,
      user.role
    );

    await auditLogService.logFromRequest(req, AuditAction.LOGIN_SUCCESS, {
      userId: user.id,
      severity: AuditSeverity.INFO,
      metadata: { username: name, role: user.role },
    });

    logger.info("User logged in", {
      userId: user.id,
      name: user.name,
      role: user.role,
    });

    return ok(res, {
      user: {
        id: user.id,
        name: user.name,
        address: user.address,
      },
      ...tokens,
    });
  })
);

/**
 * POST /auth/refresh — Rotate refresh token and get new token pair
 */
router.post(
  "/refresh",
  validateBody(RefreshTokenDto),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as RefreshTokenDto;
    const jwtService = container.resolve(JwtService);

    // Errors thrown by `rotateRefreshToken` (`UnauthorizedError`,
    // `BadError`) are `ApiError` subclasses and will be rendered by the
    // central error-handler middleware with the canonical envelope.
    const tokens = await jwtService.rotateRefreshToken(refreshToken);

    await auditLogService.logFromRequest(req, AuditAction.TOKEN_REFRESH, {
      severity: AuditSeverity.INFO,
    });

    return ok(res, tokens, "Tokens refreshed");
  })
);

/**
 * POST /auth/logout — Revoke current refresh token
 */
router.post(
  "/logout",
  validateBody(LogoutDto),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as LogoutDto;
    const jwtService = container.resolve(JwtService);

    // `BadError("Token not found")` and `UnauthorizedError` flow through
    // the central error handler with the canonical envelope, so we just
    // let them propagate.
    await jwtService.revokeToken(refreshToken, "User logout");

    await auditLogService.logFromRequest(req, AuditAction.LOGOUT, {
      severity: AuditSeverity.INFO,
    });

    logger.info("User logged out");

    return ok(res, undefined, "Logged out successfully");
  })
);

/**
 * POST /auth/logout-all — Revoke all refresh tokens for user (logout from all devices)
 */
router.post(
  "/logout-all",
  authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw ApiError.unauthorized();
    }

    const jwtService = container.resolve(JwtService);
    await jwtService.revokeAllUserTokens(
      req.user.userId,
      "User logout from all devices"
    );

    logger.info("User logged out from all devices", {
      userId: req.user.userId,
    });

    return ok(res, undefined, "Logged out from all devices successfully");
  })
);

/**
 * GET /auth/sessions — Get all active sessions for current user
 */
router.get(
  "/sessions",
  authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw ApiError.unauthorized();
    }

    const jwtService = container.resolve(JwtService);
    const tokens = await jwtService.getUserActiveTokens(req.user.userId);

    return ok(res, {
      sessions: tokens.map((token) => ({
        id: token.id,
        createdAt: token.createdAt,
        expiresAt: token.expiresAt,
      })),
    });
  })
);

export default router;
