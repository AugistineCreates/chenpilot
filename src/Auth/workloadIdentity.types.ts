/**
 * workloadIdentity.types.ts
 *
 * Type definitions for the workload identity system.
 *
 * Design principles
 * -----------------
 * • Every internal service is identified by a stable ServiceId enum value.
 * • Tokens are narrowly scoped: each JWT carries the issuing service (sub),
 *   the accepting service (aud), and the deployment environment (env).
 *   A token for service-A targeting service-B in staging cannot be replayed
 *   against production or against service-C.
 * • Expiry defaults to 5 minutes.  Services that need longer windows can
 *   request up to WORKLOAD_TOKEN_MAX_TTL_SECONDS.
 * • The token format is compatible with jsonwebtoken so no new runtime
 *   dependency is required.
 */

// ─── Service catalogue ────────────────────────────────────────────────────────

/**
 * Canonical identifiers for internal services.
 * Add a new entry here whenever a new internal service needs to call another.
 */
export enum ServiceId {
  /** The API Gateway itself — issues tokens for its own outbound calls */
  GATEWAY = "gateway",
  /** Bot adapter layer (Discord/Telegram bridge) */
  BOT_ADAPTER = "bot-adapter",
  /** Agent orchestration service */
  AGENT_ORCHESTRATOR = "agent-orchestrator",
  /** Job-queue worker */
  JOB_WORKER = "job-worker",
  /** Stellar event indexer */
  EVENT_INDEXER = "event-indexer",
  /** Transaction lifecycle tracker */
  TRANSACTION_TRACKER = "transaction-tracker",
  /** Admin workflow service */
  ADMIN_WORKFLOW = "admin-workflow",
}

// ─── Deployment environments ──────────────────────────────────────────────────

export enum ServiceEnvironment {
  DEVELOPMENT = "development",
  STAGING = "staging",
  PRODUCTION = "production",
  TEST = "test",
}

// ─── JWT payload ──────────────────────────────────────────────────────────────

/**
 * Claims embedded in every workload identity JWT.
 *
 * Standard JWT claims:
 *   iss  — issuer (always "chenpilot-workload-issuer")
 *   sub  — subject: the ServiceId of the calling service
 *   aud  — audience: the ServiceId(s) that may accept this token
 *   iat  — issued-at (Unix seconds)
 *   exp  — expiry (Unix seconds)
 *   jti  — unique token identifier (UUID v4)
 *
 * Custom claims:
 *   env  — deployment environment (must match acceptor's env)
 *   svc  — alias for sub, present for readability in audit logs
 */
export interface WorkloadTokenPayload {
  /** Issuer — constant "chenpilot-workload-issuer" */
  iss: string;
  /** Subject — ServiceId of the calling service */
  sub: ServiceId;
  /** Audience — one or more ServiceId values that may accept this token */
  aud: ServiceId | ServiceId[];
  /** Issued-at (Unix seconds, set by jwt.sign) */
  iat: number;
  /** Expiry (Unix seconds, set by jwt.sign) */
  exp: number;
  /** JWT ID — unique per token, used for replay detection */
  jti: string;
  /** Deployment environment — must match the acceptor's runtime env */
  env: ServiceEnvironment;
  /** Human-readable service name (alias for sub) */
  svc: ServiceId;
}

/**
 * Verified, fully-resolved token as returned by WorkloadIdentityService.verify.
 * Callers receive this value rather than the raw JWT payload.
 */
export interface VerifiedWorkloadIdentity {
  /** Calling service */
  serviceId: ServiceId;
  /** Intended audience (may be an array) */
  audience: ServiceId | ServiceId[];
  /** Deployment environment */
  environment: ServiceEnvironment;
  /** Unique token ID */
  jti: string;
  /** Issued-at (Unix seconds) */
  issuedAt: number;
  /** Expiry (Unix seconds) */
  expiresAt: number;
  /** Remaining TTL in seconds at verification time */
  remainingTtlSeconds: number;
}

// ─── Token issuance options ───────────────────────────────────────────────────

export interface TokenIssuanceOptions {
  /**
   * ServiceId of the caller (defaults to the service configured via
   * WORKLOAD_SERVICE_ID env var).
   */
  callerService?: ServiceId;
  /**
   * ServiceId(s) of the intended recipient(s).
   * Accepts a single value or an array for multi-audience tokens.
   */
  audience: ServiceId | ServiceId[];
  /**
   * TTL in seconds.  Defaults to WORKLOAD_TOKEN_DEFAULT_TTL_SECONDS (300).
   * Capped at WORKLOAD_TOKEN_MAX_TTL_SECONDS (900).
   */
  ttlSeconds?: number;
  /**
   * Override the deployment environment claim.
   * Defaults to the value of NODE_ENV mapped to ServiceEnvironment.
   */
  environment?: ServiceEnvironment;
}

// ─── Verification options ─────────────────────────────────────────────────────

export interface TokenVerificationOptions {
  /**
   * The ServiceId that this acceptor represents.
   * The middleware sets this automatically from the registered service name.
   * If omitted, audience binding is not enforced (useful for testing only).
   */
  acceptorService?: ServiceId;
  /**
   * Accepted deployment environments.
   * Defaults to the current NODE_ENV environment.
   */
  acceptedEnvironments?: ServiceEnvironment[];
  /**
   * Whether to allow tokens within a clock-skew window even if technically
   * past exp.  Defaults to 0 (no skew tolerance).
   * Maximum accepted value: 60 seconds.
   */
  clockSkewSeconds?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const WORKLOAD_ISSUER = "chenpilot-workload-issuer";
export const WORKLOAD_TOKEN_DEFAULT_TTL_SECONDS = 300; // 5 minutes
export const WORKLOAD_TOKEN_MAX_TTL_SECONDS = 900; // 15 minutes
export const WORKLOAD_TOKEN_MAX_CLOCK_SKEW_SECONDS = 60;

/** Header used to carry the workload JWT on internal calls */
export const WORKLOAD_TOKEN_HEADER = "x-workload-token";

/** Header used to carry the caller service ID (optional; for observability) */
export const WORKLOAD_SERVICE_HEADER = "x-workload-service";
