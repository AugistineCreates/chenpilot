import { Request, Response, NextFunction } from "express";
import logger from "../config/logger";
import {
  defaultAbusePreventionService,
  extractClientIp,
  normalizeIp,
} from "./abusePrevention";

/**
 * Middleware to block requests from blacklisted IP addresses
 * Should be applied early in the middleware chain
 */
export const ipBlacklistMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const normalizedIP = normalizeIp(extractClientIp(req));
    (req as any).clientIP = normalizedIP;

    const decision = await defaultAbusePreventionService.evaluate({
      surface: "api",
      action: "*",
      subject: {
        ipAddress: normalizedIP,
        userId: (req as any).user?.userId || req.body?.userId,
      },
      metadata: {
        path: req.path,
        method: req.method,
      },
    });

    if (!decision.allowed) {
      logger.warn("Blocked request from blacklisted IP", {
        ip: normalizedIP,
        path: req.path,
        method: req.method,
        userAgent: req.get("user-agent"),
        policyId: decision.policyId,
      });

      res.status(403).json({
        success: false,
        error: "Access denied",
        message: "Your IP address has been blocked due to suspicious activity",
        code: "IP_BLACKLISTED",
      });
      return;
    }

    next();
  } catch (error) {
    // Log error but don't block request on middleware failure
    logger.error("Error in IP blacklist middleware", {
      error,
      ip: req.ip,
    });

    // Continue to next middleware on error (fail open)
    next();
  }
};

export default ipBlacklistMiddleware;
