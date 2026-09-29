/**
 * Shared Moderation Policy Engine — Core Types
 *
 * Platform-agnostic contracts for moderation. Adapters (Discord, Telegram)
 * translate their native events into a `ModerationEvent`, run it through the
 * `ModerationPolicyEngine`, and act on the returned `ModerationResult`.
 * Policy (rules, escalation, auditing) never touches platform SDKs, so the
 * same engine drives both bots and stays trivially unit-testable.
 */

import type { Platform } from "../commands/types";

// ─── Events ───────────────────────────────────────────────────────────────────

/**
 * A platform-normalised message that moderation rules evaluate.
 * Adapters are responsible for constructing this (see adapters.ts).
 */
export interface ModerationEvent {
  /** Platform the message arrived from. */
  platform: Platform;
  /** Platform-normalised user ID (string on both sides). */
  userId: string;
  /** Channel / chat the message was sent in, when known. */
  channelId?: string;
  /** Platform message ID, when known. */
  messageId?: string;
  /** Plain-text content of the message. */
  content: string;
  /** Epoch milliseconds when the message was created. */
  timestamp: number;
  /** Optional platform-specific extras (guild ID, mention count, …). */
  metadata?: Record<string, unknown>;
}

// ─── Decisions ────────────────────────────────────────────────────────────────

/**
 * What the adapter should do with the message.
 * Ordered by severity: allow < warn < delete < escalate.
 */
export type ModerationDecision = "allow" | "warn" | "delete" | "escalate";

/** Every decision except "allow" — i.e. an actual enforcement action. */
export type ModerationAction = Exclude<ModerationDecision, "allow">;

// ─── Rules ────────────────────────────────────────────────────────────────────

/**
 * The verdict a single rule returns for one event.
 */
export interface ModerationVerdict {
  /** True when the rule considers the event a violation. */
  violation: boolean;
  /** Human-readable explanation, required when violation is true. */
  reason?: string;
  /** The substring / pattern that triggered the rule, for audit trails. */
  matchedPattern?: string;
  /**
   * The action the rule suggests before escalation is applied.
   * Defaults to "warn" when absent. Escalation can only raise severity,
   * never lower it.
   */
  suggestedAction?: ModerationAction;
}

/**
 * A single, pure moderation rule. Rules must not perform platform side
 * effects — they only inspect the event and return a verdict.
 */
export interface ModerationRule {
  /** Stable identifier used in audit entries, e.g. "scam-link". */
  id: string;
  /** Short human-readable description of what the rule catches. */
  description: string;
  /** Evaluate one event. May be async (e.g. remote reputation lookups). */
  evaluate(event: ModerationEvent): ModerationVerdict | Promise<ModerationVerdict>;
}

// ─── Escalation ───────────────────────────────────────────────────────────────

/**
 * One escalation step: once a user accumulates `strikes` violations inside
 * the strike window, the engine enforces at least `action`.
 */
export interface EscalationThreshold {
  /** Minimum strike count (inclusive) at which this threshold applies. */
  strikes: number;
  /** Action enforced once the threshold is reached. */
  action: ModerationAction;
}

/**
 * Maps repeated violations to progressively stronger actions.
 */
export interface EscalationPolicy {
  /** Sliding window (ms) in which strikes are counted before they expire. */
  strikeWindowMs: number;
  /**
   * Thresholds mapping strike counts to actions. The engine picks the
   * highest threshold whose `strikes` the user has reached.
   */
  thresholds: EscalationThreshold[];
}

// ─── Audit ────────────────────────────────────────────────────────────────────

/**
 * One audit record. Written for every non-allow outcome.
 */
export interface ModerationAuditEntry {
  /** Canonical action label, e.g. "MODERATION_WARN". */
  action: string;
  platform: Platform;
  userId: string;
  channelId?: string;
  messageId?: string;
  /** Rule that triggered the decision. */
  ruleId: string;
  decision: ModerationDecision;
  reason?: string;
  matchedPattern?: string;
  /** Strike count for the user after this violation, inside the window. */
  strikes: number;
  /** ISO timestamp of when the decision was made. */
  timestamp: string;
}

/**
 * Where audit entries go. Adapters supply platform-specific sinks (Discord
 * audit channel, backend API, …); tests supply in-memory sinks.
 */
export interface ModerationAuditSink {
  record(entry: ModerationAuditEntry): void | Promise<void>;
}

// ─── Result ───────────────────────────────────────────────────────────────────

/**
 * The engine's final answer for one event.
 */
export interface ModerationResult {
  decision: ModerationDecision;
  /** Rule that fired; absent when decision is "allow". */
  ruleId?: string;
  reason?: string;
  matchedPattern?: string;
  /** Current strike count for the user inside the escalation window. */
  strikes: number;
  /**
   * Pre-formatted, platform-neutral notice the adapter can send to the
   * offending channel/user. Absent when decision is "allow".
   */
  userMessage?: string;
}
