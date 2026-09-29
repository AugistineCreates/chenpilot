import {
  createBotContext,
  propagateBotCommand,
  createBotExecutionContext,
  getBotExecutionContext,
  runWithBotExecutionContext,
  updateBotExecutionContext,
  getBotLogFields,
} from "../context";
import type { CommandContext } from "../../commands/types";

const mockCommandCtx: CommandContext = {
  command: "swap",
  args: ["100", "XLM", "USDC"],
  userId: "user-123",
  platform: "telegram",
  isDM: true,
  reply: async () => {},
  raw: {
    message_id: 456,
    chat: { id: 789 },
  },
};

describe("BotExecutionContext", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createBotExecutionContext", () => {
    it("generates ids when not provided", () => {
      const ctx = createBotExecutionContext({ userId: "user-123", transport: "telegram" });

      expect(ctx.requestId).toBeDefined();
      expect(ctx.executionId).toBeDefined();
      expect(ctx.rootExecutionId).toBe(ctx.executionId);
      expect(ctx.userId).toBe("user-123");
      expect(ctx.transport).toBe("telegram");
    });

    it("preserves provided ids", () => {
      const ctx = createBotExecutionContext({
        requestId: "req-1",
        executionId: "exec-1",
        rootExecutionId: "root-1",
        userId: "user-123",
      });

      expect(ctx.requestId).toBe("req-1");
      expect(ctx.executionId).toBe("exec-1");
      expect(ctx.rootExecutionId).toBe("root-1");
    });
  });

  describe("runWithBotExecutionContext", () => {
    it("sets context for the duration of the callback", () => {
      let captured: ReturnType<typeof getBotExecutionContext>;

      runWithBotExecutionContext(
        { userId: "user-123", transport: "telegram" },
        () => {
          captured = getBotExecutionContext();
        }
      );

      expect(captured?.userId).toBe("user-123");
      expect(captured?.transport).toBe("telegram");
    });

    it("cleans up context after callback completes", () => {
      runWithBotExecutionContext(
        { userId: "user-123", transport: "telegram" },
        () => {
          expect(getBotExecutionContext()?.userId).toBe("user-123");
        }
      );

      expect(getBotExecutionContext()).toBeUndefined();
    });
  });

  describe("createBotContext", () => {
    it("maps CommandContext to BotExecutionContext", () => {
      const ctx = createBotContext(mockCommandCtx);

      expect(ctx.userId).toBe("user-123");
      expect(ctx.transport).toBe("telegram");
      expect(ctx.messageId).toBe("456");
      expect(ctx.chatId).toBe("789");
    });

    it("handles missing raw gracefully", () => {
      const ctx = createBotContext({
        ...mockCommandCtx,
        raw: {},
      });

      expect(ctx.userId).toBe("user-123");
      expect(ctx.messageId).toBeUndefined();
      expect(ctx.chatId).toBeUndefined();
    });
  });

  describe("propagateBotCommand", () => {
    it("wraps handler execution with bot context", () => {
      let capturedUserId: string | undefined;

      propagateBotCommand(mockCommandCtx, () => {
        capturedUserId = getBotExecutionContext()?.userId;
        return "result";
      });

      expect(capturedUserId).toBe("user-123");
    });
  });

  describe("updateBotExecutionContext", () => {
    it("mutates the current store", () => {
      runWithBotExecutionContext(
        { userId: "user-123", transport: "telegram" },
        () => {
          updateBotExecutionContext({ userId: "user-456" });
          expect(getBotExecutionContext()?.userId).toBe("user-456");
        }
      );
    });
  });

  describe("getBotLogFields", () => {
    it("returns empty object when no context", () => {
      expect(getBotLogFields()).toEqual({});
    });

    it("returns populated fields from context", () => {
      const fields = runWithBotExecutionContext(
        {
          requestId: "req-1",
          executionId: "exec-1",
          rootExecutionId: "root-1",
          userId: "user-123",
          roles: ["admin"],
          transport: "telegram",
          messageId: "msg-1",
          chatId: "chat-1",
        },
        () => getBotLogFields()
      );

      expect(fields).toMatchObject({
        requestId: "req-1",
        executionId: "exec-1",
        rootExecutionId: "root-1",
        userId: "user-123",
        roles: "admin",
        transport: "telegram",
        messageId: "msg-1",
        chatId: "chat-1",
      });
    });
  });
});
