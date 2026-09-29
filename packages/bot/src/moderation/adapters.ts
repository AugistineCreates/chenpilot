/**
 * Moderation Event Translators
 *
 * Thin, dependency-free translators from platform-native message shapes to
 * the shared `ModerationEvent`. Structural types are used instead of
 * discord.js / telegraf imports so the moderation module stays
 * platform-neutral and the translators accept both real SDK objects and
 * test fakes.
 */

import type { ModerationEvent } from "./types";

// ─── Discord ──────────────────────────────────────────────────────────────────

/**
 * Structural subset of a discord.js Message that moderation needs.
 */
export interface DiscordMessageLike {
  id: string;
  content: string;
  channelId: string;
  guildId?: string | null;
  createdTimestamp?: number;
  author: {
    id: string;
    bot?: boolean;
  };
}

/**
 * Translate a Discord message into a ModerationEvent.
 */
export function discordMessageToModerationEvent(
  message: DiscordMessageLike
): ModerationEvent {
  return {
    platform: "discord",
    userId: message.author.id,
    channelId: message.channelId,
    messageId: message.id,
    content: message.content,
    timestamp: message.createdTimestamp ?? Date.now(),
    metadata: message.guildId ? { guildId: message.guildId } : undefined,
  };
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

/**
 * Structural subset of a Telegraf text-message context.
 */
export interface TelegramContextLike {
  from?: {
    id: number | string;
    is_bot?: boolean;
  };
  chat?: {
    id: number | string;
    type?: string;
  };
  message?: {
    message_id?: number;
    text?: string;
    caption?: string;
    date?: number;
  };
}

/**
 * Translate a Telegraf context into a ModerationEvent.
 *
 * Returns null when the update has no sender or no moderatable text
 * (e.g. sticker-only messages), so callers can skip moderation cleanly.
 */
export function telegramContextToModerationEvent(
  ctx: TelegramContextLike
): ModerationEvent | null {
  const content = ctx.message?.text ?? ctx.message?.caption;
  if (!ctx.from || content === undefined) {
    return null;
  }

  return {
    platform: "telegram",
    userId: String(ctx.from.id),
    channelId: ctx.chat !== undefined ? String(ctx.chat.id) : undefined,
    messageId:
      ctx.message?.message_id !== undefined
        ? String(ctx.message.message_id)
        : undefined,
    content,
    // Telegram dates are epoch seconds; normalise to milliseconds.
    timestamp:
      ctx.message?.date !== undefined ? ctx.message.date * 1000 : Date.now(),
    metadata:
      ctx.chat?.type !== undefined ? { chatType: ctx.chat.type } : undefined,
  };
}
