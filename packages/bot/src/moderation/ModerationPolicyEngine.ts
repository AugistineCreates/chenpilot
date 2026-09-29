/**
 * ModerationPolicyEngine
 *
 * Platform-agnostic policy engine shared by the Discord and Telegram
 * adapters. Runs rules in order, tracks per-user strikes inside a sliding
 * window, applies the escalation policy, and writes an audit entry for every
 * non-allow outcome.
 *
 * Deterministic by design: no platform imports, injectable clock, and audit
 * sink failures never affect the moderation decision.
 */

import type {
  EscalationPolicy,
  ModerationAction,
  ModerationAuditEntry,
  ModerationAuditSink,
  ModerationDecision,
  ModerationEvent,
  ModerationResult,
  ModerationRule,
  ModerationVerdict,
} from "./types";

/** Severity ordering used to combine suggested and escalated actions. */
const DECISION_SEVERITY: Record<ModerationDecision, number> = {
  allow: 0,
  warn: 1,
  delete: 2,
  escalate: 3,
};

export interface ModerationPolicyEngineOptions {
  rules: ModerationRule[];
  escalation: EscalationPolicy;
  /** Sinks that receive audit entries for non-allow outcomes. */
  auditSinks?: ModerationAuditSink[];
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  now?: () => number;
}

export class ModerationPolicyEngine {
  private readonly rules: ModerationRule[];
  private readonly escalation: EscalationPolicy;
  private readonly auditSinks: ModerationAuditSink[];
  private readonly now: () => number;
  /** "platform:userId" -> strike timestamps (epoch ms) inside the window. */
  private readonly strikeLog: Map<string, number[]> = new Map();

  constructor(options: ModerationPolicyEngineOptions) {
    this.rules = options.rules;
    this.escalation = options.escalation;
    this.auditSinks = options.auditSinks ?? [];
    this.now = options.now ?? Date.now;
  }

  /**
   * Evaluate one event against every rule, in order. The first violating
   * rule wins; its verdict is combined with the escalation policy and the
   * outcome is audited.
   */
  async moderate(event: ModerationEvent): Promise<ModerationResult> {
    for (const rule of this.rules) {
      const verdict = await rule.evaluate(event);
      if (!verdict.violation) continue;

      const strikes = this.recordStrike(event);
      const decision = this.resolveDecision(verdict, strikes);

      const result: ModerationResult = {
        decision,
        ruleId: rule.id,
        reason: verdict.reason,
        matchedPattern: verdict.matchedPattern,
        strikes,
        userMessage: this.formatUserMessage(decision, verdict),
      };

      await this.audit(event, rule.id, result);
      return result;
    }

    return { decision: "allow", strikes: this.countStrikes(event) };
  }

  /** Current strike count for a user without recording a new one. */
  getStrikes(platform: ModerationEvent["platform"], userId: string): number {
    return this.pruneStrikes(`${platform}:${userId}`).length;
  }

  /** Clear all recorded strikes (e.g. on adapter shutdown). */
  clearStrikes(): void {
    this.strikeLog.clear();
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private strikeKey(event: ModerationEvent): string {
    return `${event.platform}:${event.userId}`;
  }

  /** Drop strikes older than the window and return the surviving list. */
  private pruneStrikes(key: string): number[] {
    const cutoff = this.now() - this.escalation.strikeWindowMs;
    const pruned = (this.strikeLog.get(key) ?? []).filter((ts) => ts > cutoff);
    if (pruned.length > 0) {
      this.strikeLog.set(key, pruned);
    } else {
      this.strikeLog.delete(key);
    }
    return pruned;
  }

  private countStrikes(event: ModerationEvent): number {
    return this.pruneStrikes(this.strikeKey(event)).length;
  }

  /** Record a new strike and return the user's total inside the window. */
  private recordStrike(event: ModerationEvent): number {
    const key = this.strikeKey(event);
    const strikes = this.pruneStrikes(key);
    strikes.push(this.now());
    this.strikeLog.set(key, strikes);
    return strikes.length;
  }

  /**
   * Combine the rule's suggested action with the escalation policy.
   * Escalation can only raise severity, never lower it.
   */
  private resolveDecision(
    verdict: ModerationVerdict,
    strikes: number
  ): ModerationAction {
    const suggested: ModerationAction = verdict.suggestedAction ?? "warn";
    const escalated = this.escalatedAction(strikes);
    if (
      escalated &&
      DECISION_SEVERITY[escalated] > DECISION_SEVERITY[suggested]
    ) {
      return escalated;
    }
    return suggested;
  }

  /** Highest threshold action the strike count has reached, if any. */
  private escalatedAction(strikes: number): ModerationAction | undefined {
    let action: ModerationAction | undefined;
    let best = -1;
    for (const threshold of this.escalation.thresholds) {
      if (strikes >= threshold.strikes && threshold.strikes > best) {
        best = threshold.strikes;
        action = threshold.action;
      }
    }
    return action;
  }

  /** Platform-neutral notice the adapter can relay to the channel/user. */
  private formatUserMessage(
    decision: ModerationAction,
    verdict: ModerationVerdict
  ): string {
    const outcome =
      decision === "delete"
        ? "removed"
        : decision === "escalate"
          ? "reported to moderators"
          : "flagged";
    const reason = verdict.reason ?? "Policy violation";
    return (
      `🚨 **Moderation Notice**\n\n` +
      `**Reason:** ${reason}\n` +
      (verdict.matchedPattern
        ? `**Pattern:** \`${verdict.matchedPattern}\`\n`
        : "") +
      `\nThis message has been ${outcome} for your safety.`
    );
  }

  /**
   * Write the outcome to every sink. Sink failures are swallowed so a broken
   * audit channel can never break moderation itself.
   */
  private async audit(
    event: ModerationEvent,
    ruleId: string,
    result: ModerationResult
  ): Promise<void> {
    const entry: ModerationAuditEntry = {
      action: `MODERATION_${result.decision.toUpperCase()}`,
      platform: event.platform,
      userId: event.userId,
      channelId: event.channelId,
      messageId: event.messageId,
      ruleId,
      decision: result.decision,
      reason: result.reason,
      matchedPattern: result.matchedPattern,
      strikes: result.strikes,
      timestamp: new Date(this.now()).toISOString(),
    };

    for (const sink of this.auditSinks) {
      try {
        await sink.record(entry);
      } catch {
        // Audit sinks must never break moderation.
      }
    }
  }
}

/**
 * Simple bounded in-memory audit sink. Useful as a default sink and in tests.
 */
export class InMemoryAuditSink implements ModerationAuditSink {
  private readonly entries: ModerationAuditEntry[] = [];

  constructor(private readonly maxEntries: number = 500) {}

  record(entry: ModerationAuditEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }

  getEntries(): readonly ModerationAuditEntry[] {
    return this.entries;
  }
}
