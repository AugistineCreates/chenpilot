import { describe, it, expect, jest, beforeEach, afterAll } from "@jest/globals";

import {
  createTelegramModerationMiddleware,
  enforceTelegramModerationDecision,
  type TelegramModerationCtx,
} from "../../packages/bot/src/commands/adapters/telegramModeration";
import { InMemoryAuditSink } from "../../packages/bot/src/moderation";

function makeCtx(overrides: {
  userId?: number;
  chatId?: number;
  text?: string;
} = {}): { ctx: TelegramModerationCtx; reply: jest.Mock; deleteMessage: jest.Mock; sendMessage: jest.Mock } {
  const { userId = 1, chatId = 100, text = "hello there" } = overrides;

  const reply = jest.fn(async () => undefined);
  const deleteMessage = jest.fn(async () => undefined);
  const sendMessage = jest.fn(async () => undefined);

  const ctx = {
    from: { id: userId },
    chat: { id: chatId, type: "supergroup" },
    message: { message_id: 1, text, date: Math.floor(Date.now() / 1000) },
    reply,
    deleteMessage,
    telegram: { sendMessage },
  } as unknown as TelegramModerationCtx;

  return { ctx, reply, deleteMessage, sendMessage };
}

describe("createTelegramModerationMiddleware", () => {
  const originalAction = process.env.MODERATION_ACTION;
  const originalEnabled = process.env.MODERATION_ENABLED;

  beforeEach(() => {
    process.env.MODERATION_ACTION = "block"; // scam-link -> delete
    delete process.env.MODERATION_ENABLED;
  });

  afterAll(() => {
    process.env.MODERATION_ACTION = originalAction;
    process.env.MODERATION_ENABLED = originalEnabled;
  });

  it("calls next() and does not enforce on a clean message", async () => {
    const { middleware } = createTelegramModerationMiddleware();
    const { ctx, reply, deleteMessage } = makeCtx({ text: "gm everyone" });
    const next = jest.fn(async () => undefined);

    await middleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(reply).not.toHaveBeenCalled();
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it("deletes the message and replies with a notice on a scam-link violation, without calling next()", async () => {
    const { middleware } = createTelegramModerationMiddleware();
    const { ctx, reply, deleteMessage } = makeCtx({
      text: "https://free-double-your-crypto.xyz/claim",
    });
    const next = jest.fn(async () => undefined);

    await middleware(ctx, next);

    expect(deleteMessage).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  it("falls through to next() when the update has no moderatable text (e.g. a sticker)", async () => {
    const { middleware } = createTelegramModerationMiddleware();
    const ctx = {
      from: { id: 1 },
      chat: { id: 2 },
      message: { message_id: 1 },
      reply: jest.fn(async () => undefined),
      deleteMessage: jest.fn(async () => undefined),
      telegram: { sendMessage: jest.fn(async () => undefined) },
    } as unknown as TelegramModerationCtx;
    const next = jest.fn(async () => undefined);

    await middleware(ctx, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("skips moderation and always calls next() when disabled", async () => {
    const { middleware } = createTelegramModerationMiddleware({ enabled: false });
    const { ctx, deleteMessage } = makeCtx({
      text: "https://free-double-your-crypto.xyz/claim",
    });
    const next = jest.fn(async () => undefined);

    await middleware(ctx, next);

    expect(deleteMessage).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("accumulates strikes for the same telegram user across messages", async () => {
    const { middleware, engine } = createTelegramModerationMiddleware();
    const next = jest.fn(async () => undefined);

    const { ctx: ctx1 } = makeCtx({ userId: 42, text: "you are an idiot" });
    const { ctx: ctx2 } = makeCtx({ userId: 42, text: "you are such trash" });

    await middleware(ctx1, next);
    await middleware(ctx2, next);

    expect(engine.getStrikes("telegram", "42")).toBe(2);
  });

  it("records violations in the audit sink", async () => {
    const auditSink = new InMemoryAuditSink();
    const { middleware } = createTelegramModerationMiddleware({ auditSink });
    const { ctx } = makeCtx({ text: "https://free-double-your-crypto.xyz/claim" });
    const next = jest.fn(async () => undefined);

    await middleware(ctx, next);

    const entries = auditSink.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].platform).toBe("telegram");
  });

  it("forwards escalated decisions to the configured moderation-log chat", async () => {
    const { middleware } = createTelegramModerationMiddleware({
      moderationLogChatId: "-100999",
    });
    const next = jest.fn(async () => undefined);

    // Escalate by driving strikes to the default escalation threshold (5).
    // Each iteration uses its own ctx (a new incoming message), but the
    // same userId, so strikes accumulate on the shared engine.
    let lastSendMessage!: jest.Mock;
    for (let i = 0; i < 5; i++) {
      const { ctx: strikeCtx, sendMessage } = makeCtx({ userId: 7, text: "you are trash" });
      lastSendMessage = sendMessage;
      await middleware(strikeCtx, next);
    }

    expect(lastSendMessage).toHaveBeenCalledWith(
      "-100999",
      expect.stringContaining("Moderation Escalation"),
      expect.objectContaining({ parse_mode: "HTML" })
    );
  });

  it("does not forward to the moderation log when no chat id is configured", async () => {
    const { middleware } = createTelegramModerationMiddleware();
    const { sendMessage } = makeCtx();
    const next = jest.fn(async () => undefined);

    for (let i = 0; i < 5; i++) {
      const { ctx: strikeCtx } = makeCtx({ userId: 9, text: "you are trash" });
      await middleware(strikeCtx, next);
    }

    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("enforceTelegramModerationDecision", () => {
  it("swallows a deleteMessage failure and still sends the notice", async () => {
    const { ctx, reply } = makeCtx();
    ctx.deleteMessage = jest.fn(async () => {
      throw new Error("bot is not an admin");
    });

    await expect(
      enforceTelegramModerationDecision(ctx, {
        decision: "delete",
        ruleId: "scam-link",
        strikes: 1,
        userMessage: "removed",
      })
    ).resolves.toBeUndefined();

    expect(reply).toHaveBeenCalledTimes(1);
  });

  it("only replies (no delete) for a warn decision", async () => {
    const { ctx, reply, deleteMessage } = makeCtx();

    await enforceTelegramModerationDecision(ctx, {
      decision: "warn",
      ruleId: "abuse-keyword",
      strikes: 1,
      userMessage: "flagged",
    });

    expect(deleteMessage).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledTimes(1);
  });
});
