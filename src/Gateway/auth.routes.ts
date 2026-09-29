import { Router, Request, Response, NextFunction } from "express";
import { authService } from "../Auth/auth.service";
import RateLimiterService from "./middleware/rateLimiter.service";
import { BadError } from "../utils/error";
import logger from "../config/logger";

const router = Router();

// Redis-backed rate limiter for auth endpoints (stricter than general)
const authLimiter = RateLimiterService.createAuthLimiter();

/**
 * POST /auth/forgot-password
 * Initiates password reset flow by sending a reset email.
 */
router.post(
  "/forgot-password",
  authLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = req.body;

      if (!email) {
        throw new BadError("Email is required");
      }

      const result = await authService.forgotPassword({ email });

      return res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      logger.error("Forgot password error", {
        error: error instanceof Error ? error.message : "Unknown error",
        email: req.body?.email,
      });
      next(error);
    }
  }
);

/**
 * POST /auth/reset-password
 * Resets user password with a valid JWT reset token.
 */
router.post(
  "/reset-password",
  authLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token, newPassword } = req.body;

      if (!token) {
        throw new BadError("Reset token is required");
      }

      if (!newPassword) {
        throw new BadError("New password is required");
      }

      const result = await authService.resetPassword({ token, newPassword });

      return res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      logger.error("Reset password error", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      next(error);
    }
  }
);

/**
 * POST /auth/verify-email
 * Verifies user email with JWT verification token.
 */
router.post(
  "/verify-email",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = req.body;

      if (!token) {
        throw new BadError("Verification token is required");
      }

      const result = await authService.verifyEmail({ token });

      return res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      logger.error("Verify email error", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      next(error);
    }
  }
);

/**
 * GET /auth/verify-email
 * Verifies user email via link click (token in query string).
 */
router.get(
  "/verify-email",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = req.query;

      if (!token || typeof token !== "string") {
        throw new BadError("Verification token is required");
      }

      const result = await authService.verifyEmail({ token });

      return res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      logger.error("Verify email error", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      next(error);
    }
  }
);

/**
 * POST /auth/send-verification
 * Sends email verification to a user.
 */
router.post(
  "/send-verification",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.body;

      if (!userId) {
        throw new BadError("User ID is required");
      }

      const result = await authService.sendEmailVerification(userId);

      return res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      logger.error("Send verification error", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId: req.body?.userId,
      });
      next(error);
    }
  }
);

export default router;
