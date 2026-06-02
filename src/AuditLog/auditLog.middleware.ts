/**
 * auditLog.middleware.ts  (Issue #344 — Security-Grade Audit Ledger)
 *
 * Express middleware layer:
 *   - auditLogMiddleware   — generic per-route audit logger (captures
 *                            correlationId, actorId, resource, status)
 *   - logFailedAuth        — dedicated 401/403 interceptor
 *
 * Correlation IDs are read from `req.correlationId` (set by
 * correlationIdMiddleware in auditLog.redaction.ts) and fall back to
 * the raw header value so the middleware works even when the global
 * correlation middleware is not mounted.
 */

import { Request, Response, NextFunction } from "express";
import { auditLogService } from "./auditLog.service";
import { AuditAction, AuditSeverity } from "./auditLog.entity";
import {
  AuditEventAction,
  AuditEventSeverity,
  EventCategory,
} from "./auditEvent.types";
import { generateCorrelationId } from "./auditLog.redaction";

// ─── Internal Helper ──────────────────────────────────────────────────────────

function resolveCorrelationId(req: Request): string {
  return (
    (req as Request & { correlationId?: string }).correlationId ??
    (req.headers["x-correlation-id"] as string | undefined) ??
    (req.headers["x-request-id"] as string | undefined) ??
    generateCorrelationId()
  );
}

function resolveActorId(req: Request): string | undefined {
  return req.user?.userId;
}

// ─── Generic Per-Route Middleware ─────────────────────────────────────────────

/**
 * Factory that returns an Express middleware which records an audit event
 * after the response has been sent.
 *
 * @param action  Typed action string (from AuthAction / AdminAction / etc.)
 * @param category Optional category override — inferred from action prefix otherwise
 * @param severity Optional severity override
 */
export function auditLogMiddleware(
  action: AuditAction | AuditEventAction | string,
  category?: EventCategory,
  severity?: AuditSeverity | AuditEventSeverity
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send.bind(res);

    res.send = function (data: unknown): Response {
      res.send = originalSend;

      setImmediate(async () => {
        try {
          const success = res.statusCode >= 200 && res.statusCode < 400;
          const correlationId = resolveCorrelationId(req);
          const actorId = resolveActorId(req);

          await auditLogService.logEvent({
            correlationId,
            action: action as AuditEventAction,
            category,
            severity:
              (severity as AuditEventSeverity) ??
              (success
                ? AuditEventSeverity.INFO
                : AuditEventSeverity.ERROR),
            actor: {
              userId: actorId,
              ipAddress:
                ((req.headers["x-forwarded-for"] as string) ?? "")
                  .split(",")[0]
                  ?.trim() ||
                (req.headers["x-real-ip"] as string) ||
                req.socket.remoteAddress ||
                "unknown",
              userAgent: req.headers["user-agent"],
            },
            resource: {
              endpoint: `${req.method} ${req.path}`,
            },
            metadata: {
              statusCode: res.statusCode,
              method: req.method,
              path: req.path,
              query: req.query,
            },
            success,
          });
        } catch (err) {
          // Audit failures must never bubble up to the client
          console.error("auditLogMiddleware: failed to persist event", err);
        }
      });

      return originalSend(data);
    };

    next();
  };
}

// ─── Auth-Failure Interceptor ─────────────────────────────────────────────────

/**
 * Middleware that watches for 401 / 403 responses and records a
 * LOGIN_FAILED / PERMISSION_DENIED event automatically.
 */
export async function logFailedAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const originalJson = res.json.bind(res);

  res.json = function (data: unknown): Response {
    res.json = originalJson;

    setImmediate(async () => {
      try {
        if (res.statusCode === 401 || res.statusCode === 403) {
          const correlationId = resolveCorrelationId(req);

          await auditLogService.logEvent({
            correlationId,
            action:
              res.statusCode === 401
                ? AuditAction.LOGIN_FAILED
                : AuditAction.PERMISSION_DENIED,
            category: EventCategory.POLICY,
            severity: AuditEventSeverity.WARNING,
            actor: {
              userId: req.user?.userId,
              ipAddress:
                ((req.headers["x-forwarded-for"] as string) ?? "")
                  .split(",")[0]
                  ?.trim() ||
                req.socket.remoteAddress ||
                "unknown",
              userAgent: req.headers["user-agent"],
            },
            resource: { endpoint: req.path },
            metadata: {
              statusCode: res.statusCode,
              body: typeof data === "object" ? data : {},
            },
            success: false,
          });
        }
      } catch (err) {
        console.error("logFailedAuth: failed to persist event", err);
      }
    });

    return originalJson(data);
  };

  next();
}
