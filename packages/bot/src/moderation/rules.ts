/**
 * Built-in Moderation Rules
 *
 * Small, configurable, platform-agnostic rules. The scam-link rule wraps the
 * existing ScamDetectionService rather than duplicating its URL heuristics.
 */

import { ScamDetectionService } from "../scamDetection";
import type { ModerationAction, ModerationRule } from "./types";

// ─── Scam links ───────────────────────────────────────────────────────────────

export interface ScamLinkRuleOptions {
  /** Injectable service, e.g. one with a customised whitelist. */
  service?: ScamDetectionService;
  /** Action suggested on detection. Defaults to "delete". */
  suggestedAction?: ModerationAction;
}

/**
 * Flags messages containing phishing / typosquatting / scam-pattern URLs.
 * Delegates detection to the shared ScamDetectionService.
 */
export function createScamLinkRule(
  options: ScamLinkRuleOptions = {}
): ModerationRule {
  const service = options.service ?? new ScamDetectionService();
  const suggestedAction = options.suggestedAction ?? "delete";

  return {
    id: "scam-link",
    description: "Detects phishing, typosquatting, and scam-pattern URLs",
    evaluate(event) {
      const result = service.detectScamLinks(event.content);
      if (!result.isScam) {
        return { violation: false };
      }
      return {
        violation: true,
        reason: result.reason ?? "Potential scam link detected",
        matchedPattern: result.matchedPattern,
        suggestedAction,
      };
    },
  };
}

// ─── Abusive keywords ─────────────────────────────────────────────────────────

/** Modest default list — deployments should tune this via options. */
export const DEFAULT_ABUSE_KEYWORDS: readonly string[] = [
  "scammer",
  "idiot",
  "moron",
  "stupid",
  "trash",
  "kys",
];

export interface AbuseKeywordRuleOptions {
  /** Case-insensitive keywords matched on word boundaries. */
  keywords?: readonly string[];
  /** Action suggested on detection. Defaults to "warn". */
  suggestedAction?: ModerationAction;
}

/**
 * Flags messages containing abusive keywords (whole-word, case-insensitive).
 */
export function createAbuseKeywordRule(
  options: AbuseKeywordRuleOptions = {}
): ModerationRule {
  const keywords = options.keywords ?? DEFAULT_ABUSE_KEYWORDS;
  const suggestedAction = options.suggestedAction ?? "warn";
  const patterns = keywords.map(
    (keyword) =>
      new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
  );

  return {
    id: "abuse-keyword",
    description: "Detects abusive or harassing keywords",
    evaluate(event) {
      for (let i = 0; i < patterns.length; i++) {
        if (patterns[i].test(event.content)) {
          return {
            violation: true,
            reason: "Message contains abusive language",
            matchedPattern: keywords[i],
            suggestedAction,
          };
        }
      }
      return { violation: false };
    },
  };
}

// ─── Mention spam ─────────────────────────────────────────────────────────────

export interface MentionSpamRuleOptions {
  /** Maximum mentions allowed per message. Defaults to 5. */
  maxMentions?: number;
  /** Action suggested on detection. Defaults to "warn". */
  suggestedAction?: ModerationAction;
}

/**
 * Flags messages that mass-mention users. Counts Discord-style `<@123>` and
 * Telegram-style `@username` mentions in the normalised content.
 */
export function createMentionSpamRule(
  options: MentionSpamRuleOptions = {}
): ModerationRule {
  const maxMentions = options.maxMentions ?? 5;
  const suggestedAction = options.suggestedAction ?? "warn";
  const mentionPattern = /<@!?\d+>|(?:^|\s)@\w{2,}/g;

  return {
    id: "mention-spam",
    description: "Detects mass-mention spam",
    evaluate(event) {
      const mentions = event.content.match(mentionPattern) ?? [];
      if (mentions.length <= maxMentions) {
        return { violation: false };
      }
      return {
        violation: true,
        reason: `Message mentions ${mentions.length} users (limit ${maxMentions})`,
        matchedPattern: `${mentions.length} mentions`,
        suggestedAction,
      };
    },
  };
}
