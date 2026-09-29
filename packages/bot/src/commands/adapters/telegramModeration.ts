/**
 * Telegram moderation middleware.
 *
 * Runs every incoming Telegram text/caption message through the shared
 * ModerationPolicyEngine (see ../../moderation) and enforces the resulting
 * decision using the Telegraf Bot API — mirroring the Discord adapter's
 * runModeration/enforceModerationDecision flow so both platforms share
 * identical policy behaviour and differ only in how they delete messages
 * and post notices.
 *
 * Kept as a standalone module (rather than being wired directly into
 * ../../adapters/telegram.ts) so it can be unit-tested against a minimal
 * Telegraf-shaped context without booting a real bot, and attached to any
 * Telegram entry point via `bot.use(createTelegramModerationMiddleware())`.
 */

import {
  ModerationPolicyEngine,
  InMemoryAuditSink,
  createDefaultModerationPolicy,
  isModerationEnabled,
  telegramContextToModerationEvent,
  type ModerationResult,
  type TelegramContextLike,
} from "../../moderation/index";

/** The subset of a Telegraf context this middleware needs to enforce decisions. */
export interface TelegramModerationCtx extends TelegramContextLike {
  reply(text: string, extra?: Record<string, unknown>): Promise<unknown>;
  deleteMessage(messageId?: number): Promise<unknown>;
  telegram: {
    sendMessage(
      chatId: number | string,
      text: string,
      extra?: Record<string, unknown>
    ): Promise<unknown>;
  };
}

export interface TelegramModerationOptions {
  engine?: ModerationPolicyEngine;
  auditSink?: InMemoryAuditSink;
  /** Chat ID that receives escalation reports. Defaults to unset (no forwarding). */
  moderationLogChatId?: string | number;
  /** Overridable for tests; defaults to isModerationEnabled(). */
  enabled?: boolean;
}

/** Shared default engine + sink, analogous to DiscordAdapter's instance fields. */
export function createTelegramModerationEngine(
  auditSink: InMemoryAuditSink = new InMemoryAuditSink()
): { engine: ModerationPolicyEngine; auditSink: InMemoryAuditSink } {
  const { rules, escalation } = createDefaultModerationPolicy();
  return {
    engine: new ModerationPolicyEngine({ rules, escalation, auditSinks: [auditSink] }),
    auditSink,
  };
}

/**
 * Apply a moderation decision to the originating Telegram message:
 *  - warn:     reply in-chat with the notice, message stays.
 *  - delete:   delete the message, then reply with the notice.
 *  - escalate: delete the message, reply with the notice, and forward a
 *              report to the configured moderation-log chat.
 *
 * Never throws — enforcement failures (missing delete permission, chat not
 * found, …) are logged and swallowed so moderation can never break the
 * surrounding message-handling pipeline.
 */
export async function enforceTelegramModerationDecision(
  ctx: TelegramModerationCtx,
  result: ModerationResult,
  moderationLogChatId?: string | number
): Promise<void> {
  const notice = result.userMessage ?? "This message violates our moderation policy.";

  if (result.decision === "delete" || result.decision === "escalate") {
    try {
      await ctx.deleteMessage();
    } catch (error) {
      console.error("[TelegramModeration] Failed to delete moderated message:", error);
    }
  }

  try {
    await ctx.reply(notice, { parse_mode: "HTML" });
  } catch (error) {
    console.error("[TelegramModeration] Failed to send moderation notice:", error);
  }

  if (result.decision === "escalate" && moderationLogChatId) {
    await postToTelegramModerationLog(ctx, result, moderationLogChatId);
  }
}

async function postToTelegramModerationLog(
  ctx: TelegramModerationCtx,
  result: ModerationResult,
  moderationLogChatId: string | number
): Promise<void> {
  try {
    const userId = ctx.from?.id ?? "unknown";
    const chatId = ctx.chat?.id ?? "unknown";
    const content = (ctx.message?.text ?? ctx.message?.caption ?? "").slice(0, 500);

    const report =
      `🚨 <b>Moderation Escalation</b>\n` +
      `<b>User:</b> <code>${userId}</code>\n` +
      `<b>Chat:</b> <code>${chatId}</code>\n` +
      `<b>Rule:</b> <code>${result.ruleId ?? "unknown"}</code>\n` +
      `<b>Reason:</b> ${result.reason ?? "Policy violation"}\n` +
      `<b>Strikes:</b> ${result.strikes}\n` +
      `<b>Content:</b> ${content}`;

    await ctx.telegram.sendMessage(moderationLogChatId, report, { parse_mode: "HTML" });
  } catch (error) {
    console.error("[TelegramModeration] Failed to post moderation escalation log:", error);
  }
}

export interface TelegramModerationMiddleware {
  middleware: (ctx: TelegramModerationCtx, next: () => Promise<void>) => Promise<void>;
  engine: ModerationPolicyEngine;
  auditSink: InMemoryAuditSink;
}

/**
 * Build a Telegraf middleware that moderates every incoming text/caption
 * message before handing control to the next middleware (commands, wizard
 * input, …). Non-violating messages fall through to `next()` untouched.
 * Messages with no moderatable text (stickers, etc.) also fall through —
 * see telegramContextToModerationEvent.
 *
 * Returns the middleware alongside the engine/auditSink so callers (and
 * tests) can inspect strikes and the audit trail directly.
 */
export function createTelegramModerationMiddleware(
  options: TelegramModerationOptions = {}
): TelegramModerationMiddleware {
  const { engine, auditSink } =
    options.engine !== undefined
      ? { engine: options.engine, auditSink: options.auditSink ?? new InMemoryAuditSink() }
      : createTelegramModerationEngine(options.auditSink);
  const enabled = options.enabled ?? isModerationEnabled();
  const moderationLogChatId =
    options.moderationLogChatId ?? process.env.MODERATION_LOG_CHAT_ID;

  const middleware = async (
    ctx: TelegramModerationCtx,
    next: () => Promise<void>
  ): Promise<void> => {
    if (!enabled) return next();

    try {
      const event = telegramContextToModerationEvent(ctx);
      if (!event) return next();

      const result = await engine.moderate(event);
      if (result.decision === "allow") return next();

      await enforceTelegramModerationDecision(ctx, result, moderationLogChatId);
      // Violating messages stop the middleware chain — no further command
      // dispatch or wizard-input handling for a message that was removed.
    } catch (error) {
      console.error("[TelegramModeration] Moderation error:", error);
      return next();
    }
  };

  return { middleware, engine, auditSink };
}
