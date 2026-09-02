/**
 * shadow.config.ts
 *
 * Environment-driven configuration for the shadow execution path (Issue #686).
 * All values have safe production defaults so shadow execution is opt-in and
 * cannot, by default, dominate production decisions or unboundedly retain data.
 */

import { ShadowConfig } from "./shadow.types";

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function floatFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const shadowConfig: ShadowConfig = {
  enabled:
    process.env.SHADOW_ENABLED === "true" ||
    process.env.SHADOW_ENABLED === "1",
  sampleRatePct: clamp(
    floatFromEnv("SHADOW_SAMPLE_RATE_PCT", 10),
    0,
    100
  ),
  promotionMinEvaluations: intFromEnv("SHADOW_PROMOTION_MIN_EVALUATIONS", 50),
  promotionMaxDivergenceRate: clamp(
    floatFromEnv("SHADOW_PROMOTION_MAX_DIVERGENCE_RATE", 0.01),
    0,
    1
  ),
  retentionDays: intFromEnv("SHADOW_RETENTION_DAYS", 14),
  maxRecords: intFromEnv("SHADOW_MAX_RECORDS", 50_000),
  promotionRequiredApprovals: intFromEnv("SHADOW_PROMOTION_REQUIRED_APPROVALS", 1),
};
