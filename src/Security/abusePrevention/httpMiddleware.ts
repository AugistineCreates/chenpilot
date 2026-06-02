import { NextFunction, Request, Response } from "express";
import { AbusePreventionService } from "./AbusePreventionService";
import { defaultAbusePreventionService } from "./serviceInstance";

export function extractClientIp(req: Request): string {
  const forwarded = (req.headers["x-forwarded-for"] as string | undefined)
    ?.split(",")[0]
    ?.trim();

  return forwarded || req.socket?.remoteAddress || req.ip || "unknown";
}

export function normalizeIp(ip: string): string {
  const trimmed = ip.trim();

  if (trimmed.startsWith("::ffff:")) {
    return trimmed.replace("::ffff:", "");
  }

  if (trimmed === "::1") {
    return "127.0.0.1";
  }

  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(trimmed)) {
    return trimmed.slice(0, trimmed.lastIndexOf(":"));
  }

  return trimmed;
}

export function createAbusePreventionMiddleware(
  action: string,
  service: AbusePreventionService = defaultAbusePreventionService
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ipAddress = normalizeIp(extractClientIp(req));
      (req as any).clientIP = ipAddress;

      const result = await service.evaluate({
        surface: "api",
        action,
        subject: {
          ipAddress,
          userId: (req as any).user?.userId || req.body?.userId,
        },
        metadata: {
          method: req.method,
          path: req.path,
        },
      });

      if (result.allowed) {
        next();
        return;
      }

      res.status(result.decision === "throttle" ? 429 : 403).json({
        success: false,
        error: result.decision === "throttle" ? "Too many requests" : "Access denied",
        message: result.reason,
        code: result.policyId,
        retryAfterMs: result.retryAfterMs,
      });
    } catch (error) {
      next(error);
    }
  };
}
