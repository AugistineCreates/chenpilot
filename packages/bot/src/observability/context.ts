import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";

export type BotTransport = "telegram" | "discord";

export interface BotExecutionContext {
  requestId?: string;
  executionId?: string;
  rootExecutionId?: string;
  parentExecutionId?: string;
  userId: string;
  roles?: string[];
  transport: BotTransport;
  messageId?: string;
  chatId?: string;
  component: string;
  metadata?: Record<string, unknown>;
}

const botStorage = new AsyncLocalStorage<BotExecutionContext>();

export function getBotExecutionContext(): BotExecutionContext | undefined {
  return botStorage.getStore();
}

export function createBotExecutionContext(
  partial: Partial<BotExecutionContext>
): BotExecutionContext {
  const userId = partial.userId || "unknown";
  return {
    requestId: partial.requestId || randomUUID(),
    executionId: partial.executionId || randomUUID(),
    rootExecutionId: partial.rootExecutionId || partial.executionId,
    parentExecutionId: partial.parentExecutionId,
    userId,
    roles: partial.roles,
    transport: partial.transport,
    messageId: partial.messageId,
    chatId: partial.chatId,
    component: partial.component || "bot",
    metadata: partial.metadata,
  };
}

export function runWithBotExecutionContext<T>(
  context: Partial<BotExecutionContext>,
  callback: () => T
): T {
  const current = getBotExecutionContext();
  const nextContext = createBotExecutionContext({
    ...current,
    ...context,
    requestId: context.requestId || current?.requestId,
    rootExecutionId: context.rootExecutionId || current?.rootExecutionId,
    parentExecutionId: context.parentExecutionId || current?.parentExecutionId,
  });

  return botStorage.run(nextContext, callback);
}

export function withChildBotExecutionContext<T>(
  context: Partial<BotExecutionContext>,
  callback: () => T
): T {
  const current = getBotExecutionContext();
  const parentExecutionId = current?.executionId;
  const rootExecutionId = current?.rootExecutionId || parentExecutionId || randomUUID();

  return runWithBotExecutionContext(
    {
      ...current,
      ...context,
      requestId: current?.requestId,
      executionId: context.executionId || randomUUID(),
      rootExecutionId,
      parentExecutionId,
    },
    callback
  );
}

export function updateBotExecutionContext(
  updates: Partial<BotExecutionContext>
): void {
  const current = botStorage.getStore();
  if (!current) {
    return;
  }

  Object.assign(current, updates);
}

export function getBotLogFields(): Record<string, string> {
  const context = getBotExecutionContext();
  if (!context) {
    return {};
  }

  const fields: Record<string, string> = {
    requestId: context.requestId || "",
    executionId: context.executionId || "",
    rootExecutionId: context.rootExecutionId || "",
    userId: context.userId,
    transport: context.transport,
  };

  if (context.parentExecutionId) {
    fields.parentExecutionId = context.parentExecutionId;
  }
  if (context.roles && context.roles.length > 0) {
    fields.roles = context.roles.join(",");
  }
  if (context.messageId) {
    fields.messageId = context.messageId;
  }
  if (context.chatId) {
    fields.chatId = context.chatId;
  }
  if (context.component) {
    fields.component = context.component;
  }
  return fields;
}
