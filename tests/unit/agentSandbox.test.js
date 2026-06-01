"use strict";
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done
          ? resolve(result.value)
          : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const AgentSandbox_1 = require("../../src/Agents/sandbox/AgentSandbox");
const MockToolRegistry_1 = require("../../src/Agents/sandbox/MockToolRegistry");
jest.mock("../../src/config/logger");
jest.mock("@anthropic-ai/sdk");
// Mock the LLM so planner tests don't need a real API key
jest.mock("../../src/Agents/agent", () => ({
  agentLLM: {
    callLLM: jest.fn().mockResolvedValue({
      workflow: [
        {
          action: "wallet_tool",
          payload: { operation: "get_balance", token: "XLM" },
          description: "Check XLM balance",
          stepNumber: 1,
          dependencies: [],
          estimatedDuration: 500,
        },
      ],
    }),
  },
}));
// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Build a minimal ExecutionPlan for executor-only tests */
function buildPlan(steps) {
  return {
    planId: "plan_test_001",
    steps: steps.map((s, i) => {
      var _a;
      return {
        stepNumber: i + 1,
        action: s.action,
        payload: (_a = s.payload) !== null && _a !== void 0 ? _a : {},
        description: `Step ${i + 1}: ${s.action}`,
        dependencies: i > 0 ? [i] : [],
        estimatedDuration: 100,
      };
    }),
    totalSteps: steps.length,
    estimatedDuration: steps.length * 100,
    riskLevel: "low",
    requiresApproval: false,
    summary: "Test plan",
    planHash: "mock_hash",
    createdAt: new Date().toISOString(),
  };
}
// ─── MockToolRegistry ─────────────────────────────────────────────────────────
(0, globals_1.describe)("MockToolRegistry", () => {
  let registry;
  (0, globals_1.beforeEach)(() => {
    registry = new MockToolRegistry_1.MockToolRegistry();
  });
  (0, globals_1.it)("executes a success mock", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      registry.mockSuccess("wallet_tool", { balance: "100" });
      const result = yield registry.execute("wallet_tool", {}, "user-1");
      (0, globals_1.expect)(result.status).toBe("success");
      (0, globals_1.expect)(result.data).toEqual({ balance: "100" });
    })
  );
  (0, globals_1.it)("executes an error mock", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      registry.mockError("swap_tool", "Insufficient funds");
      const result = yield registry.execute("swap_tool", {}, "user-1");
      (0, globals_1.expect)(result.status).toBe("error");
      (0, globals_1.expect)(result.error).toBe("Insufficient funds");
    })
  );
  (0, globals_1.it)("executes a sequence mock in order", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      registry.mockSequence("wallet_tool", [
        { type: "success", data: { balance: "100" } },
        { type: "error", error: "Rate limited" },
        { type: "success", data: { balance: "200" } },
      ]);
      const r1 = yield registry.execute("wallet_tool", {}, "u");
      const r2 = yield registry.execute("wallet_tool", {}, "u");
      const r3 = yield registry.execute("wallet_tool", {}, "u");
      // Beyond sequence length – should clamp to last
      const r4 = yield registry.execute("wallet_tool", {}, "u");
      (0, globals_1.expect)(r1.status).toBe("success");
      (0, globals_1.expect)(r2.status).toBe("error");
      (0, globals_1.expect)(r3.status).toBe("success");
      (0, globals_1.expect)(r3.data.balance).toBe("200");
      (0, globals_1.expect)(r4.status).toBe("success"); // clamped to last
    })
  );
  (0, globals_1.it)("executes a delay mock", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      registry.mock("slow_tool", {
        type: "delay",
        ms: 50,
        then: { type: "success", data: { done: true } },
      });
      const start = Date.now();
      const result = yield registry.execute("slow_tool", {}, "u");
      const elapsed = Date.now() - start;
      (0, globals_1.expect)(result.status).toBe("success");
      (0, globals_1.expect)(elapsed).toBeGreaterThanOrEqual(40);
    })
  );
  (0, globals_1.it)("executes a fn mock with payload access", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      registry.mock("dynamic_tool", {
        type: "fn",
        handler: (payload) => ({
          type: "success",
          data: { echo: payload.input },
        }),
      });
      const result = yield registry.execute(
        "dynamic_tool",
        { input: "hello" },
        "u"
      );
      (0, globals_1.expect)(result.status).toBe("success");
      (0, globals_1.expect)(result.data.echo).toBe("hello");
    })
  );
  (0, globals_1.it)("throws for unmocked tools by default", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      yield (0, globals_1.expect)(
        registry.execute("unknown_tool", {}, "u")
      ).rejects.toThrow('tool "unknown_tool" has no mock registered');
    })
  );
  (0, globals_1.it)("allows unmocked tools when configured", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const permissive = new MockToolRegistry_1.MockToolRegistry({
        allowUnmocked: true,
      });
      const result = yield permissive.execute("any_tool", {}, "u");
      (0, globals_1.expect)(result.status).toBe("success");
      (0, globals_1.expect)(result.message).toContain("passthrough");
    })
  );
  (0, globals_1.it)("records calls by default", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      registry.mockSuccess("wallet_tool");
      registry.mockSuccess("swap_tool");
      yield registry.execute("wallet_tool", { op: "balance" }, "u");
      yield registry.execute("swap_tool", { from: "XLM" }, "u");
      const calls = registry.getCalls();
      (0, globals_1.expect)(calls).toHaveLength(2);
      (0, globals_1.expect)(calls[0].toolName).toBe("wallet_tool");
      (0, globals_1.expect)(calls[1].toolName).toBe("swap_tool");
    })
  );
  (0, globals_1.it)("resets call history without removing mocks", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      registry.mockSuccess("wallet_tool");
      yield registry.execute("wallet_tool", {}, "u");
      registry.resetCalls();
      (0, globals_1.expect)(registry.getCalls()).toHaveLength(0);
      // Mock still works after reset
      const result = yield registry.execute("wallet_tool", {}, "u");
      (0, globals_1.expect)(result.status).toBe("success");
    })
  );
  (0, globals_1.it)("enforces maxToolCalls limit", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const limited = new MockToolRegistry_1.MockToolRegistry({
        maxToolCalls: 2,
      });
      limited.mockSuccess("tool_a");
      yield limited.execute("tool_a", {}, "u");
      yield limited.execute("tool_a", {}, "u");
      yield (0, globals_1.expect)(
        limited.execute("tool_a", {}, "u")
      ).rejects.toThrow("max tool calls (2) exceeded");
    })
  );
  (0, globals_1.it)("builds a valid ToolDefinition from a mock", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      registry.mockSuccess("my_tool", { result: 42 });
      const toolDef = registry.buildMockTool("my_tool", {
        description: "A test tool",
        category: "test",
      });
      (0, globals_1.expect)(toolDef.metadata.name).toBe("my_tool");
      (0, globals_1.expect)(toolDef.metadata.category).toBe("test");
      const result = yield toolDef.execute({}, "u");
      (0, globals_1.expect)(result.status).toBe("success");
      (0, globals_1.expect)(result.data.result).toBe(42);
    })
  );
});
// ─── AgentSandbox – executor-level tests ─────────────────────────────────────
(0, globals_1.describe)("AgentSandbox – executePlan", () => {
  let sandbox;
  (0, globals_1.beforeEach)(() => {
    sandbox = new AgentSandbox_1.AgentSandbox({ userId: "test-user" });
  });
  (0, globals_1.it)("executes a single-step plan with a success mock", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      sandbox.mockSuccess("wallet_tool", { balance: "500 XLM" });
      const plan = buildPlan([
        { action: "wallet_tool", payload: { operation: "get_balance" } },
      ]);
      const { executionResult, assertions } = yield sandbox.executePlan(plan);
      (0, globals_1.expect)(executionResult.status).toBe("success");
      (0, globals_1.expect)(executionResult.completedSteps).toBe(1);
      (0, globals_1.expect)(assertions.toolWasCalled("wallet_tool")).toBe(true);
      (0, globals_1.expect)(assertions.toolCallCount("wallet_tool")).toBe(1);
    })
  );
  (0, globals_1.it)("executes a multi-step plan and records all calls", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      sandbox
        .mockSuccess("wallet_tool", { balance: "1000" })
        .mockSuccess("swap_tool", { txHash: "0xabc123" });
      const plan = buildPlan([
        { action: "wallet_tool", payload: { operation: "get_balance" } },
        {
          action: "swap_tool",
          payload: { from: "XLM", to: "USDC", amount: 100 },
        },
      ]);
      const { assertions } = yield sandbox.executePlan(plan);
      (0, globals_1.expect)(assertions.toolCallCount("wallet_tool")).toBe(1);
      (0, globals_1.expect)(assertions.toolCallCount("swap_tool")).toBe(1);
      (0, globals_1.expect)(
        assertions.calledBefore("wallet_tool", "swap_tool")
      ).toBe(true);
    })
  );
  (0, globals_1.it)("records call payloads correctly", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      sandbox.mockSuccess("swap_tool");
      const plan = buildPlan([
        {
          action: "swap_tool",
          payload: { from: "XLM", to: "USDC", amount: 50 },
        },
      ]);
      const { assertions } = yield sandbox.executePlan(plan);
      const call = assertions.getNthCall("swap_tool", 0);
      (0, globals_1.expect)(call).toBeDefined();
      (0, globals_1.expect)(call.payload).toMatchObject({
        from: "XLM",
        to: "USDC",
        amount: 50,
      });
    })
  );
  (0, globals_1.it)("handles a failing tool step", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      sandbox.mockError("swap_tool", "Slippage too high");
      const plan = buildPlan([
        { action: "swap_tool", payload: { from: "XLM", to: "USDC" } },
      ]);
      const { executionResult, assertions } = yield sandbox.executePlan(plan);
      (0, globals_1.expect)(assertions.toolWasCalled("swap_tool")).toBe(true);
      // The mock returns a ToolResult with status "error" – the step itself
      // completes (no exception thrown), so executionResult records it as success
      // but the tool result carries the error status
      const call = assertions.getNthCall("swap_tool", 0);
      (0, globals_1.expect)(call.result.status).toBe("error");
      (0, globals_1.expect)(call.result.error).toBe("Slippage too high");
      (0, globals_1.expect)(executionResult.completedSteps).toBe(1);
    })
  );
  (0, globals_1.it)("continues past errors when stopOnError is false", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      sandbox
        .mockError("wallet_tool", "Network error")
        .mockSuccess("swap_tool", { txHash: "0xdef" });
      const plan = buildPlan([
        { action: "wallet_tool" },
        { action: "swap_tool" },
      ]);
      const { executionResult, assertions } = yield sandbox.executePlan(plan, {
        stopOnError: false,
      });
      (0, globals_1.expect)(assertions.toolWasCalled("wallet_tool")).toBe(true);
      (0, globals_1.expect)(assertions.toolWasCalled("swap_tool")).toBe(true);
      // Both steps complete (mock returns result, not exception)
      (0, globals_1.expect)(executionResult.completedSteps).toBe(2);
      // Tool-level error is captured in the call record
      (0, globals_1.expect)(
        assertions.getNthCall("wallet_tool", 0).result.status
      ).toBe("error");
      (0, globals_1.expect)(
        assertions.getNthCall("swap_tool", 0).result.status
      ).toBe("success");
    })
  );
  (0, globals_1.it)("preserves a snapshot of the plan before execution", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      sandbox.mockSuccess("wallet_tool");
      const plan = buildPlan([{ action: "wallet_tool" }]);
      const { planSnapshot } = yield sandbox.executePlan(plan);
      (0, globals_1.expect)(planSnapshot.planId).toBe(plan.planId);
      (0, globals_1.expect)(planSnapshot.totalSteps).toBe(1);
    })
  );
  (0, globals_1.it)("resets call history between runs", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      sandbox.mockSuccess("wallet_tool");
      const plan = buildPlan([{ action: "wallet_tool" }]);
      yield sandbox.executePlan(plan);
      const { assertions } = yield sandbox.executePlan(plan);
      // Second run should only see its own calls
      (0, globals_1.expect)(assertions.toolCallCount("wallet_tool")).toBe(1);
    })
  );
  (0, globals_1.it)("returns all calls in order via allCalls()", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      sandbox
        .mockSuccess("wallet_tool")
        .mockSuccess("swap_tool")
        .mockSuccess("wallet_tool");
      const plan = buildPlan([
        { action: "wallet_tool" },
        { action: "swap_tool" },
        { action: "wallet_tool" },
      ]);
      const { assertions } = yield sandbox.executePlan(plan);
      const all = assertions.allCalls();
      (0, globals_1.expect)(all.map((c) => c.toolName)).toEqual([
        "wallet_tool",
        "swap_tool",
        "wallet_tool",
      ]);
    })
  );
});
// ─── AgentSandbox – planner-level tests ──────────────────────────────────────
(0, globals_1.describe)("AgentSandbox – plan()", () => {
  let sandbox;
  (0, globals_1.beforeEach)(() => {
    sandbox = new AgentSandbox_1.AgentSandbox();
    sandbox.mockSuccess("wallet_tool", {}).mockSuccess("swap_tool");
  });
  (0, globals_1.it)(
    "returns a plan with at least one step for a balance check",
    () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const plan = yield sandbox.plan("Check my XLM balance");
        (0, globals_1.expect)(plan.planId).toMatch(/^plan_/);
        (0, globals_1.expect)(plan.totalSteps).toBeGreaterThan(0);
        (0, globals_1.expect)(plan.steps.length).toBe(plan.totalSteps);
      })
  );
  (0, globals_1.it)("returns a plan with a valid riskLevel", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const plan = yield sandbox.plan("Swap 100 XLM to USDC");
      (0, globals_1.expect)(["low", "medium", "high"]).toContain(
        plan.riskLevel
      );
    })
  );
  (0, globals_1.it)("respects maxSteps constraint", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const plan = yield sandbox.plan("Do many operations", {
        constraints: { maxSteps: 2 },
      });
      (0, globals_1.expect)(plan.totalSteps).toBeLessThanOrEqual(2);
    })
  );
  (0, globals_1.it)("includes step descriptions", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const plan = yield sandbox.plan("Check my balance");
      plan.steps.forEach((step) => {
        (0, globals_1.expect)(typeof step.description).toBe("string");
        (0, globals_1.expect)(step.description.length).toBeGreaterThan(0);
      });
    })
  );
  (0, globals_1.it)("numbers steps sequentially starting at 1", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const plan = yield sandbox.plan("Check balance and swap");
      plan.steps.forEach((step, idx) => {
        (0, globals_1.expect)(step.stepNumber).toBe(idx + 1);
      });
    })
  );
});
// ─── AgentSandbox – full run() integration ───────────────────────────────────
(0, globals_1.describe)("AgentSandbox – run()", () => {
  let sandbox;
  (0, globals_1.beforeEach)(() => {
    sandbox = new AgentSandbox_1.AgentSandbox({ userId: "integration-user" });
    // The mocked LLM always returns a wallet_tool step
    sandbox.mockSuccess("wallet_tool", { balance: "1000 XLM" });
  });
  (0, globals_1.it)("runs plan-and-execute end-to-end", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const { executionResult, assertions } = yield sandbox.run(
        "Check my XLM balance"
      );
      (0, globals_1.expect)(executionResult.status).toMatch(/success|partial/);
      (0, globals_1.expect)(assertions.allCalls().length).toBeGreaterThan(0);
    })
  );
  (0, globals_1.it)("exposes the plan snapshot", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const { planSnapshot } = yield sandbox.run("Check balance");
      (0, globals_1.expect)(planSnapshot.planId).toMatch(/^plan_/);
      (0, globals_1.expect)(planSnapshot.steps.length).toBeGreaterThan(0);
    })
  );
  (0, globals_1.it)("reports the sandbox userId", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const { sandboxUserId } = yield sandbox.run("Check balance");
      (0, globals_1.expect)(sandboxUserId).toBe("integration-user");
    })
  );
  (0, globals_1.it)("resets calls between successive run() calls", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      yield sandbox.run("Check balance");
      const { assertions } = yield sandbox.run("Check balance");
      const total = assertions.allCalls().length;
      (0, globals_1.expect)(total).toBeGreaterThan(0);
      (0, globals_1.expect)(total).toBeLessThan(20);
    })
  );
});
// ─── AgentSandbox – assertion helpers ────────────────────────────────────────
(0, globals_1.describe)("SandboxAssertions", () => {
  let sandbox;
  (0, globals_1.beforeEach)(() => {
    sandbox = new AgentSandbox_1.AgentSandbox();
    sandbox
      .mockSuccess("tool_a", { step: "a" })
      .mockSuccess("tool_b", { step: "b" })
      .mockSuccess("tool_c", { step: "c" });
  });
  (0, globals_1.it)("calledBefore returns true for correct order", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const plan = buildPlan([
        { action: "tool_a" },
        { action: "tool_b" },
        { action: "tool_c" },
      ]);
      const { assertions } = yield sandbox.executePlan(plan);
      (0, globals_1.expect)(assertions.calledBefore("tool_a", "tool_b")).toBe(
        true
      );
      (0, globals_1.expect)(assertions.calledBefore("tool_a", "tool_c")).toBe(
        true
      );
      (0, globals_1.expect)(assertions.calledBefore("tool_b", "tool_c")).toBe(
        true
      );
    })
  );
  (0, globals_1.it)("calledBefore returns false for wrong order", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const plan = buildPlan([{ action: "tool_a" }, { action: "tool_b" }]);
      const { assertions } = yield sandbox.executePlan(plan);
      (0, globals_1.expect)(assertions.calledBefore("tool_b", "tool_a")).toBe(
        false
      );
    })
  );
  (0, globals_1.it)(
    "calledBefore returns false when a tool was never called",
    () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const plan = buildPlan([{ action: "tool_a" }]);
        const { assertions } = yield sandbox.executePlan(plan);
        (0, globals_1.expect)(assertions.calledBefore("tool_a", "tool_b")).toBe(
          false
        );
        (0, globals_1.expect)(assertions.calledBefore("tool_b", "tool_a")).toBe(
          false
        );
      })
  );
  (0, globals_1.it)("getNthCall returns the correct call", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      sandbox.mockSuccess("tool_a");
      const plan = buildPlan([
        { action: "tool_a", payload: { n: 1 } },
        { action: "tool_b" },
        { action: "tool_a", payload: { n: 2 } },
      ]);
      const { assertions } = yield sandbox.executePlan(plan);
      const first = assertions.getNthCall("tool_a", 0);
      const second = assertions.getNthCall("tool_a", 1);
      (0, globals_1.expect)(first.payload.n).toBe(1);
      (0, globals_1.expect)(second.payload.n).toBe(2);
    })
  );
  (0, globals_1.it)("getNthCall returns undefined for out-of-range index", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const plan = buildPlan([{ action: "tool_a" }]);
      const { assertions } = yield sandbox.executePlan(plan);
      (0, globals_1.expect)(assertions.getNthCall("tool_a", 5)).toBeUndefined();
    })
  );
  (0, globals_1.it)(
    "getCallsFor returns only calls for the specified tool",
    () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const plan = buildPlan([
          { action: "tool_a" },
          { action: "tool_b" },
          { action: "tool_a" },
        ]);
        const { assertions } = yield sandbox.executePlan(plan);
        const aCalls = assertions.getCallsFor("tool_a");
        (0, globals_1.expect)(aCalls).toHaveLength(2);
        aCalls.forEach((c) => (0, globals_1.expect)(c.toolName).toBe("tool_a"));
      })
  );
});
// ─── AgentSandbox – configuration options ────────────────────────────────────
(0, globals_1.describe)("AgentSandbox – configuration", () => {
  (0, globals_1.it)("uses custom userId in tool calls", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const sandbox = new AgentSandbox_1.AgentSandbox({
        userId: "custom-user-42",
      });
      sandbox.mockSuccess("wallet_tool");
      const plan = buildPlan([{ action: "wallet_tool" }]);
      const { toolCalls, sandboxUserId } = yield sandbox.executePlan(plan);
      (0, globals_1.expect)(sandboxUserId).toBe("custom-user-42");
      (0, globals_1.expect)(toolCalls[0].userId).toBe("custom-user-42");
    })
  );
  (0, globals_1.it)("applies globalDelayMs to all tool calls", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const sandbox = new AgentSandbox_1.AgentSandbox({ globalDelayMs: 50 });
      sandbox.mockSuccess("wallet_tool");
      const plan = buildPlan([{ action: "wallet_tool" }]);
      const start = Date.now();
      yield sandbox.executePlan(plan);
      const elapsed = Date.now() - start;
      (0, globals_1.expect)(elapsed).toBeGreaterThanOrEqual(40);
    })
  );
  (0, globals_1.it)("clear() removes all mocks and history", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const sandbox = new AgentSandbox_1.AgentSandbox({ allowUnmocked: false });
      sandbox.mockSuccess("wallet_tool");
      const plan = buildPlan([{ action: "wallet_tool" }]);
      yield sandbox.executePlan(plan);
      sandbox.clear();
      // After clear, the mock is gone
      yield (0, globals_1.expect)(
        sandbox.getMockRegistry().execute("wallet_tool", {}, "u")
      ).rejects.toThrow("no mock registered");
    })
  );
});
