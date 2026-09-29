/**
 * Default Moderation Policy
 *
 * The rule set and escalation thresholds both adapters use unless a
 * deployment overrides them. Mirrors the legacy Discord adapter's
 * env-driven behaviour:
 *
 *   MODERATION_ENABLED  — "false" disables moderation (default enabled)
 *   MODERATION_ACTION   — "flag" (warn, default) | "block" (delete)
 *                          falls back to DISCORD_SCAM_DETECTION_ACTION for
 *                          backwards compatibility with the legacy adapter
 */

import {
  createAbuseKeywordRule,
  createMentionSpamRule,
  createScamLinkRule,
} from "./rules";
import type {
  EscalationPolicy,
  ModerationAction,
  ModerationRule,
} from "./types";

export type ModerationActionMode = "flag" | "block";

/**
 * Resolve the enforcement mode from the environment. Unknown values fall
 * back to "flag" (the safer, non-destructive default).
 */
export function resolveModerationActionMode(
  env: NodeJS.ProcessEnv = process.env
): ModerationActionMode {
  const raw = env.MODERATION_ACTION || env.DISCORD_SCAM_DETECTION_ACTION;
  return raw === "block" ? "block" : "flag";
}

/**
 * Whether moderation is enabled at all. Defaults to enabled.
 */
export function isModerationEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.MODERATION_ENABLED !== "false";
}

/**
 * Escalation defaults: strikes expire after 15 minutes; repeat offenders
 * are deleted at 3 strikes and escalated to moderators at 5.
 */
export const DEFAULT_ESCALATION_POLICY: EscalationPolicy = {
  strikeWindowMs: 15 * 60 * 1000,
  thresholds: [
    { strikes: 3, action: "delete" },
    { strikes: 5, action: "escalate" },
  ],
};

/**
 * Default rule set: scam links (strongest), abusive keywords, mention spam.
 */
export function createDefaultModerationRules(
  env: NodeJS.ProcessEnv = process.env
): ModerationRule[] {
  const mode = resolveModerationActionMode(env);
  const scamAction: ModerationAction = mode === "block" ? "delete" : "warn";
  return [
    createScamLinkRule({ suggestedAction: scamAction }),
    createAbuseKeywordRule(),
    createMentionSpamRule(),
  ];
}

export interface DefaultModerationPolicy {
  rules: ModerationRule[];
  escalation: EscalationPolicy;
}

/**
 * Bundle of default rules + escalation, ready to hand to the engine.
 */
export function createDefaultModerationPolicy(
  env: NodeJS.ProcessEnv = process.env
): DefaultModerationPolicy {
  return {
    rules: createDefaultModerationRules(env),
    escalation: DEFAULT_ESCALATION_POLICY,
  };
}
