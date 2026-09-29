import {
  createExecutionContext,
  getExecutionContext,
  runWithExecutionContext,
  withChildExecution,
  updateExecutionContext,
  extractContextFromHeaders,
  buildCorrelationHeaders,
  getLogFields,
  ExecutionContext,
} from "../context";

describe("ExecutionContext", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createExecutionContext", () => {
    it("generates ids when not provided", () => {
      const ctx = createExecutionContext();

      expect(ctx.requestId).toBeDefined();
      expect(ctx.executionId).toBeDefined();
      expect(ctx.rootExecutionId).toBeDefined();
      expect(ctx.transport).toBe("http");
    });

    it("preserves provided ids", () => {
      const ctx = createExecutionContext({
        requestId: "req-1",
        executionId: "exec-1",
        rootExecutionId: "root-1",
      });

      expect(ctx.requestId).toBe("req-1");
      expect(ctx.executionId).toBe("exec-1");
      expect(ctx.rootExecutionId).toBe("root-1");
    });

    it("derives rootExecutionId from parentExecutionId when root missing", () => {
      const ctx = createExecutionContext({
        parentExecutionId: "parent-1",
      });

      expect(ctx.rootExecutionId).toBe("parent-1");
      expect(ctx.parentExecutionId).toBe("parent-1");
    });

    it("defaults transport to http", () => {
      const ctx = createExecutionContext();
      expect(ctx.transport).toBe("http");
    });

    it("accepts arbitrary transport values", () => {
      const ctx = createExecutionContext({ transport: "websocket" });
      expect(ctx.transport).toBe("websocket");
    });
  });

  describe("runWithExecutionContext", () => {
    it("sets context for the duration of the callback", () => {
      let captured: ExecutionContext | undefined;

      runWithExecutionContext(
        { requestId: "req-1", executionId: "exec-1", transport: "queue" },
        () => {
          captured = getExecutionContext();
        }
      );

      expect(captured?.requestId).toBe("req-1");
      expect(captured?.executionId).toBe("exec-1");
      expect(captured?.transport).toBe("queue");
    });

    it("cleans up context after callback completes", () => {
      runWithExecutionContext(
        { requestId: "req-1", executionId: "exec-1", transport: "queue" },
        () => {
          expect(getExecutionContext()?.requestId).toBe("req-1");
        }
      );

      expect(getExecutionContext()).toBeUndefined();
    });
  });

  describe("withChildExecution", () => {
    it("creates a child execution with new executionId", () => {
      let childCtx: ExecutionContext | undefined;

      withChildExecution(
        { requestId: "req-1", executionId: "parent-1", transport: "http" },
        () => {
          childCtx = getExecutionContext();
        }
      );

      expect(childCtx?.requestId).toBe("req-1");
      expect(childCtx?.executionId).not.toBe("parent-1");
      expect(childCtx?.parentExecutionId).toBe("parent-1");
      expect(childCtx?.rootExecutionId).toBe("parent-1");
    });
  });

  describe("updateExecutionContext", () => {
    it("mutates the current store", () => {
      runWithExecutionContext(
        { requestId: "req-1", executionId: "exec-1", transport: "http" },
        () => {
          updateExecutionContext({ userId: "user-1" });
          expect(getExecutionContext()?.userId).toBe("user-1");
        }
      );
    });

    it("is a no-op outside a context", () => {
      expect(() => updateExecutionContext({ userId: "user-1" })).not.toThrow();
      expect(getExecutionContext()).toBeUndefined();
    });
  });

  describe("extractContextFromHeaders", () => {
    it("extracts correlation headers", () => {
      const headers = {
        "x-request-id": "req-123",
        "x-correlation-id": "corr-456",
        "x-execution-id": "exec-789",
        "x-root-execution-id": "root-abc",
        "x-parent-execution-id": "parent-def",
      };

      const ctx = extractContextFromHeaders(headers);

      expect(ctx.requestId).toBe("req-123");
      expect(ctx.executionId).toBe("exec-789");
      expect(ctx.rootExecutionId).toBe("root-abc");
      expect(ctx.parentExecutionId).toBe("parent-def");
    });

    it("falls back to x-correlation-id for requestId", () => {
      const ctx = extractContextFromHeaders({
        "x-correlation-id": "corr-123",
      });

      expect(ctx.requestId).toBe("corr-123");
    });

    it("handles missing headers", () => {
      const ctx = extractContextFromHeaders({});
      expect(ctx.requestId).toBeUndefined();
      expect(ctx.executionId).toBeUndefined();
      expect(ctx.rootExecutionId).toBeUndefined();
      expect(ctx.parentExecutionId).toBeUndefined();
    });
  });

  describe("buildCorrelationHeaders", () => {
    it("builds headers from current context", () => {
      const headers = runWithExecutionContext(
        { requestId: "req-1", executionId: "exec-1", transport: "http" },
        () => buildCorrelationHeaders()
      );

      expect(headers["x-request-id"]).toBe("req-1");
      expect(headers["x-correlation-id"]).toBe("req-1");
      expect(headers["x-execution-id"]).toBe("exec-1");
      expect(headers["x-root-execution-id"]).toBe("req-1");
    });

    it("includes parent header when present", () => {
      const headers = runWithExecutionContext(
        {
          requestId: "req-1",
          executionId: "exec-1",
          rootExecutionId: "root-1",
          parentExecutionId: "parent-1",
          transport: "http",
        },
        () => buildCorrelationHeaders()
      );

      expect(headers["x-parent-execution-id"]).toBe("parent-1");
    });
  });

  describe("getLogFields", () => {
    it("returns empty object when no context", () => {
      expect(getLogFields()).toEqual({});
    });

    it("returns populated fields from context", () => {
      const fields = runWithExecutionContext(
        {
          requestId: "req-1",
          executionId: "exec-1",
          rootExecutionId: "root-1",
          userId: "user-1",
          roles: ["admin"],
          transport: "http",
          queueName: "side-effects",
          jobId: "job-1",
          messageId: "msg-1",
          chatId: "chat-1",
          path: "/api/test",
          method: "GET",
          ip: "127.0.0.1",
        },
        () => getLogFields()
      );

      expect(fields).toMatchObject({
        requestId: "req-1",
        executionId: "exec-1",
        rootExecutionId: "root-1",
        userId: "user-1",
        roles: "admin",
        transport: "http",
        queueName: "side-effects",
        jobId: "job-1",
        messageId: "msg-1",
        chatId: "chat-1",
        path: "/api/test",
        method: "GET",
        ip: "127.0.0.1",
      });
    });
  });
});
