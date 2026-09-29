import { rateLimit, RateLimitRequestHandler } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { Request, Response } from "express";
import { getRedisClient } from "../../services/redis/client";
import logger from "../../config/logger";

interface RateLimitConfig {
  windowMs: number;
  limit: number;
  message: Record<string, string>;
  keyGenerator?: (req: Request, res: Response) => string;
}

/**
 * Creates a Redis-backed rate limiter for horizontal scaling
 * Ensures rate limits are shared across multiple instances
 */
export class RateLimiterService {
  /**
   * Create a Redis-backed rate limiter
   * Falls back to memory store if Redis is unavailable (fail-safe)
   */
  static createLimiter(config: RateLimitConfig): RateLimitRequestHandler {
    try {
      const redisClient = getRedisClient();

      // Create limiter with Redis store
      return rateLimit({
        store: new RedisStore({
          client: redisClient,
          prefix: "rate-limit:",
          send200: true,
        }),
        windowMs: config.windowMs,
        limit: config.limit,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        message: config.message,
        keyGenerator: config.keyGenerator,
        skip: (req: Request) => {
          // Don't rate limit health checks
          if (req.path === "/health" || req.path === "/ready") {
            return true;
          }
          return false;
        },
      });
    } catch (error) {
      logger.error("Error creating Redis rate limiter, falling back to memory store", {
        component: "RateLimiterService",
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Fall back to memory store if Redis is unavailable
      return rateLimit({
        windowMs: config.windowMs,
        limit: config.limit,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        message: config.message,
        keyGenerator: config.keyGenerator,
      });
    }
  }

  /**
   * Create a general API rate limiter
   * 100 requests per minute per IP
   */
  static createGeneralLimiter(): RateLimitRequestHandler {
    return this.createLimiter({
      windowMs: 1 * 60 * 1000, // 1 minute
      limit: 100,
      message: {
        success: "false",
        message: "Too many requests. Please slow down.",
      },
    });
  }

  /**
   * Create an auth/login rate limiter
   * 5 requests per 15 minutes per IP
   */
  static createAuthLimiter(): RateLimitRequestHandler {
    return this.createLimiter({
      windowMs: 15 * 60 * 1000, // 15 minutes
      limit: 5,
      message: {
        success: "false",
        message: "Too many attempts. Please try again later.",
      },
    });
  }

  /**
   * Create a KYC submission rate limiter
   * 3 requests per hour per user/IP (stricter than general)
   */
  static createKycLimiter(): RateLimitRequestHandler {
    return this.createLimiter({
      windowMs: 60 * 60 * 1000, // 1 hour
      limit: 3,
      message: {
        success: "false",
        message:
          "Too many KYC submissions. Please try again later. Each user is limited to 3 submissions per hour.",
      },
      keyGenerator: (req: Request) => {
        // Use user ID if authenticated, fall back to IP
        return req.user?.id || req.ip;
      },
    });
  }

  /**
   * Create a sensitive endpoint rate limiter
   * 10 requests per 5 minutes per IP
   */
  static createSensitiveLimiter(): RateLimitRequestHandler {
    return this.createLimiter({
      windowMs: 5 * 60 * 1000, // 5 minutes
      limit: 10,
      message: {
        success: "false",
        message: "Too many requests to this sensitive endpoint.",
      },
    });
  }
}

export default RateLimiterService;
