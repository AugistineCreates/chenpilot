/**
 * KYC Route Rate Limiting
 *
 * The POST /api/kyc/submit endpoint has a dedicated, stricter rate limiter
 * (RateLimiterService.createKycLimiter) distinct from the general API limiter.
 *
 * Configuration:
 *   Window:  1 hour
 *   Limit:   3 requests per window
 *   Key:     req.user?.id (authenticated) | req.ip (fallback)
 *
 * Rationale: KYC submissions handle PII and invoke third-party KYC provider
 * APIs that charge per-call. The strict limit prevents abuse, credential
 * stuffing, and runaway costs from a single user or IP.
 *
 * The general API limiter (100 req/min per IP) also applies on top.
 */
import { Router, Request, Response, NextFunction } from "express";
import RateLimiterService from "../../Gateway/middleware/rateLimiter.service";
import { kycService } from "./index";
import { authenticate } from "../../Auth/auth";
import { UnauthorizedError, BadError } from "../../utils/error";
import logger from "../../config/logger";

const router = Router();

const kycRateLimiter = RateLimiterService.createKycLimiter();

/**
 * POST /api/kyc/submit
 * Submit KYC verification request
 * Rate limited: 3 requests per hour per user
 */
router.post(
  "/submit",
  kycRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, provider, verificationData } = req.body;

      // Authenticate user
      if (!userId) {
        throw new UnauthorizedError("User ID is required");
      }

      const user = await authenticate(userId);
      if (!user) {
        throw new UnauthorizedError("Invalid or expired credentials");
      }

      // Validate verification data
      if (!verificationData) {
        throw new BadError("Verification data is required");
      }

      // Submit verification
      const result = await kycService.submitVerification(
        {
          person: {
            userId,
            email: user.email,
            ...verificationData,
          },
          timestamp: new Date(),
        },
        provider
      );

      logger.info("KYC verification submitted", {
        userId,
        provider: provider || "default",
        status: result.status,
        referenceId: result.providerReferenceId,
      });

      return res.status(200).json({
        success: true,
        data: result,
        message: "KYC verification submitted successfully",
      });
    } catch (error) {
      logger.error("KYC submission error", {
        userId: req.body?.userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      next(error);
    }
  }
);

/**
 * GET /api/kyc/status/:referenceId
 * Check KYC verification status
 * Lighter rate limiting since this is read-only
 */
router.get(
  "/status/:referenceId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { referenceId } = req.params;
      const { provider } = req.query;

      if (!referenceId) {
        throw new BadError("Reference ID is required");
      }

      const status = await kycService.getVerificationStatus(
        referenceId,
        provider as string | undefined
      );

      if (!status) {
        return res.status(404).json({
          success: false,
          message: "Verification not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: status,
      });
    } catch (error) {
      logger.error("KYC status check error", {
        referenceId: req.params?.referenceId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      next(error);
    }
  }
);

/**
 * GET /api/kyc/providers
 * Get list of available KYC providers
 */
router.get("/providers", async (req: Request, res: Response) => {
  try {
    const providers = kycService.getRegisteredProviders();

    return res.status(200).json({
      success: true,
      data: {
        providers,
        count: providers.length,
      },
    });
  } catch (error) {
    logger.error("Error fetching KYC providers", { error });
    return res.status(500).json({
      success: false,
      message: "Failed to fetch providers",
    });
  }
});

/**
 * GET /api/kyc/health
 * Health check for KYC providers
 */
router.get(
  "/health",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { provider } = req.query;

      const isHealthy = await kycService.healthCheck(
        provider as string | undefined
      );

      return res.status(isHealthy ? 200 : 503).json({
        success: isHealthy,
        status: isHealthy ? "healthy" : "unhealthy",
      });
    } catch (error) {
      logger.error("KYC health check error", { error });
      next(error);
    }
  }
);

export default router;
