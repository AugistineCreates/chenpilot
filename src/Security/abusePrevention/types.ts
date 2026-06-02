export type AbuseSurface = "api" | "bot" | "realtime";

export type AbuseDecision = "allow" | "deny" | "throttle" | "challenge";

export interface AbuseSubject {
  ipAddress?: string;
  userId?: string;
  sessionId?: string;
}

export interface AbuseRequestContext {
  surface: AbuseSurface;
  action: string;
  subject: AbuseSubject;
  metadata?: Record<string, unknown>;
  now?: number;
}

export interface AbusePolicyRule {
  id: string;
  description?: string;
  surfaces: AbuseSurface[];
  actions?: string[];
  decision: Exclude<AbuseDecision, "allow">;
  reason: string;
  match: (context: AbuseRequestContext) => boolean | Promise<boolean>;
}

export interface RateLimitPolicy {
  id: string;
  surfaces: AbuseSurface[];
  actions?: string[];
  maxRequests: number;
  windowMs: number;
  keyBy: Array<keyof AbuseSubject>;
}

export interface AbusePolicy {
  rules?: AbusePolicyRule[];
  rateLimits?: RateLimitPolicy[];
}

export interface AbuseEvaluationResult {
  allowed: boolean;
  decision: AbuseDecision;
  policyId?: string;
  reason?: string;
  retryAfterMs?: number;
  resetAt?: number;
}
