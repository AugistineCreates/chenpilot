/**
 * Shared Moderation Policy Engine — Public API
 *
 * Platform-agnostic moderation for the Discord and Telegram adapters:
 * scam detection, abuse responses, escalation rules, and audit logging.
 */

export type {
  ModerationEvent,
  ModerationDecision,
  ModerationAction,
  ModerationVerdict,
  ModerationRule,
  EscalationThreshold,
  EscalationPolicy,
  ModerationAuditEntry,
  ModerationAuditSink,
  ModerationResult,
} from "./types";

export {
  ModerationPolicyEngine,
  InMemoryAuditSink,
} from "./ModerationPolicyEngine";
export type { ModerationPolicyEngineOptions } from "./ModerationPolicyEngine";

export {
  createScamLinkRule,
  createAbuseKeywordRule,
  createMentionSpamRule,
  DEFAULT_ABUSE_KEYWORDS,
} from "./rules";
export type {
  ScamLinkRuleOptions,
  AbuseKeywordRuleOptions,
  MentionSpamRuleOptions,
} from "./rules";

export {
  createDefaultModerationPolicy,
  createDefaultModerationRules,
  resolveModerationActionMode,
  isModerationEnabled,
  DEFAULT_ESCALATION_POLICY,
} from "./defaultPolicy";
export type {
  ModerationActionMode,
  DefaultModerationPolicy,
} from "./defaultPolicy";

export {
  discordMessageToModerationEvent,
  telegramContextToModerationEvent,
} from "./adapters";
export type { DiscordMessageLike, TelegramContextLike } from "./adapters";
