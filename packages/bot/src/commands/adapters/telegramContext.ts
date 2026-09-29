/**
 * Telegram → CommandContext adapter.
 *
 * Converts a Telegraf context object into the platform-neutral CommandContext
 * that the shared CommandRegistry operates on.
 */

import type { CommandContext } from "../types";

/** The subset of the Telegraf Context we need — avoids importing the full
 *  Telegraf types here, keeping this file light. */
export interface TelegrafCtx {
  from?: { id: number; username?: string };
  chat?: { type: string };
  message?: { text?: string };
  reply(text: string, extra?: Record<string, unknown>): Promise<unknown>;
}

/**
 * Build a CommandContext from a Telegraf handler context.
 *
 * @param ctx         The raw Telegraf context
 * @param commandName The canonical command name (e.g. "ping"), without the /
 * @param args        Pre-split argument strings
 */
export function fromTelegrafCtx(
  ctx: TelegrafCtx,
  commandName: string,
  args: string[] = []
): CommandContext {
  const userId = String(ctx.from?.id ?? "unknown");
  const isDM = ctx.chat?.type === "private";

  return {
    command: commandName,
    args,
    userId,
    platform: "telegram",
    isDM,
    // Telegram has no server roles
    roles: [],
    raw: ctx,

    async reply(text: string) {
      await ctx.reply(applyTelegramFormatting(text), { parse_mode: "HTML" });
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert neutral command output to Telegram HTML.
 *
 * Rules (mirrors applyDiscordFormatting but for HTML):
 *   - Stellar addresses → <code>
 *   - "Key: value" lines → <b>Key:</b>
 */
export function applyTelegramFormatting(text: string): string {
  return (
    text
      // Escape HTML entities that would break Telegram's parser
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // Stellar addresses → <code>
      .replace(/\b([A-Z]{1}[A-Z0-9]{55})\b/g, "<code>$1</code>")
      // Bold "Key: value" patterns
      .replace(/^([A-Z][A-Za-z ]+):/gm, "<b>$1:</b>")
  );
}
