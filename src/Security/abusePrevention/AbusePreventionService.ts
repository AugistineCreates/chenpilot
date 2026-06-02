import {
  AbuseEvaluationResult,
  AbusePolicy,
  AbuseRequestContext,
  RateLimitPolicy,
} from "./types";

interface RateLimitBucket {
  timestamps: number[];
}

const ALLOW_RESULT: AbuseEvaluationResult = {
  allowed: true,
  decision: "allow",
};

export class AbusePreventionService {
  private buckets = new Map<string, RateLimitBucket>();

  constructor(private readonly policy: AbusePolicy = {}) {}

  async evaluate(
    context: AbuseRequestContext
  ): Promise<AbuseEvaluationResult> {
    for (const rule of this.policy.rules || []) {
      if (!this.matchesSurfaceAndAction(rule, context)) {
        continue;
      }

      if (await rule.match(context)) {
        return {
          allowed: false,
          decision: rule.decision,
          policyId: rule.id,
          reason: rule.reason,
        };
      }
    }

    for (const rateLimit of this.policy.rateLimits || []) {
      if (!this.matchesSurfaceAndAction(rateLimit, context)) {
        continue;
      }

      const result = this.consumeRateLimit(rateLimit, context);
      if (!result.allowed) {
        return result;
      }
    }

    return ALLOW_RESULT;
  }

  reset(): void {
    this.buckets.clear();
  }

  private consumeRateLimit(
    policy: RateLimitPolicy,
    context: AbuseRequestContext
  ): AbuseEvaluationResult {
    const now = context.now || Date.now();
    const key = this.getRateLimitKey(policy, context);
    const bucket = this.buckets.get(key) || { timestamps: [] };
    const windowStart = now - policy.windowMs;
    const timestamps = bucket.timestamps.filter((timestamp) => timestamp > windowStart);

    if (timestamps.length >= policy.maxRequests) {
      const resetAt = timestamps[0] + policy.windowMs;
      this.buckets.set(key, { timestamps });

      return {
        allowed: false,
        decision: "throttle",
        policyId: policy.id,
        reason: "Rate limit exceeded",
        retryAfterMs: Math.max(0, resetAt - now),
        resetAt,
      };
    }

    timestamps.push(now);
    this.buckets.set(key, { timestamps });
    return ALLOW_RESULT;
  }

  private matchesSurfaceAndAction(
    policy: { surfaces: string[]; actions?: string[] },
    context: AbuseRequestContext
  ): boolean {
    const actionMatches =
      !policy.actions || policy.actions.includes(context.action) || policy.actions.includes("*");

    return policy.surfaces.includes(context.surface) && actionMatches;
  }

  private getRateLimitKey(
    policy: RateLimitPolicy,
    context: AbuseRequestContext
  ): string {
    const identity = policy.keyBy
      .map((key) => context.subject[key])
      .filter(Boolean)
      .join(":");

    return [policy.id, context.surface, context.action, identity || "anonymous"].join(":");
  }
}
