/**
 * workloadIdentity.service.ts
 *
 * Workload identity token issuance, verification, and rotation.
 *
 * Security model
 * ──────────────
 * • Tokens are signed with HMAC-SHA-256 using WORKLOAD_TOKEN_SECRET (≥ 32 chars).
 * • Every token carries: iss, sub (caller), aud (acceptor), env, jti, iat, exp.
 * • Verification enforces: valid signature, not expired, audience binding,
 *   environment binding.  Any mismatch throws WorkloadTokenError.
 * • Issuer-outage behaviour: when verification fails due to an environment
 *   misconfiguration the service logs a warning but still throws — callers
 *   must handle WorkloadTokenError and surface a 401 upstream.
 * • Key rotation: a secondary secret WORKLOAD_TOKEN_SECRET_SECONDARY can be
 *   set.  The service tries the primary key first; on failure it retries with
 *   the secondary.  Issuing always uses the primary.
 *
 * Usage
 * ─────
 *   const svc = container.resolve(WorkloadIdentityService);
 *   const token = await svc.issue({ audience: ServiceId.AGENT_ORCHESTRATOR });
 *   const identity = await svc.verify(token, { acceptorService: ServiceId.AGENT_ORCHESTRATOR });
 */

import { injectable } from "tsyringe";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import logger from "../config/logger";
import {
  ServiceId,
  ServiceEnvironment,
  WorkloadTokenPayload,
  VerifiedWorkloadIdentity,
  TokenIssuanceOptions,
  TokenVerificationOptions,
  WORKLOAD_ISSUER,
  WORKLOAD_TOKEN_DEFAULT_TTL_SECONDS,
  WORKLOAD_TOKEN_MAX_TTL_SECONDS,
  WORKLOAD_TOKEN_MAX_CLOCK_SKEW_SECONDS,
} from "./workloadIdentity.types";
import { auditLogService } from "../AuditLog/auditLog.service";
import {
  WorkloadIdentityAction,
  AuditEventSeverity,
  EventCategory,
} from "../AuditLog/auditEvent.types";

// ─── Error class ──────────────────────────────────────────────────────────────

export class WorkloadTokenError extends Error {
  constructor(
    message: string,
    public readonly reason:
      | "invalid_signature"
      | "expired"
      | "wrong_audience"
      | "wrong_environment"
      | "malformed"
      | "missing_secret"
  ) {
    super(message);
    this.name = "WorkloadTokenError";
  }
}

// ─── Environment mapping ──────────────────────────────────────────────────────

function nodeEnvToServiceEnv(nodeEnv: string | undefined): ServiceEnvironment {
  switch (nodeEnv?.toLowerCase()) {
    case "production":
      return ServiceEnvironment.PRODUCTION;
    case "staging":
      return ServiceEnvironment.STAGING;
    case "test":
      return ServiceEnvironment.TEST;
    default:
      return ServiceEnvironment.DEVELOPMENT;
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

@injectable()
export class WorkloadIdentityService {
  private readonly primarySecret: string;
  private readonly secondarySecret: string | undefined;
  private readonly defaultEnvironment: ServiceEnvironment;
  private readonly defaultCallerService: ServiceId | undefined;

  constructor() {
    const primary = process.env.WORKLOAD_TOKEN_SECRET;
    if (!primary || primary.length < 32) {
      throw new Error(
        "WORKLOAD_TOKEN_SECRET must be set and be at least 32 characters. " +
          "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
      );
    }
    this.primarySecret = primary;

    const secondary = process.env.WORKLOAD_TOKEN_SECRET_SECONDARY;
    this.secondarySecret =
      secondary && secondary.length >= 32 ? secondary : undefined;

    this.defaultEnvironment = nodeEnvToServiceEnv(process.env.NODE_ENV);

    const configuredService = process.env.WORKLOAD_SERVICE_ID as ServiceId | undefined;
    if (configuredService && Object.values(ServiceId).includes(configuredService)) {
      this.defaultCallerService = configuredService;
    }
  }

  // ─── Token issuance ─────────────────────────────────────────────────────────

  /**
   * Issue a short-lived workload identity token.
   *
   * @example
   *   const token = await svc.issue({
   *     audience: ServiceId.AGENT_ORCHESTRATOR,
   *     ttlSeconds: 300,
   *   });
   */
  async issue(options: TokenIssuanceOptions): Promise<string> {
    const {
      audience,
      ttlSeconds,
      environment,
      callerService,
    } = options;

    const caller = callerService ?? this.defaultCallerService;
    if (!caller) {
      throw new Error(
        "WorkloadIdentityService.issue: caller service must be supplied " +
          "via options.callerService or WORKLOAD_SERVICE_ID env var."
      );
    }

    const env = environment ?? this.defaultEnvironment;
    const rawTtl = ttlSeconds ?? WORKLOAD_TOKEN_DEFAULT_TTL_SECONDS;
    const ttl = Math.min(rawTtl, WORKLOAD_TOKEN_MAX_TTL_SECONDS);
    if (ttl !== rawTtl) {
      logger.warn(
        `WorkloadIdentityService: requested TTL ${rawTtl}s exceeds maximum ` +
          `${WORKLOAD_TOKEN_MAX_TTL_SECONDS}s; capping.`
      );
    }

    const jti = randomUUID();
    const now = Math.floor(Date.now() / 1000);

    const payload: Omit<WorkloadTokenPayload, "iat" | "exp"> = {
      iss: WORKLOAD_ISSUER,
      sub: caller,
      svc: caller,
      aud: audience,
      jti,
      env,
    };

    const token = jwt.sign(payload, this.primarySecret, {
      expiresIn: ttl,
      algorithm: "HS256",
    });

    // Audit: token issued
    try {
      await auditLogService.logEvent({
        action: WorkloadIdentityAction.WORKLOAD_TOKEN_ISSUED,
        category: EventCategory.INTEGRATION,
        severity: AuditEventSeverity.INFO,
        actor: { serviceId: caller },
        success: true,
        metadata: {
          callerService: caller,
          audience,
          environment: env,
          jti,
          ttlSeconds: ttl,
          issuedAt: now,
          expiresAt: now + ttl,
        },
      });
    } catch (auditErr) {
      logger.warn("WorkloadIdentityService: failed to write token-issued audit event", {
        error: (auditErr as Error).message,
      });
    }

    logger.info("WorkloadIdentityService: token issued", {
      caller,
      audience,
      env,
      jti,
      ttlSeconds: ttl,
    });

    return token;
  }

  // ─── Token verification ─────────────────────────────────────────────────────

  /**
   * Verify an inbound workload identity token.
   *
   * Enforces:
   *   1. Valid HMAC signature (primary key, then secondary if configured)
   *   2. Token not expired (respects clockSkewSeconds if set)
   *   3. Audience claim matches acceptorService
   *   4. Environment claim matches accepted environments
   *
   * Throws WorkloadTokenError on any violation.
   */
  async verify(
    token: string,
    options: TokenVerificationOptions = {}
  ): Promise<VerifiedWorkloadIdentity> {
    const {
      acceptorService,
      acceptedEnvironments,
      clockSkewSeconds = 0,
    } = options;

    const clampedSkew = Math.min(
      Math.max(0, clockSkewSeconds),
      WORKLOAD_TOKEN_MAX_CLOCK_SKEW_SECONDS
    );
    const acceptedEnvSet = acceptedEnvironments
      ? new Set(acceptedEnvironments)
      : new Set([this.defaultEnvironment]);

    // 1. Decode and verify signature
    let payload: WorkloadTokenPayload;
    try {
      payload = this.decodeWithFallback(token, clampedSkew);
    } catch (err) {
      const reason = classifyJwtError(err);
      await this.auditRejected(token, reason, acceptorService, {
        verificationError: (err as Error).message,
      });
      throw new WorkloadTokenError(
        `Workload token rejected: ${reason}`,
        reason
      );
    }

    // 2. Audience binding
    if (acceptorService !== undefined) {
      const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!audiences.includes(acceptorService)) {
        await this.auditRejected(token, "wrong_audience", acceptorService, {
          expectedAud: acceptorService,
          actualAud: payload.aud,
          caller: payload.sub,
        });
        throw new WorkloadTokenError(
          `Workload token audience mismatch: expected '${acceptorService}', got '${JSON.stringify(payload.aud)}'`,
          "wrong_audience"
        );
      }
    }

    // 3. Environment binding
    if (!acceptedEnvSet.has(payload.env)) {
      await this.auditRejected(token, "wrong_environment", acceptorService, {
        expectedEnvs: [...acceptedEnvSet],
        actualEnv: payload.env,
        caller: payload.sub,
      });
      throw new WorkloadTokenError(
        `Workload token environment mismatch: token env '${payload.env}' not in [${[...acceptedEnvSet].join(",")}]`,
        "wrong_environment"
      );
    }

    // 4. Issuer check
    if (payload.iss !== WORKLOAD_ISSUER) {
      await this.auditRejected(token, "malformed", acceptorService, {
        issuer: payload.iss,
      });
      throw new WorkloadTokenError(
        `Workload token issuer invalid: '${payload.iss}'`,
        "malformed"
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const remainingTtlSeconds = Math.max(0, payload.exp - now);

    const identity: VerifiedWorkloadIdentity = {
      serviceId: payload.sub,
      audience: payload.aud,
      environment: payload.env,
      jti: payload.jti,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
      remainingTtlSeconds,
    };

    // Audit: verification success
    try {
      await auditLogService.logEvent({
        action: WorkloadIdentityAction.WORKLOAD_TOKEN_VERIFIED,
        category: EventCategory.INTEGRATION,
        severity: AuditEventSeverity.INFO,
        actor: { serviceId: payload.sub },
        success: true,
        metadata: {
          callerService: payload.sub,
          audience: payload.aud,
          environment: payload.env,
          jti: payload.jti,
          remainingTtlSeconds,
          acceptorService,
        },
      });
    } catch (auditErr) {
      logger.warn("WorkloadIdentityService: failed to write token-verified audit event", {
        error: (auditErr as Error).message,
      });
    }

    logger.debug("WorkloadIdentityService: token verified", {
      caller: payload.sub,
      audience: payload.aud,
      env: payload.env,
      jti: payload.jti,
      remainingTtlSeconds,
    });

    return identity;
  }

  // ─── Rotation helpers ───────────────────────────────────────────────────────

  /**
   * Check whether the token is approaching expiry.
   * Used by callers that want to proactively refresh before expiry.
   *
   * @param token  Raw JWT string
   * @param thresholdSeconds  Refresh if TTL < this value (default: 60s)
   */
  shouldRefresh(token: string, thresholdSeconds = 60): boolean {
    try {
      const decoded = jwt.decode(token) as WorkloadTokenPayload | null;
      if (!decoded?.exp) return true;
      const ttlRemaining = decoded.exp - Math.floor(Date.now() / 1000);
      return ttlRemaining < thresholdSeconds;
    } catch {
      return true;
    }
  }

  /**
   * Issue a replacement token for an existing one.
   * The replacement inherits the same audience, environment, and TTL as the
   * original but carries a fresh jti and iat/exp.
   *
   * @param existingToken  Raw JWT string to rotate
   */
  async rotate(existingToken: string): Promise<string> {
    // Decode without verification to extract claims (we might rotate an
    // almost-expired token, which is fine — we just need the binding claims).
    const decoded = jwt.decode(existingToken) as WorkloadTokenPayload | null;
    if (!decoded) {
      throw new WorkloadTokenError("Cannot rotate: token is malformed", "malformed");
    }

    const newToken = await this.issue({
      callerService: decoded.sub,
      audience: decoded.aud,
      environment: decoded.env,
      ttlSeconds: Math.min(
        decoded.exp - decoded.iat,
        WORKLOAD_TOKEN_MAX_TTL_SECONDS
      ),
    });

    // Audit: rotation
    try {
      await auditLogService.logEvent({
        action: WorkloadIdentityAction.WORKLOAD_TOKEN_ROTATED,
        category: EventCategory.INTEGRATION,
        severity: AuditEventSeverity.INFO,
        actor: { serviceId: decoded.sub },
        success: true,
        metadata: {
          oldJti: decoded.jti,
          callerService: decoded.sub,
          audience: decoded.aud,
          environment: decoded.env,
        },
      });
    } catch (auditErr) {
      logger.warn("WorkloadIdentityService: failed to write token-rotated audit event", {
        error: (auditErr as Error).message,
      });
    }

    logger.info("WorkloadIdentityService: token rotated", {
      caller: decoded.sub,
      oldJti: decoded.jti,
    });

    return newToken;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Try primary key; on JsonWebTokenError retry with secondary (if configured).
   * TokenExpiredError is NOT retried — an expired token is always invalid.
   */
  private decodeWithFallback(
    token: string,
    clockSkewSeconds: number
  ): WorkloadTokenPayload {
    try {
      return jwt.verify(token, this.primarySecret, {
        algorithms: ["HS256"],
        clockTolerance: clockSkewSeconds,
        issuer: WORKLOAD_ISSUER,
      }) as WorkloadTokenPayload;
    } catch (primaryErr) {
      // Only retry on signature errors, not on expiry or structure issues
      if (
        this.secondarySecret &&
        primaryErr instanceof jwt.JsonWebTokenError &&
        !(primaryErr instanceof jwt.TokenExpiredError)
      ) {
        logger.info(
          "WorkloadIdentityService: primary key failed, trying secondary key"
        );
        return jwt.verify(token, this.secondarySecret, {
          algorithms: ["HS256"],
          clockTolerance: clockSkewSeconds,
          issuer: WORKLOAD_ISSUER,
        }) as WorkloadTokenPayload;
      }
      throw primaryErr;
    }
  }

  private async auditRejected(
    token: string,
    reason: WorkloadTokenError["reason"],
    acceptorService: ServiceId | undefined,
    metadata: Record<string, unknown>
  ): Promise<void> {
    // Decode without verification to extract caller info for the audit record
    let callerService: string | undefined;
    try {
      const decoded = jwt.decode(token) as WorkloadTokenPayload | null;
      callerService = decoded?.sub;
    } catch {
      /* ignore */
    }

    try {
      await auditLogService.logEvent({
        action: WorkloadIdentityAction.WORKLOAD_TOKEN_REJECTED,
        category: EventCategory.INTEGRATION,
        severity: AuditEventSeverity.WARNING,
        actor: { serviceId: callerService ?? "unknown" },
        success: false,
        errorMessage: reason,
        metadata: {
          reason,
          acceptorService,
          ...metadata,
        },
      });
    } catch (auditErr) {
      logger.warn("WorkloadIdentityService: failed to write rejection audit event", {
        error: (auditErr as Error).message,
      });
    }
  }
}

// ─── JWT error classification ─────────────────────────────────────────────────

function classifyJwtError(err: unknown): WorkloadTokenError["reason"] {
  if (err instanceof jwt.TokenExpiredError) return "expired";
  if (err instanceof jwt.JsonWebTokenError) {
    const msg = (err as Error).message?.toLowerCase() ?? "";
    if (msg.includes("audience")) return "wrong_audience";
    if (msg.includes("issuer")) return "malformed";
    return "invalid_signature";
  }
  if (err instanceof jwt.NotBeforeError) return "malformed";
  return "malformed";
}

// ─── Singleton convenience export ────────────────────────────────────────────

export const workloadIdentityService = new WorkloadIdentityService();
