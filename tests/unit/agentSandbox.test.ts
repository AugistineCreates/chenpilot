import { describe, it, expect, beforeEach } from "@jest/globals";
import { AgentSandbox } from "../../src/Agents/sandbox/AgentSandbox";
import { MockToolRegistry } from "../../src/Agents/sandbox/MockToolRegistry";

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
function buildPlan(
  steps: Array<{ action: string; payload?: Record<string, unknown> }>
) {
  return {
    planId: "plan_test_001",
    steps: steps.map((s, i) => ({
      stepNumber: i + 1,
      action: s.action,
      payload: s.payload ?? {},
      description: `Step ${i + 1}: ${s.action}`,
      dependencies: i > 0 ? [i] : [],
      estimatedDuration: 100,
    })),
    totalSteps: steps.length,
    estimatedDuration: steps.length * 100,
    riskLevel: "low" as const,
    requiresApproval: false,
    summary: "Test plan",
    planHash: "mock_hash",
    createdAt: new Date().toISOString(),
  };
}

// ─── MockToolRegistry ─────────────────────────────────────────────────────────

describe("MockToolRegistry", () => {
  let registry: MockToolRegistry;

  beforeEach(() => {
    registry = new MockToolRegistry();
  });

  it("executes a success mock", async () => {
    registry.mockSuccess("wallet_tool", { balance: "100" });

    const result = await registry.execute("wallet_tool", {}, "user-1");

    expect(result.status).toBe("success");
    expect(result.data).toEqual({ balance: "100" });
  });

  it("executes an error mock", async () => {
    registry.mockError("swap_tool", "Insufficient funds");

    const result = await registry.execute("swap_tool", {}, "user-1");

    expect(result.status).toBe("error");
    expect(result.error).toBe("Insufficient funds");
  });

  it("executes a sequence mock in order", async () => {
    registry.mockSequence("wallet_tool", [
      { type: "success", data: { balance: "100" } },
      { type: "error", error: "Rate limited" },
      { type: "success", data: { balance: "200" } },
    ]);

    const r1 = await registry.execute("wallet_tool", {}, "u");
    const r2 = await registry.execute("wallet_tool", {}, "u");
    const r3 = await registry.execute("wallet_tool", {}, "u");
    // Beyond sequence length – should clamp to last
    const r4 = await registry.execute("wallet_tool", {}, "u");

    expect(r1.status).toBe("success");
    expect(r2.status).toBe("error");
    expect(r3.status).toBe("success");
    expect((r3.data as Record<string, unknown>).balance).toBe("200");
    expect(r4.status).toBe("success"); // clamped to last
  });

  it("executes a delay mock", async () => {
    registry.mock("slow_tool", {
      type: "delay",
      ms: 50,
      then: { type: "success", data: { done: true } },
    });

    const start = Date.now();
    const result = await registry.execute("slow_tool", {}, "u");
    const elapsed = Date.now() - start;

    expect(result.status).toBe("success");
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it("executes a fn mock with payload access", async () => {
    registry.mock("dynamic_tool", {
      type: "fn",
      handler: (payload) => ({
        type: "success",
        data: { echo: (payload as Record<string, unknown>).input },
      }),
    });

    const result = await registry.execute(
      "dynamic_tool",
      { input: "hello" },
      "u"
    );

    expect(result.status).toBe("success");
    expect((result.data as Record<string, unknown>).echo).toBe("hello");
  });

  it("throws for unmocked tools by default", async () => {
    await expect(registry.execute("unknown_tool", {}, "u")).rejects.toThrow(
      'tool "unknown_tool" has no mock registered'
    );
  });

  it("allows unmocked tools when configured", async () => {
    const permissive = new MockToolRegistry({ allowUnmocked: true });

    const result = await permissive.execute("any_tool", {}, "u");

    expect(result.status).toBe("success");
    expect(result.message).toContain("passthrough");
  });

  it("records calls by default", async () => {
    registry.mockSuccess("wallet_tool");
    registry.mockSuccess("swap_tool");

    await registry.execute("wallet_tool", { op: "balance" }, "u");
    await registry.execute("swap_tool", { from: "XLM" }, "u");

    const calls = registry.getCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0].toolName).toBe("wallet_tool");
    expect(calls[1].toolName).toBe("swap_tool");
  });

  it("resets call history without removing mocks", async () => {
    registry.mockSuccess("wallet_tool");
    await registry.execute("wallet_tool", {}, "u");

    registry.resetCalls();

    expect(registry.getCalls()).toHaveLength(0);

    // Mock still works after reset
    const result = await registry.execute("wallet_tool", {}, "u");
    expect(result.status).toBe("success");
  });

  it("enforces maxToolCalls limit", async () => {
    const limited = new MockToolRegistry({ maxToolCalls: 2 });
    limited.mockSuccess("tool_a");

    await limited.execute("tool_a", {}, "u");
    await limited.execute("tool_a", {}, "u");

    await expect(limited.execute("tool_a", {}, "u")).rejects.toThrow(
      "max tool calls (2) exceeded"
    );
  });

  it("builds a valid ToolDefinition from a mock", async () => {
    registry.mockSuccess("my_tool", { result: 42 });

    const toolDef = registry.buildMockTool("my_tool", {
      description: "A test tool",
      category: "test",
    });

    expect(toolDef.metadata.name).toBe("my_tool");
    expect(toolDef.metadata.category).toBe("test");

    const result = await toolDef.execute({}, "u");
    expect(result.status).toBe("success");
    expect((result.data as Record<string, unknown>).result).toBe(42);
  });
});

// ─── AgentSandbox – executor-level tests ─────────────────────────────────────

describe("AgentSandbox – executePlan", () => {
  let sandbox: AgentSandbox;

  beforeEach(() => {
    sandbox = new AgentSandbox({ userId: "test-user" });
  });

  it("executes a single-step plan with a success mock", async () => {
    sandbox.mockSuccess("wallet_tool", { balance: "500 XLM" });

    const plan = buildPlan([
      { action: "wallet_tool", payload: { operation: "get_balance" } },
    ]);
    const { executionResult, assertions } = await sandbox.executePlan(plan);

    expect(executionResult.status).toBe("success");
    expect(executionResult.completedSteps).toBe(1);
    expect(assertions.toolWasCalled("wallet_tool")).toBe(true);
    expect(assertions.toolCallCount("wallet_tool")).toBe(1);
  });

  it("executes a multi-step plan and records all calls", async () => {
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

    const { assertions } = await sandbox.executePlan(plan);

    expect(assertions.toolCallCount("wallet_tool")).toBe(1);
    expect(assertions.toolCallCount("swap_tool")).toBe(1);
    expect(assertions.calledBefore("wallet_tool", "swap_tool")).toBe(true);
  });

  it("records call payloads correctly", async () => {
    sandbox.mockSuccess("swap_tool");

    const plan = buildPlan([
      { action: "swap_tool", payload: { from: "XLM", to: "USDC", amount: 50 } },
    ]);

    const { assertions } = await sandbox.executePlan(plan);

    const call = assertions.getNthCall("swap_tool", 0);
    expect(call).toBeDefined();
    expect(call!.payload).toMatchObject({
      from: "XLM",
      to: "USDC",
      amount: 50,
    });
  });

  it("handles a failing tool step", async () => {
    sandbox.mockError("swap_tool", "Slippage too high");

    const plan = buildPlan([
      { action: "swap_tool", payload: { from: "XLM", to: "USDC" } },
    ]);

    const { executionResult, assertions } = await sandbox.executePlan(plan);

    expect(assertions.toolWasCalled("swap_tool")).toBe(true);
    // The mock returns a ToolResult with status "error" – the step itself
    // completes (no exception thrown), so executionResult records it as success
    // but the tool result carries the error status
    const call = assertions.getNthCall("swap_tool", 0);
    expect(call!.result.status).toBe("error");
    expect(call!.result.error).toBe("Slippage too high");
    expect(executionResult.completedSteps).toBe(1);
  });

  it("continues past errors when stopOnError is false", async () => {
    sandbox
      .mockError("wallet_tool", "Network error")
      .mockSuccess("swap_tool", { txHash: "0xdef" });

    const plan = buildPlan([
      { action: "wallet_tool" },
      { action: "swap_tool" },
    ]);

    const { executionResult, assertions } = await sandbox.executePlan(plan, {
      stopOnError: false,
    });

    expect(assertions.toolWasCalled("wallet_tool")).toBe(true);
    expect(assertions.toolWasCalled("swap_tool")).toBe(true);
    // Both steps complete (mock returns result, not exception)
    expect(executionResult.completedSteps).toBe(2);
    // Tool-level error is captured in the call record
    expect(assertions.getNthCall("wallet_tool", 0)!.result.status).toBe(
      "error"
    );
    expect(assertions.getNthCall("swap_tool", 0)!.result.status).toBe(
      "success"
    );
  });

  it("preserves a snapshot of the plan before execution", async () => {
    sandbox.mockSuccess("wallet_tool");

    const plan = buildPlan([{ action: "wallet_tool" }]);
    const { planSnapshot } = await sandbox.executePlan(plan);

    expect(planSnapshot.planId).toBe(plan.planId);
    expect(planSnapshot.totalSteps).toBe(1);
  });

  it("resets call history between runs", async () => {
    sandbox.mockSuccess("wallet_tool");

    const plan = buildPlan([{ action: "wallet_tool" }]);

    await sandbox.executePlan(plan);
    const { assertions } = await sandbox.executePlan(plan);

    // Second run should only see its own calls
    expect(assertions.toolCallCount("wallet_tool")).toBe(1);
  });

  it("returns all calls in order via allCalls()", async () => {
    sandbox
      .mockSuccess("wallet_tool")
      .mockSuccess("swap_tool")
      .mockSuccess("wallet_tool");

    const plan = buildPlan([
      { action: "wallet_tool" },
      { action: "swap_tool" },
      { action: "wallet_tool" },
    ]);

    const { assertions } = await sandbox.executePlan(plan);

    const all = assertions.allCalls();
    expect(all.map((c) => c.toolName)).toEqual([
      "wallet_tool",
      "swap_tool",
      "wallet_tool",
    ]);
  });
});

// ─── AgentSandbox – planner-level tests ──────────────────────────────────────

describe("AgentSandbox – plan()", () => {
  let sandbox: AgentSandbox;

  beforeEach(() => {
    sandbox = new AgentSandbox();
    sandbox.mockSuccess("wallet_tool", {}).mockSuccess("swap_tool");
  });

  it("returns a plan with at least one step for a balance check", async () => {
    const plan = await sandbox.plan("Check my XLM balance");

    expect(plan.planId).toMatch(/^plan_/);
    expect(plan.totalSteps).toBeGreaterThan(0);
    expect(plan.steps.length).toBe(plan.totalSteps);
  });

  it("returns a plan with a valid riskLevel", async () => {
    const plan = await sandbox.plan("Swap 100 XLM to USDC");

    expect(["low", "medium", "high"]).toContain(plan.riskLevel);
  });

  it("respects maxSteps constraint", async () => {
    const plan = await sandbox.plan("Do many operations", {
      constraints: { maxSteps: 2 },
    });

    expect(plan.totalSteps).toBeLessThanOrEqual(2);
  });

  it("includes step descriptions", async () => {
    const plan = await sandbox.plan("Check my balance");

    plan.steps.forEach((step) => {
      expect(typeof step.description).toBe("string");
      expect(step.description.length).toBeGreaterThan(0);
    });
  });

  it("numbers steps sequentially starting at 1", async () => {
    const plan = await sandbox.plan("Check balance and swap");

    plan.steps.forEach((step, idx) => {
      expect(step.stepNumber).toBe(idx + 1);
    });
  });
});

// ─── AgentSandbox – full run() integration ───────────────────────────────────

describe("AgentSandbox – run()", () => {
  let sandbox: AgentSandbox;

  beforeEach(() => {
    sandbox = new AgentSandbox({ userId: "integration-user" });
    // The mocked LLM always returns a wallet_tool step
    sandbox.mockSuccess("wallet_tool", { balance: "1000 XLM" });
  });

  it("runs plan-and-execute end-to-end", async () => {
    const { executionResult, assertions } = await sandbox.run(
      "Check my XLM balance"
    );

    expect(executionResult.status).toMatch(/success|partial/);
    expect(assertions.allCalls().length).toBeGreaterThan(0);
  });

  it("exposes the plan snapshot", async () => {
    const { planSnapshot } = await sandbox.run("Check balance");

    expect(planSnapshot.planId).toMatch(/^plan_/);
    expect(planSnapshot.steps.length).toBeGreaterThan(0);
  });

  it("reports the sandbox userId", async () => {
    const { sandboxUserId } = await sandbox.run("Check balance");

    expect(sandboxUserId).toBe("integration-user");
  });

  it("resets calls between successive run() calls", async () => {
    await sandbox.run("Check balance");
    const { assertions } = await sandbox.run("Check balance");

    const total = assertions.allCalls().length;
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(20);
  });
});

// ─── AgentSandbox – assertion helpers ────────────────────────────────────────

describe("SandboxAssertions", () => {
  let sandbox: AgentSandbox;

  beforeEach(() => {
    sandbox = new AgentSandbox();
    sandbox
      .mockSuccess("tool_a", { step: "a" })
      .mockSuccess("tool_b", { step: "b" })
      .mockSuccess("tool_c", { step: "c" });
  });

  it("calledBefore returns true for correct order", async () => {
    const plan = buildPlan([
      { action: "tool_a" },
      { action: "tool_b" },
      { action: "tool_c" },
    ]);

    const { assertions } = await sandbox.executePlan(plan);

    expect(assertions.calledBefore("tool_a", "tool_b")).toBe(true);
    expect(assertions.calledBefore("tool_a", "tool_c")).toBe(true);
    expect(assertions.calledBefore("tool_b", "tool_c")).toBe(true);
  });

  it("calledBefore returns false for wrong order", async () => {
    const plan = buildPlan([{ action: "tool_a" }, { action: "tool_b" }]);

    const { assertions } = await sandbox.executePlan(plan);

    expect(assertions.calledBefore("tool_b", "tool_a")).toBe(false);
  });

  it("calledBefore returns false when a tool was never called", async () => {
    const plan = buildPlan([{ action: "tool_a" }]);

    const { assertions } = await sandbox.executePlan(plan);

    expect(assertions.calledBefore("tool_a", "tool_b")).toBe(false);
    expect(assertions.calledBefore("tool_b", "tool_a")).toBe(false);
  });

  it("getNthCall returns the correct call", async () => {
    sandbox.mockSuccess("tool_a");

    const plan = buildPlan([
      { action: "tool_a", payload: { n: 1 } },
      { action: "tool_b" },
      { action: "tool_a", payload: { n: 2 } },
    ]);

    const { assertions } = await sandbox.executePlan(plan);

    const first = assertions.getNthCall("tool_a", 0);
    const second = assertions.getNthCall("tool_a", 1);

    expect((first!.payload as Record<string, unknown>).n).toBe(1);
    expect((second!.payload as Record<string, unknown>).n).toBe(2);
  });

  it("getNthCall returns undefined for out-of-range index", async () => {
    const plan = buildPlan([{ action: "tool_a" }]);

    const { assertions } = await sandbox.executePlan(plan);

    expect(assertions.getNthCall("tool_a", 5)).toBeUndefined();
  });

  it("getCallsFor returns only calls for the specified tool", async () => {
    const plan = buildPlan([
      { action: "tool_a" },
      { action: "tool_b" },
      { action: "tool_a" },
    ]);

    const { assertions } = await sandbox.executePlan(plan);

    const aCalls = assertions.getCallsFor("tool_a");
    expect(aCalls).toHaveLength(2);
    aCalls.forEach((c) => expect(c.toolName).toBe("tool_a"));
  });
});

// ─── AgentSandbox – configuration options ────────────────────────────────────

describe("AgentSandbox – configuration", () => {
  it("uses custom userId in tool calls", async () => {
    const sandbox = new AgentSandbox({ userId: "custom-user-42" });
    sandbox.mockSuccess("wallet_tool");

    const plan = buildPlan([{ action: "wallet_tool" }]);
    const { toolCalls, sandboxUserId } = await sandbox.executePlan(plan);

    expect(sandboxUserId).toBe("custom-user-42");
    expect(toolCalls[0].userId).toBe("custom-user-42");
  });

  it("applies globalDelayMs to all tool calls", async () => {
    const sandbox = new AgentSandbox({ globalDelayMs: 50 });
    sandbox.mockSuccess("wallet_tool");

    const plan = buildPlan([{ action: "wallet_tool" }]);

    const start = Date.now();
    await sandbox.executePlan(plan);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it("clear() removes all mocks and history", async () => {
    const sandbox = new AgentSandbox({ allowUnmocked: false });
    sandbox.mockSuccess("wallet_tool");

    const plan = buildPlan([{ action: "wallet_tool" }]);
    await sandbox.executePlan(plan);

    sandbox.clear();

    // After clear, the mock is gone
    await expect(
      sandbox.getMockRegistry().execute("wallet_tool", {}, "u")
    ).rejects.toThrow("no mock registered");
  });
});
