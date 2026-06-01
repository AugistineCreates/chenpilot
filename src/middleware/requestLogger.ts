import { Request, Response, NextFunction } from "express";
import logger from "../config/logger";

// Sensitive fields to exclude from request/response logging
const SENSITIVE_FIELDS = [
  "pk",
  "privateKey",
  "password",
  "token",
  "secret",
  "authorization",
];

/**
 * Redacts sensitive fields from an object
 */
function sanitizeObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item));
  }

  if (typeof obj === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const key in obj as Record<string, unknown>) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const lowerKey = key.toLowerCase();
        if (SENSITIVE_FIELDS.some((field) => lowerKey.includes(field))) {
          sanitized[key] = "[REDACTED]";
        } else {
          sanitized[key] = sanitizeObject(
            (obj as Record<string, unknown>)[key]
          );
        }
      }
    }
    return sanitized;
  }

  return obj;
}

/**
 * Express middleware for logging HTTP requests and responses
 */
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const startTime = Date.now();
  const { method, originalUrl, ip, headers } = req;

  // Log incoming request
  logger.info("Incoming request", {
    method,
    url: originalUrl,
    ip: ip || req.socket.remoteAddress,
    userAgent: headers["user-agent"],
    body: sanitizeObject(req.body),
  });

  // Capture original res.json to log response
  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    const duration = Date.now() - startTime;

    logger.info("Outgoing response", {
      method,
      url: originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      response: sanitizeObject(body),
    });

    return originalJson(body);
  };

  // Capture response finish event for requests that don't use res.json
  res.on("finish", () => {
    if (!res.headersSent) {
      return;
    }

    const duration = Date.now() - startTime;

    // Only log if we haven't already logged via res.json
    if (res.statusCode >= 400) {
      logger.warn("Request completed with error", {
        method,
        url: originalUrl,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
      });
    }
  });

  next();
};

export default requestLogger;
