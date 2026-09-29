import { describe, it, expect, jest } from "@jest/globals";

import {
  ModerationPolicyEngine,
  InMemoryAuditSink,
  createScamLinkRule,
  createAbuseKeywordRule,
  createMentionSpamRule,
  discordMessageToModerationEvent,
  telegramContextToModerationEvent,
  type ModerationEvent,
  type ModerationRule,
  type ModerationAuditSink,
} from "../../packages/bot/src/moderation";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<ModerationEvent> = {}): ModerationEvent {
  return {
    platform: "discord",
    userId: "user-1",
    channelId: "channel-1",
    messageId: "msg-1",
    content: "hello world",
    timestamp: Date.now(),
    ...overrides,
  };
}

/** Always-violates rule, for deterministic strike/escalation tests. */
function alwaysViolatesRule(
  id = "always-violates",
  suggestedAction: "warn" | "delete" | "escalate" = "warn"
): ModerationRule {
  return {
    id,
    description: "Test rule that always flags the message",
    evaluate: () => ({
      violation: true,
      reason: "test violation",
      matchedPattern: "n/a",
      suggestedAction,
    }),
  };
}

function neverViolatesRule(id = "never-violates"): ModerationRule {
  return {
    id,
    description: "Test rule that never flags the message",
    evaluate: () => ({ violation: false }),
  };
}

// ─── Allow path ───────────────────────────────────────────────────────────────

describe("ModerationPolicyEngine — allow path", () => {
  it("returns allow with zero strikes when no rule violates", async () => {
    const engine = new ModerationPolicyEngine({
      rules: [neverViolatesRule()],
      escalation: { strikeWindowMs: 60_000, thresholds: [] },
    });

    const result = await engine.moderate(makeEvent());

    expect(result.decision).toBe("allow");
    expect(result.strikes).toBe(0);
    expect(result.ruleId).toBeUndefined();
    expect(result.userMessage).toBeUndefined();
  });

  it("does not record a strike for an allowed message", async () => {
    const engine = new ModerationPolicyEngine({
      rules: [neverViolatesRule()],
      escalation: { strikeWindowMs: 60_000, thresholds: [] },
    });

    await engine.moderate(makeEvent());
    expect(engine.getStrikes("discord", "user-1")).toBe(0);
  });

  it("evaluates rules in order and stops at the first violation", async () => {
    const secondRule = alwaysViolatesRule("second-rule");
    const secondEvaluate = jest.fn(secondRule.evaluate);
    secondRule.evaluate = secondEvaluate;

    const engine = new ModerationPolicyEngine({
      rules: [alwaysViolatesRule("first-rule"), secondRule],
      escalation: { strikeWindowMs: 60_000, thresholds: [] },
    });

    const result = await engine.moderate(makeEvent());

    expect(result.ruleId).toBe("first-rule");
    expect(secondEvaluate).not.toHaveBeenCalled();
  });
});

// ─── Rule violations ────────────────────────────────────────────────────────

describe("ModerationPolicyEngine — rule violations", () => {
  it("returns the rule's suggested action when no escalation applies", async () => {
    const engine = new ModerationPolicyEngine({
      rules: [alwaysViolatesRule("scam-link", "delete")],
      escalation: { strikeWindowMs: 60_000, thresholds: [] },
    });

    const result = await engine.moderate(makeEvent());

    expect(result.decision).toBe("delete");
    expect(result.ruleId).toBe("scam-link");
    expect(result.reason).toBe("test violation");
    expect(result.userMessage).toContain("removed");
  });

  it("formats an escalate outcome as 'reported to moderators'", async () => {
    const engine = new ModerationPolicyEngine({
      rules: [alwaysViolatesRule("abuse", "escalate")],
      escalation: { strikeWindowMs: 60_000, thresholds: [] },
    });

    const result = await engine.moderate(makeEvent());
    expect(result.userMessage).toContain("reported to moderators");
  });

  it("formats a warn outcome as 'flagged'", async () => {
    const engine = new ModerationPolicyEngine({
      rules: [alwaysViolatesRule("mention-spam", "warn")],
      escalation: { strikeWindowMs: 60_000, thresholds: [] },
    });

    const result = await engine.moderate(makeEvent());
    expect(result.userMessage).toContain("flagged");
  });

  it("includes the matched pattern in the user-facing message when present", async () => {
    const rule: ModerationRule = {
      id: "pattern-rule",
      description: "test",
      evaluate: () => ({
        violation: true,
        reason: "phishing link",
        matchedPattern: "evil.xyz",
        suggestedAction: "delete",
      }),
    };
    const engine = new ModerationPolicyEngine({
      rules: [rule],
      escalation: { strikeWindowMs: 60_000, thresholds: [] },
    });

    const result = await engine.moderate(makeEvent());
    expect(result.userMessage).toContain("evil.xyz");
  });

  it("defaults suggestedAction to warn when a rule omits it", async () => {
    const rule: ModerationRule = {
      id: "no-action-rule",
      description: "test",
      evaluate: () => ({ violation: true, reason: "generic violation" }),
    };
    const engine = new ModerationPolicyEngine({
      rules: [rule],
      escalation: { strikeWindowMs: 60_000, thresholds: [] },
    });

    const result = await engine.moderate(makeEvent());
    expect(result.decision).toBe("warn");
  });

  it("keeps strikes independent per platform:userId key", async () => {
    const engine = new ModerationPolicyEngine({
      rules: [alwaysViolatesRule()],
      escalation: { strikeWindowMs: 60_000, thresholds: [] },
    });

    await engine.moderate(makeEvent({ platform: "discord", userId: "user-1" }));
    await engine.moderate(makeEvent({ platform: "telegram", userId: "user-1" }));
    await engine.moderate(makeEvent({ platform: "discord", userId: "user-2" }));

    expect(engine.getStrikes("discord", "user-1")).toBe(1);
    expect(engine.getStrikes("telegram", "user-1")).toBe(1);
    expect(engine.getStrikes("discord", "user-2")).toBe(1);
  });
});

// ─── Strike accumulation & escalation ──────────────────────────────────────────

describe("ModerationPolicyEngine — strike accumulation and escalation", () => {
  it("accumulates strikes across repeated violations for the same user", async () => {
    const engine = new ModerationPolicyEngine({
      rules: [alwaysViolatesRule()],
      escalation: { strikeWindowMs: 60_000, thresholds: [] },
    });

    const r1 = await engine.moderate(makeEvent());
    const r2 = await engine.moderate(makeEvent());
    const r3 = await engine.moderate(makeEvent());

    expect([r1.strikes, r2.strikes, r3.strikes]).toEqual([1, 2, 3]);
  });

  it("escalates to the configured action once a strike threshold is reached", async () => {
    const engine = new ModerationPolicyEngine({
      rules: [alwaysViolatesRule("scam-link", "warn")],
      escalation: {
        strikeWindowMs: 60_000,
        thresholds: [
          { strikes: 3, action: "delete" },
          { strikes: 5, action: "escalate" },
        ],
      },
    });

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await engine.moderate(makeEvent()));
    }

    expect(results[0].decision).toBe("warn"); // strike 1
    expect(results[1].decision).toBe("warn"); // strike 2
    expect(results[2].decision).toBe("delete"); // strike 3 — threshold hit
    expect(results[3].decision).toBe("delete"); // strike 4 — still >= 3
    expect(results[4].decision).toBe("escalate"); // strike 5 — threshold hit
  });

  it("never lowers a rule's suggested action below its own severity", async () => {
    // Rule already suggests "escalate"; a strike-1 threshold of "warn" must
    // not downgrade the outcome.
    const engine = new ModerationPolicyEngine({
      rules: [alwaysViolatesRule("severe-rule", "escalate")],
      escalation: {
        strikeWindowMs: 60_000,
        thresholds: [{ strikes: 1, action: "warn" }],
      },
    });

    const result = await engine.moderate(makeEvent());
    expect(result.decision).toBe("escalate");
  });

  it("picks the highest matching threshold when multiple thresholds are satisfied", async () => {
    const engine = new ModerationPolicyEngine({
      rules: [alwaysViolatesRule()],
      escalation: {
        strikeWindowMs: 60_000,
        thresholds: [
          { strikes: 1, action: "warn" },
          { strikes: 2, action: "delete" },
          { strikes: 3, action: "escalate" },
        ],
      },
    });

    // Jump straight past all thresholds in one go by pre-seeding strikes.
    await engine.moderate(makeEvent());
    await engine.moderate(makeEvent());
    const result = await engine.moderate(makeEvent());

    expect(result.strikes).toBe(3);
    expect(result.decision).toBe("escalate");
  });

  it("expires strikes outside the sliding window", async () => {
    let now = 1_000_000;
    const engine = new ModerationPolicyEngine({
      rules: [alwaysViolatesRule("scam-link", "warn")],
      escalation: {
        strikeWindowMs: 1_000,
        thresholds: [{ strikes: 2, action: "delete" }],
      },
      now: () => now,
    });

    const first = await engine.moderate(makeEvent());
    expect(first.strikes).toBe(1);

    // Advance beyond the strike window — the first strike should expire.
    now += 2_000;
    const second = await engine.moderate(makeEvent());

    expect(second.strikes).toBe(1); // not 2 — old strike pruned
    expect(second.decision).toBe("warn"); // threshold of 2 not reached
  });

  it("getStrikes() prunes expired strikes without mutating them into new ones", async () => {
    let now = 0;
    const engine = new ModerationPolicyEngine({
      rules: [alwaysViolatesRule()],
      escalation: { strikeWindowMs: 500, thresholds: [] },
      now: () => now,
    });

    await engine.moderate(makeEvent());
    expect(engine.getStrikes("discord", "user-1")).toBe(1);

    now += 1_000;
    expect(engine.getStrikes("discord", "user-1")).toBe(0);
  });

  it("clearStrikes() resets all users immediately", async () => {
    const engine = new ModerationPolicyEngine({
      rules: [alwaysViolatesRule()],
      escalation: { strikeWindowMs: 60_000, thresholds: [] },
    });

    await engine.moderate(makeEvent({ userId: "user-1" }));
    await engine.moderate(makeEvent({ userId: "user-2" }));
    engine.clearStrikes();

    expect(engine.getStrikes("discord", "user-1")).toBe(0);
    expect(engine.getStrikes("discord", "user-2")).toBe(0);
  });
});

// ─── Audit sink behaviour & failure isolation ──────────────────────────────────

describe("ModerationPolicyEngine — audit sink behaviour", () => {
  it("writes an audit entry for every non-allow outcome", async () => {
    const sink = new InMemoryAuditSink();
    const engine = new ModerationPolicyEngine({
      rules: [alwaysViolatesRule("scam-link", "delete")],
      escalation: { strikeWindowMs: 60_000, thresholds: [] },
      auditSinks: [sink],
    });

    await engine.moderate(makeEvent({ userId: "user-1", channelId: "chan-1" }));

    const entries = sink.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "MODERATION_DELETE",
      platform: "discord",
      userId: "user-1",
      channelId: "chan-1",
      ruleId: "scam-link",
      decision: "delete",
      strikes: 1,
    });
    expect(entries[0].timestamp).toEqual(expect.any(String));
  });

  it("does not write an audit entry for allowed messages", async () => {
    const sink = new InMemoryAuditSink();
    const engine = new ModerationPolicyEngine({
      rules: [neverViolatesRule()],
      escalation: { strikeWindowMs: 60_000, thresholds: [] },
      auditSinks: [sink],
    });

    await engine.moderate(makeEvent());
    expect(sink.getEntries()).toHaveLength(0);
  });

  it("caps InMemoryAuditSink at maxEntries, dropping the oldest first", async () => {
    const sink = new InMemoryAuditSink(3);
    const engine = new ModerationPolicyEngine({
      rules: [alwaysViolatesRule()],
      escalation: { strikeWindowMs: 60_000, thresholds: [] },
      auditSinks: [sink],
    });

    for (let i = 0; i < 5; i++) {
      await engine.moderate(makeEvent({ messageId: `msg-${i}` }));
    }

    const entries = sink.getEntries();
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.messageId)).toEqual(["msg-2", "msg-3", "msg-4"]);
  });

  it("isolates a throwing audit sink — moderation decision is unaffected", async () => {
    const failingSink: ModerationAuditSink = {
      record: () => {
        throw new Error("sink is down");
      },
    };
    const engine = new ModerationPolicyEngine({
      rules: [alwaysViolatesRule("scam-link", "delete")],
      escalation: { strikeWindowMs: 60_000, thresholds: [] },
      auditSinks: [failingSink],
    });

    const result = await engine.moderate(makeEvent());
    expect(result.decision).toBe("delete");
  });

  it("isolates a rejecting async audit sink without throwing out of moderate()", async () => {
    const failingSink: ModerationAuditSink = {
      record: async () => {
        throw new Error("async sink failure");
      },
    };
    const engine = new ModerationPolicyEngine({
      rules: [alwaysViolatesRule()],
      escalation: { strikeWindowMs: 60_000, thresholds: [] },
      auditSinks: [failingSink],
    });

    await expect(engine.moderate(makeEvent())).resolves.toBeDefined();
  });

  it("still delivers to healthy sinks when another sink fails", async () => {
    const goodSink = new InMemoryAuditSink();
    const badSink: ModerationAuditSink = {
      record: () => {
        throw new Error("boom");
      },
    };
    const engine = new ModerationPolicyEngine({
      rules: [alwaysViolatesRule()],
      escalation: { strikeWindowMs: 60_000, thresholds: [] },
      auditSinks: [badSink, goodSink],
    });

    await engine.moderate(makeEvent());
    expect(goodSink.getEntries()).toHaveLength(1);
  });

  it("defaults to no audit sinks when none are configured", async () => {
    const engine = new ModerationPolicyEngine({
      rules: [alwaysViolatesRule()],
      escalation: { strikeWindowMs: 60_000, thresholds: [] },
    });

    await expect(engine.moderate(makeEvent())).resolves.toBeDefined();
  });
});

// ─── Built-in rules ─────────────────────────────────────────────────────────

describe("createScamLinkRule", () => {
  it("flags a message containing a suspicious-TLD scam link", async () => {
    const rule = createScamLinkRule();
    const verdict = await rule.evaluate(
      makeEvent({ content: "check this out https://free-airdrop.xyz/claim" })
    );
    expect(verdict.violation).toBe(true);
  });

  it("does not flag a clean message with no links", async () => {
    const rule = createScamLinkRule();
    const verdict = await rule.evaluate(makeEvent({ content: "gm everyone" }));
    expect(verdict.violation).toBe(false);
  });

  it("respects a custom suggestedAction", async () => {
    const rule = createScamLinkRule({ suggestedAction: "escalate" });
    const verdict = await rule.evaluate(
      makeEvent({ content: "https://scam-double-your-crypto.top" })
    );
    expect(verdict.suggestedAction).toBe("escalate");
  });
});

describe("createAbuseKeywordRule", () => {
  it("flags whole-word matches case-insensitively", async () => {
    const rule = createAbuseKeywordRule();
    const verdict = await rule.evaluate(makeEvent({ content: "you are such an IDIOT" }));
    expect(verdict.violation).toBe(true);
    expect(verdict.matchedPattern).toBe("idiot");
  });

  it("does not flag substrings that are not whole-word matches", async () => {
    const rule = createAbuseKeywordRule({ keywords: ["kys"] });
    const verdict = await rule.evaluate(makeEvent({ content: "analytics dashboard" }));
    expect(verdict.violation).toBe(false);
  });

  it("supports a custom keyword list", async () => {
    const rule = createAbuseKeywordRule({ keywords: ["banned-word"] });
    const violating = await rule.evaluate(makeEvent({ content: "this has banned-word in it" }));
    const clean = await rule.evaluate(makeEvent({ content: "stupid trash idiot" }));
    expect(violating.violation).toBe(true);
    expect(clean.violation).toBe(false);
  });
});

describe("createMentionSpamRule", () => {
  it("flags messages exceeding the mention limit", async () => {
    const rule = createMentionSpamRule({ maxMentions: 3 });
    const verdict = await rule.evaluate(
      makeEvent({ content: "@aa @bb @cc @dd @ee hey everyone" })
    );
    expect(verdict.violation).toBe(true);
  });

  it("does not flag messages within the mention limit", async () => {
    const rule = createMentionSpamRule({ maxMentions: 3 });
    const verdict = await rule.evaluate(makeEvent({ content: "@aa @bb hey there" }));
    expect(verdict.violation).toBe(false);
  });

  it("counts Discord-style numeric mentions", async () => {
    const rule = createMentionSpamRule({ maxMentions: 2 });
    const verdict = await rule.evaluate(
      makeEvent({ content: "<@123> <@456> <@789> <@1011>" })
    );
    expect(verdict.violation).toBe(true);
  });
});

// ─── Platform event translators ────────────────────────────────────────────────

describe("discordMessageToModerationEvent", () => {
  it("maps a discord.js-shaped message into a ModerationEvent", () => {
    const event = discordMessageToModerationEvent({
      id: "m1",
      content: "hello",
      channelId: "c1",
      guildId: "g1",
      createdTimestamp: 12345,
      author: { id: "u1", bot: false },
    });

    expect(event).toMatchObject({
      platform: "discord",
      userId: "u1",
      channelId: "c1",
      messageId: "m1",
      content: "hello",
      timestamp: 12345,
      metadata: { guildId: "g1" },
    });
  });

  it("omits metadata when there is no guildId (DM)", () => {
    const event = discordMessageToModerationEvent({
      id: "m1",
      content: "hi",
      channelId: "c1",
      guildId: null,
      author: { id: "u1" },
    });
    expect(event.metadata).toBeUndefined();
  });

  it("falls back to Date.now() when createdTimestamp is missing", () => {
    const before = Date.now();
    const event = discordMessageToModerationEvent({
      id: "m1",
      content: "hi",
      channelId: "c1",
      author: { id: "u1" },
    });
    expect(event.timestamp).toBeGreaterThanOrEqual(before);
  });
});

describe("telegramContextToModerationEvent", () => {
  it("maps a Telegraf-shaped text message into a ModerationEvent", () => {
    const event = telegramContextToModerationEvent({
      from: { id: 42 },
      chat: { id: 100, type: "supergroup" },
      message: { message_id: 7, text: "hello", date: 1_700_000_000 },
    });

    expect(event).toMatchObject({
      platform: "telegram",
      userId: "42",
      channelId: "100",
      messageId: "7",
      content: "hello",
      timestamp: 1_700_000_000 * 1000,
      metadata: { chatType: "supergroup" },
    });
  });

  it("falls back to caption when text is absent", () => {
    const event = telegramContextToModerationEvent({
      from: { id: 1 },
      chat: { id: 2 },
      message: { message_id: 3, caption: "a photo caption" },
    });
    expect(event?.content).toBe("a photo caption");
  });

  it("returns null when there is no sender", () => {
    const event = telegramContextToModerationEvent({
      chat: { id: 2 },
      message: { text: "hi" },
    });
    expect(event).toBeNull();
  });

  it("returns null when there is no moderatable text or caption (e.g. a sticker)", () => {
    const event = telegramContextToModerationEvent({
      from: { id: 1 },
      chat: { id: 2 },
      message: { message_id: 3 },
    });
    expect(event).toBeNull();
  });
});
