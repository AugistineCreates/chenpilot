import { CommandContext } from "../commands/types";
import {
  BotExecutionContext,
  createBotExecutionContext,
  runWithBotExecutionContext,
} from "./context";

export function createBotContext(commandCtx: CommandContext): BotExecutionContext {
  return createBotExecutionContext({
    userId: commandCtx.userId,
    roles: commandCtx.roles,
    transport: commandCtx.platform as "telegram" | "discord",
    messageId:
      commandCtx.raw && typeof commandCtx.raw === "object" && "message_id" in commandCtx.raw
        ? String((commandCtx.raw as any).message_id)
        : undefined,
    chatId:
      commandCtx.raw && typeof commandCtx.raw === "object" && "chat" in (commandCtx.raw as any)
        ? String((commandCtx.raw as any).chat?.id)
        : undefined,
    component: "bot",
  });
}

export function propagateBotCommand<T>(
  commandCtx: CommandContext,
  callback: () => T
): T {
  const context = createBotContext(commandCtx);
  return runWithBotExecutionContext(context, callback);
}
