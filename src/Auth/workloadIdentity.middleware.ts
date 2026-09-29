/**
 * workloadIdentity.middleware.ts
 *
 * Express middleware for internal service-to-service workload authentication.
 *
 * Three exported middleware factories:
 *
 *   requireWorkloadToken({ audience })
 *     Strictly requires a valid x-workload-token header.  Returns 401 if the
 *     header is absent and 403 if the token is invalid (wrong audience, env,
 *     expired, etc.).  Attach to /internal/* route groups.
 *
 *   optionalWorkloadToken({ audience })
 *     Reads the token if present, enriches req.workload and the
 *     ExecutionContext, then continues regardless.  Useful for routes that
 *     serve both internal callers and authenticated end-users.
 *
 *   createWorkloadClient(callerService, targetAudience)
 *     A helper — not a middleware — that returns an object with a
 *     `getAuthHeaders()` method.  Internal services use this to attach
 *     a fresh token to outbound internal HTTP calls.
 *
 * Express request augmentation
 * ────────────────────────────
 * When a token is accepted, req.workload is populated:
 *   {
 *     serviceId:   ServiceId,   // caller's ServiceId
 *     environment: ServiceEnvironment,
 *     jti:         string,      // JWT ID — for correlation
 *     expiresAt:   number,      // Unix seconds
 *   }
 *
 * The middleware also writes workloadServiceId / workloadEnvironment / workloadJti
 * into the AsyncLocalStorage ExecutionContext so that every log line and audit
 * record emitted during the request automatically carries workload provenance.
 */

import { Request, Response, NextFunction } from "express";
import {
  WorkloadIdentityService,
  WorkloadTokenError,
} from "./workloadIdentity.service";
import {
  ServiceId,
  ServiceEnvironment,
  VerifiedWorkloadIdentity,
  WORKLOAD_TOKEN_HEADER,
  WORKLOAD_SERVICE_HEADER,
} from "./workloadIdentity.types";
import { updateExecutionContext } from "../observability/context";
import logger from "../config/logger";

// ─── Express type augmentation ────────────────────────────────────────────────

declare module "express-serve-static-core" {
  interface Request {
    /**
     * Populated by the workload identity middleware after successful
     * verification.  Absent on requests that did not carry a workload token.
     */
    workload?: {
      serviceId: ServiceId;
      environment: ServiceEnvironment;
      jti: string;
      expiresAt: number;
    };
  }
}

// ─── Middleware options ───────────────────────────────────────────────────────

export interface WorkloadMiddlewareOptions {
  /**
   * The ServiceId this route group represents.  The middleware verifies that
   * the token's aud claim includes this value.
   * If omitted, audience binding is skipped (not recommended for production).
   */
  audience?: ServiceId;
  /**
   * Accepted deployment environments.  Defaults to the current NODE_ENV.
   */
  acceptedEnvironments?: ServiceEnvironment[];
  /**
   * Clock-skew tolerance in seconds (max 60).  Default: 0.
   */
  clockSkewSeconds?: number;
}

// ─── Shared helper: extract token and service ─────────────────────────────────

function extractToken(req: Request): string | undefined {
  // Primary: dedicated workload header
  const workloadHeader = req.headers[WORKLOAD_TOKEN_HEADER];
  if (workloadHeader) {
    return Array.isArray(workloadHeader) ? workloadHeader[0] : workloadHeader;
  }
  // Secondary: fall back to Authorization Bearer for services that already
  // use that pattern for internal calls
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    // Only treat it as a workload token when the x-workload-service header
    // is also present — that header signals an internal caller
    const serviceHeader = req.headers[WORKLOAD_SERVICE_HEADER];
    if (serviceHeader) {
      return authHeader.slice(7);
    }
  }
  return undefined;
}

/** Enrich the AsyncLocalStorage context and req.workload from the verified identity */
function enrichContext(req: Request, identity: VerifiedWorkloadIdentity): void {
  req.workload = {
    serviceId: identity.serviceId,
    environment: identity.environment,
    jti: identity.jti,
    expiresAt: identity.expiresAt,
  };

  updateExecutionContext({
    workloadServiceId: identity.serviceId,
    workloadEnvironment: identity.environment,
    workloadJti: identity.jti,
  });
}

// ─── requireWorkloadToken ─────────────────────────────────────────────────────

/**
 * Strict workload authentication middleware.
 *
 * Usage:
 *   router.use(requireWorkloadToken({ audience: ServiceId.AGENT_ORCHESTRATOR }));
 */
export function requireWorkloadToken(options: WorkloadMiddlewareOptions = {}) {
  // Lazily resolve the service to allow construction before env is set
  const getService = (() => {
    let svc: WorkloadIdentityService | undefined;
    return () => {
      if (!svc) svc = new WorkloadIdentityService();
      return svc;
    };
  })();

  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const token = extractToken(req);
    if (!token) {
      logger.warn("requireWorkloadToken: missing token", {
        path: req.path,
        method: req.method,
        ip: req.ip,
      });
      res.status(401).json({
        success: false,
        message: "Workload identity token required (x-workload-token header)",
        code: "WORKLOAD_TOKEN_MISSING",
      });
      return;
    }

    try {
      const identity = await getService().verify(token, {
        acceptorService: options.audience,
        acceptedEnvironments: options.acceptedEnvironments,
        clockSkewSeconds: options.clockSkewSeconds,
      });

      enrichContext(req, identity);

      logger.debug("requireWorkloadToken: accepted", {
        caller: identity.serviceId,
        audience: options.audience,
        env: identity.environment,
        jti: identity.jti,
        ttlRemaining: identity.remainingTtlSeconds,
      });

      next();
    } catch (err) {
      if (err instanceof WorkloadTokenError) {
        const statusCode = tokenErrorToStatus(err.reason);
        logger.warn("requireWorkloadToken: rejected", {
          reason: err.reason,
          path: req.path,
          method: req.method,
          ip: req.ip,
        });
        res.status(statusCode).json({
          success: false,
          message: "Workload token rejected",
          code: `WORKLOAD_TOKEN_${err.reason.toUpperCase()}`,
        });
        return;
      }
      logger.error("requireWorkloadToken: unexpected error", {
        error: (err as Error).message,
      });
      res.status(500).json({
        success: false,
        message: "Internal authentication error",
      });
    }
  };
}

// ─── optionalWorkloadToken ────────────────────────────────────────────────────

/**
 * Non-blocking workload identity middleware.
 * Enriches context when a valid token is present; continues regardless.
 *
 * Usage:
 *   router.use(optionalWorkloadToken({ audience: ServiceId.GATEWAY }));
 */
export function optionalWorkloadToken(options: WorkloadMiddlewareOptions = {}) {
  const getService = (() => {
    let svc: WorkloadIdentityService | undefined;
    return () => {
      if (!svc) svc = new WorkloadIdentityService();
      return svc;
    };
  })();

  return async (
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    const token = extractToken(req);
    if (!token) {
      next();
      return;
    }

    try {
      const identity = await getService().verify(token, {
        acceptorService: options.audience,
        acceptedEnvironments: options.acceptedEnvironments,
        clockSkewSeconds: options.clockSkewSeconds,
      });
      enrichContext(req, identity);
      logger.debug("optionalWorkloadToken: enriched context", {
        caller: identity.serviceId,
        jti: identity.jti,
      });
    } catch (err) {
      // Log but do not block — the token might belong to a legacy caller
      if (err instanceof WorkloadTokenError) {
        logger.warn("optionalWorkloadToken: invalid token (ignored)", {
          reason: err.reason,
          path: req.path,
        });
      } else {
        logger.error("optionalWorkloadToken: unexpected error", {
          error: (err as Error).message,
        });
      }
    }

    next();
  };
}

// ─── createWorkloadClient ─────────────────────────────────────────────────────

/**
 * Helper for outbound internal HTTP calls.  Returns a `getAuthHeaders()`
 * method that issues a fresh token (or returns a cached one if still valid).
 *
 * Usage:
 *   const client = createWorkloadClient(
 *     ServiceId.GATEWAY,
 *     ServiceId.AGENT_ORCHESTRATOR,
 *   );
 *   const headers = await client.getAuthHeaders();
 *   await fetch("http://internal/route", { headers });
 */
export function createWorkloadClient(
  callerService: ServiceId,
  targetAudience: ServiceId,
  opts: { ttlSeconds?: number; refreshThresholdSeconds?: number } = {}
) {
  const { ttlSeconds = 300, refreshThresholdSeconds = 60 } = opts;

  const getService = (() => {
    let svc: WorkloadIdentityService | undefined;
    return () => {
      if (!svc) svc = new WorkloadIdentityService();
      return svc;
    };
  })();

  let cachedToken: string | undefined;

  return {
    /**
     * Returns headers that carry a valid workload token.
     * Automatically refreshes when the cached token is within
     * `refreshThresholdSeconds` of expiry.
     */
    async getAuthHeaders(): Promise<Record<string, string>> {
      const svc = getService();
      if (!cachedToken || svc.shouldRefresh(cachedToken, refreshThresholdSeconds)) {
        cachedToken = await svc.issue({
          callerService,
          audience: targetAudience,
          ttlSeconds,
        });
      }
      return {
        [WORKLOAD_TOKEN_HEADER]: cachedToken,
        [WORKLOAD_SERVICE_HEADER]: callerService,
      };
    },

    /** Force a fresh token on the next call regardless of TTL */
    invalidate(): void {
      cachedToken = undefined;
    },
  };
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function tokenErrorToStatus(reason: WorkloadTokenError["reason"]): number {
  switch (reason) {
    case "missing_secret":
      return 500; // misconfiguration
    case "expired":
    case "invalid_signature":
    case "malformed":
      return 401;
    case "wrong_audience":
    case "wrong_environment":
      return 403;
    default:
      return 401;
  }
}
