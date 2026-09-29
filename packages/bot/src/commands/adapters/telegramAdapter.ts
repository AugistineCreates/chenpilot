/**
 * Telegram Adapter for Typed Command System
 * Bridges the new typed command system with the existing Telegram adapter
 */

import {
  CommandContext,
  CommandReply,
  Platform,
} from '../types.js';
import {
  CommandContract,
  TypedCommandContext,
  TypedCommandResult,
} from '../types.js';

/**
 * Convert Telegram Telegraf context to CommandContext
 */
export function fromTelegrafCtx(ctx: any, commandName: string, args: string[]): CommandContext {
  return {
    command: commandName,
    args,
    userId: ctx.from?.id?.toString() || 'unknown',
    platform: 'telegram' as Platform,
    isDM: ctx.chat?.type === 'private',
    reply: async (text: string) => {
      await ctx.reply(text);
    },
    roles: undefined, // Telegram doesn't have server roles
    raw: ctx,
  };
}

/**
 * Convert CommandContext to TypedCommandContext
 */
export function toTypedContext<TInput>(
  ctx: CommandContext,
  input: TInput,
  services: any
): TypedCommandContext<TInput> {
  return {
    ...ctx,
    input,
    metadata: {
      timestamp: Date.now(),
      messageId: ctx.raw?.message?.message_id?.toString() || 'unknown',
      replyToMessageId: ctx.raw?.message?.reply_to_message?.message_id?.toString(),
    },
    services,
  };
}

/**
 * Convert TypedCommandResult to CommandReply
 */
export function toCommandReply<TOutput>(result: TypedCommandResult<TOutput>): CommandReply {
  if (result.success) {
    return {
      text: JSON.stringify(result.data, null, 2),
      ephemeral: false,
    };
  } else {
    return {
      text: result.error.userMessage || result.error.message,
      ephemeral: false,
    };
  }
}

/**
 * Execute typed command contract
 */
export async function executeTypedCommand<TInput, TOutput>(
  contract: CommandContract<TInput, TOutput>,
  ctx: CommandContext,
  input: TInput,
  services: any
): Promise<CommandReply> {
  const typedCtx = toTypedContext(ctx, input, services);
  const result = await contract.handler(typedCtx);
  return toCommandReply(result);
}
