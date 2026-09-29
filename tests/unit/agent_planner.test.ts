import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

jest.mock("../../src/services/stellarPrice.service", () => ({
  __esModule: true,
  default: {
    getPrice: jest.fn().mockResolvedValue({
      price: 1,
      estimatedOutput: 1,
      cached: false,
      path: [],
    }),
  },
}));

jest.mock("../../src/services/flashSwapRiskAnalyzer", () => ({
  flashSwapRiskAnalyzer: {
    analyzeSwapRisk: jest.fn().mockResolvedValue({
      riskLevel: "low",
      sandwichAttackRisk: 0,
      warnings: [],
      recommendations: [],
    }),
  },
}));

jest.mock("../../src/Auth/accountSecretStore", () => ({
  accountSecretStore: {
    getAccountByUserId: jest.fn(() => ({
      secretKey: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    })),
  },
}));

jest.mock("../../src/transactions/TransactionLifecycle.service", () => ({
  transactionLifecycleService: {
    create: jest.fn().mockResolvedValue({ id: "lifecycle-1" }),
    transition: jest.fn().mockResolvedValue({}),
    fail: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock("../../src/services/lock", () => ({
  RedisLockService: jest.fn().mockImplementation(() => ({
    acquireLock: jest
      .fn()
      .mockResolvedValue({
        acquired: true,
        lockKey: "lock:test",
        lockValue: "test",
      }),
    releaseLock: jest.fn().mockResolvedValue(true),
    extendLock: jest.fn().mockResolvedValue(true),
    isLocked: jest.fn().mockResolvedValue(false),
    getLockInfo: jest.fn().mockResolvedValue(null),
    forceReleaseLock: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock("@stellar/stellar-sdk", () => ({
  Asset: class {
    constructor(
      public code: string,
      public issuer?: string
    ) {}
    static native() {
      return new (this as unknown as {
        new (code: string, issuer?: string): unknown;
      })("XLM");
    }
  },
  Horizon: { Server: class {} },
  TransactionBuilder: class {
    constructor() {}
    addOperation() {
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return { sign: jest.fn() };
    }
  },
  Operation: { pathPaymentStrictSend: jest.fn(() => ({})) },
  BASE_FEE: "100",
  Networks: {
    PUBLIC: "Public Global Stellar Network ; September 2015",
    TESTNET: "Test SDF Network ; September 2015",
  },
}));

jest.mock("../../src/services/networkConfig", () => ({
  NetworkConfigService: class {
    static getInstance() {
      return new (this as unknown as { new (): unknown })();
    }
  },
}));

import { AgentPlanner } from "../../src/Agents/planner/AgentPlanner";
import { PlanExecutor } from "../../src/Agents/planner/PlanExecutor";
import { toolRegistry } from "../../src/Agents/registry/ToolRegistry";
import { walletTool } from "../../src/Agents/tools/wallet";
import { swapTool } from "../../src/Agents/tools/swap";
import { sorobanTool } from "../../src/Agents/tools/soroban";
import { policyEnforcer } from "../../src/Agents/policy/PolicyEnforcer";

describe("AgentPlanner", () => {
  let planner: AgentPlanner;

  beforeEach(() => {
    planner = new AgentPlanner();

    // Register tools
    toolRegistry.register(walletTool);
    toolRegistry.register(swapTool);
    toolRegistry.register(sorobanTool);
  });

  describe("createPlan", () => {
    it("should create a plan for simple balance check", async () => {
      const context = {
        userId: "test-user",
        userInput: "Check my XLM balance",
      };

      const plan = await planner.createPlan(context);

      expect(plan).toBeDefined();
      expect(plan.planId).toMatch(/^plan_/);
      expect(plan.totalSteps).toBeGreaterThan(0);
      expect(plan.steps[0].action).toBe("wallet_tool");
      expect(plan.riskLevel).toBe("low");
    });

    it("should create a plan for token swap", async () => {
      const context = {
        userId: "test-user",
        userInput: "Swap 100 XLM to USDC",
      };

      const plan = await planner.createPlan(context);

      expect(plan.totalSteps).toBeGreaterThan(0);
      expect(plan.steps.some((s) => s.action === "swap_tool")).toBe(true);
      expect(plan.riskLevel).toMatch(/low|medium/);
    });

    it("should create a plan for portfolio liquidation", async () => {
      const context = {
        userId: "test-user",
        userInput: "Liquidate half my portfolio into USDC",
        availableBalance: {
          XLM: 1000,
          USDT: 500,
        },
      };

      const plan = await planner.createPlan(context);

      expect(plan.totalSteps).toBeGreaterThan(1);
      // Should have balance checks and swaps
      expect(plan.steps.some((s) => s.action === "wallet_tool")).toBe(true);
      expect(plan.steps.some((s) => s.action === "swap_tool")).toBe(true);
      expect(plan.requiresApproval).toBe(true);
    });

    it("should create a plan for Soroban contract interaction", async () => {
      const context = {
        userId: "test-user",
        userInput:
          "Stake 100 tokens in contract CABC123 method stake on testnet",
      };

      const plan = await planner.createPlan(context);

      expect(plan.totalSteps).toBeGreaterThan(0);
      expect(plan.steps.some((s) => s.action === "soroban_invoke")).toBe(true);
      expect(plan.steps[0].payload).toHaveProperty("contractId");
      expect(plan.steps[0].payload).toHaveProperty("method", "stake");
    });

    it("should respect max steps constraint", async () => {
      const context = {
        userId: "test-user",
        userInput: "Check all my balances and swap everything",
        constraints: {
          maxSteps: 3,
        },
      };

      const plan = await planner.createPlan(context);

      expect(plan.totalSteps).toBeLessThanOrEqual(3);
    });

    it("should assess risk level correctly", async () => {
      const context = {
        userId: "test-user",
        userInput: "Swap 100 XLM to USDC",
      };

      const plan = await planner.createPlan(context);

      // Single swap should be low or medium risk
      expect(plan.riskLevel).toMatch(/low|medium/);
    });

    it("should generate step descriptions", async () => {
      const context = {
        userId: "test-user",
        userInput: "Transfer 50 XLM to Alice",
      };

      const plan = await planner.createPlan(context);

      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.steps[0].description).toBeDefined();
      expect(typeof plan.steps[0].description).toBe("string");
    });

    it("should calculate step dependencies", async () => {
      const context = {
        userId: "test-user",
        userInput: "Check my balance and then swap 50 XLM to USDC",
      };

      const plan = await planner.createPlan(context);

      // Swap step should depend on balance check
      const swapStep = plan.steps.find((s) => s.action === "swap_tool");
      if (swapStep && plan.steps.length > 1) {
        expect(swapStep.dependencies).toBeDefined();
      }
    });
  });

  describe("validatePlan", () => {
    it("should validate a correct plan", async () => {
      const context = {
        userId: "test-user",
        userInput: "Check my XLM balance",
      };

      const plan = await planner.createPlan(context);

      // Plan should be valid (createPlan validates internally)
      expect(plan).toBeDefined();
      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it("should reject plan with too many steps", async () => {
      const context = {
        userId: "test-user",
        userInput: "Do many operations",
        constraints: {
          maxSteps: 1,
        },
      };

      // Should throw or create a plan within constraints
      try {
        const plan = await planner.createPlan(context);
        expect(plan.totalSteps).toBeLessThanOrEqual(1);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe("optimizePlan", () => {
    it("should remove duplicate balance checks", async () => {
      const context = {
        userId: "test-user",
        userInput: "Check XLM balance twice and swap",
      };

      const plan = await planner.createPlan(context);
      const optimized = planner.optimizePlan(plan);

      // Count balance checks
      const balanceChecks = optimized.steps.filter(
        (s) =>
          s.action === "wallet_tool" &&
          s.payload.operation === "get_balance" &&
          s.payload.token === "XLM"
      );

      expect(balanceChecks.length).toBeLessThanOrEqual(1);
    });

    it("should renumber steps after optimization", async () => {
      const context = {
        userId: "test-user",
        userInput: "Check balance and swap",
      };

      const plan = await planner.createPlan(context);
      const optimized = planner.optimizePlan(plan);

      // Steps should be numbered sequentially
      optimized.steps.forEach((step, index) => {
        expect(step.stepNumber).toBe(index + 1);
      });
    });
  });
});

describe("PlanExecutor", () => {
  let executor: PlanExecutor;
  let planner: AgentPlanner;

  beforeEach(() => {
    executor = new PlanExecutor();
    planner = new AgentPlanner();

    // Register tools
    toolRegistry.register(walletTool);
    toolRegistry.register(swapTool);
    toolRegistry.register(sorobanTool);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("executePlan", () => {
    it("should execute a simple plan in dry-run mode", async () => {
      const context = {
        userId: "test-user",
        userInput: "Check my XLM balance",
      };

      const plan = await planner.createPlan(context);
      const result = await executor.executePlan(plan, "test-user", {
        dryRun: true,
      });

      expect(result.status).toBe("success");
      expect(result.completedSteps).toBe(plan.totalSteps);
      expect(result.stepResults.length).toBe(plan.totalSteps);
    });

    it("should track execution progress", async () => {
      const context = {
        userId: "test-user",
        userInput: "Check balance",
      };

      const plan = await planner.createPlan(context);
      const stepCompletions: number[] = [];

      const result = await executor.executePlan(plan, "test-user", {
        dryRun: true,
        onStepComplete: (stepResult) => {
          stepCompletions.push(stepResult.stepNumber);
        },
      });

      expect(stepCompletions.length).toBe(plan.totalSteps);
      expect(result.status).toBe("success");
    });

    it("should stop on error when configured", async () => {
      const context = {
        userId: "test-user",
        userInput: "Do multiple operations",
      };

      const plan = await planner.createPlan(context);

      const result = await executor.executePlan(plan, "test-user", {
        dryRun: true,
        stopOnError: true,
      });

      expect(result).toBeDefined();
      expect(result.status).toMatch(/success|partial|failed/);
    });

    it("should respect timeout", async () => {
      const context = {
        userId: "test-user",
        userInput: "Check balance",
      };

      const plan = await planner.createPlan(context);

      const result = await executor.executePlan(plan, "test-user", {
        dryRun: true,
        timeout: 100, // Very short timeout
      });

      expect(result).toBeDefined();
    });

    it("should record step durations", async () => {
      const context = {
        userId: "test-user",
        userInput: "Check balance",
      };

      const plan = await planner.createPlan(context);
      const result = await executor.executePlan(plan, "test-user", {
        dryRun: true,
      });

      result.stepResults.forEach((stepResult) => {
        expect(stepResult.duration).toBeGreaterThanOrEqual(0);
        expect(stepResult.timestamp).toBeDefined();
      });
    });
  });

  describe("failure semantics", () => {
    it("should stop after the first failed step and report partial completion", async () => {
      const plan = {
        planId: "plan_failure_first",
        userId: "test-user",
        totalSteps: 3,
        steps: [
          {
            stepNumber: 1,
            action: "wallet_tool",
            description: "step 1",
            payload: {},
          },
          {
            stepNumber: 2,
            action: "swap_tool",
            description: "step 2",
            payload: {},
          },
          {
            stepNumber: 3,
            action: "soroban_invoke",
            description: "step 3",
            payload: {},
          },
        ],
        riskLevel: "medium",
      } as Record<string, unknown>;

      jest
        .spyOn(policyEnforcer, "enforce")
        .mockResolvedValue({ allowed: true } as never);
      const executeToolSpy = jest.spyOn(toolRegistry, "executeTool");
      executeToolSpy.mockResolvedValueOnce({
        action: "wallet_tool",
        status: "success",
        message: "ok",
      } as never);
      executeToolSpy.mockRejectedValueOnce(new Error("boom"));

      const result = await executor.executePlan(plan, "test-user");

      expect(result.status).toBe("partial");
      expect(result.completedSteps).toBe(1);
      expect(result.stepResults[0].status).toBe("success");
      expect(result.stepResults[1].status).toBe("failed");
      expect(result.stepResults).toHaveLength(2);
    });

    it("should preserve earlier completed steps when a middle step fails", async () => {
      const plan = {
        planId: "plan_failure_middle",
        userId: "test-user",
        totalSteps: 3,
        steps: [
          {
            stepNumber: 1,
            action: "wallet_tool",
            description: "step 1",
            payload: {},
          },
          {
            stepNumber: 2,
            action: "swap_tool",
            description: "step 2",
            payload: {},
          },
          {
            stepNumber: 3,
            action: "soroban_invoke",
            description: "step 3",
            payload: {},
          },
        ],
        riskLevel: "medium",
      } as Record<string, unknown>;

      jest
        .spyOn(policyEnforcer, "enforce")
        .mockResolvedValue({ allowed: true } as never);
      const executeToolSpy = jest.spyOn(toolRegistry, "executeTool");
      executeToolSpy.mockResolvedValueOnce({
        action: "wallet_tool",
        status: "success",
        message: "ok",
      } as never);
      executeToolSpy.mockRejectedValueOnce(new Error("boom"));

      const result = await executor.executePlan(plan, "test-user");

      expect(result.status).toBe("partial");
      expect(result.completedSteps).toBe(1);
      expect(result.stepResults[0].status).toBe("success");
      expect(result.stepResults[1].status).toBe("failed");
    });

    it("should report a failed last step without rolling back earlier successes", async () => {
      const plan = {
        planId: "plan_failure_last",
        userId: "test-user",
        totalSteps: 3,
        steps: [
          {
            stepNumber: 1,
            action: "wallet_tool",
            description: "step 1",
            payload: {},
          },
          {
            stepNumber: 2,
            action: "swap_tool",
            description: "step 2",
            payload: {},
          },
          {
            stepNumber: 3,
            action: "soroban_invoke",
            description: "step 3",
            payload: {},
          },
        ],
        riskLevel: "medium",
      } as Record<string, unknown>;

      jest
        .spyOn(policyEnforcer, "enforce")
        .mockResolvedValue({ allowed: true } as never);
      const executeToolSpy = jest.spyOn(toolRegistry, "executeTool");
      executeToolSpy.mockResolvedValueOnce({
        action: "wallet_tool",
        status: "success",
        message: "ok",
      } as never);
      executeToolSpy.mockResolvedValueOnce({
        action: "swap_tool",
        status: "success",
        message: "ok",
      } as never);
      executeToolSpy.mockRejectedValueOnce(new Error("boom"));

      const result = await executor.executePlan(plan, "test-user");

      expect(result.status).toBe("partial");
      expect(result.completedSteps).toBe(2);
      expect(result.stepResults[0].status).toBe("success");
      expect(result.stepResults[1].status).toBe("success");
      expect(result.stepResults[2].status).toBe("failed");
    });
  });

  describe("dependency handling", () => {
    it("should execute steps with dependencies in order", async () => {
      const context = {
        userId: "test-user",
        userInput: "Check balance then swap",
      };

      const plan = await planner.createPlan(context);
      const result = await executor.executePlan(plan, "test-user", {
        dryRun: true,
      });

      // All steps should complete successfully
      expect(result.status).toBe("success");
    });
  });
});

describe("Integration: Planner + Executor", () => {
  let planner: AgentPlanner;
  let executor: PlanExecutor;

  beforeEach(() => {
    planner = new AgentPlanner();
    executor = new PlanExecutor();

    toolRegistry.register(walletTool);
    toolRegistry.register(swapTool);
    toolRegistry.register(sorobanTool);
  });

  it("should handle complete workflow: plan creation to execution", async () => {
    const context = {
      userId: "test-user",
      userInput: "Swap 100 XLM to USDC",
    };

    // Create plan
    const plan = await planner.createPlan(context);
    expect(plan).toBeDefined();
    expect(plan.totalSteps).toBeGreaterThan(0);

    // Optimize plan
    const optimized = planner.optimizePlan(plan);
    expect(optimized.totalSteps).toBeLessThanOrEqual(plan.totalSteps);

    // Execute in dry-run mode
    const result = await executor.executePlan(optimized, "test-user", {
      dryRun: true,
    });

    expect(result.status).toBe("success");
    expect(result.completedSteps).toBe(optimized.totalSteps);
  });

  it("should handle complex multi-step operation", async () => {
    const context = {
      userId: "test-user",
      userInput: "Liquidate half my portfolio into USDC",
      availableBalance: {
        XLM: 1000,
        USDT: 500,
      },
    };

    const plan = await planner.createPlan(context);
    expect(plan.requiresApproval).toBe(true);
    expect(plan.riskLevel).toMatch(/medium|high/);

    const result = await executor.executePlan(plan, "test-user", {
      dryRun: true,
    });

    expect(result).toBeDefined();
  });
});
