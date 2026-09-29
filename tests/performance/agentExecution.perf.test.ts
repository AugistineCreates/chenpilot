import { PlanExecutor } from "../../src/Agents/planner/PlanExecutor";
import { ExecutionPlan } from "../../src/Agents/planner/AgentPlanner";
import { toolRegistry } from "../../src/Agents/registry/ToolRegistry";
import { policyEnforcer } from "../../src/Agents/policy/PolicyEnforcer";
import { performanceTestRunner } from "./utils/PerformanceTestRunner";
import {
  PERFORMANCE_BASELINES,
  PERFORMANCE_TEST_CONFIG,
} from "./config/performanceBaselines";
import { trendRecorder } from "./utils/TrendRecorder";

jest.mock("../../src/Agents/registry/ToolRegistry");
jest.mock("../../src/Agents/policy/PolicyEnforcer");
jest.mock("../../src/config/logger");

describe("Agent Execution Flow Benchmarks & Regression Budgets", () => {
  let planExecutor: PlanExecutor;

  beforeAll(() => {
    planExecutor = new PlanExecutor();
    performanceTestRunner.clear();

    // Default policy enforcement mock: always allowed
    (policyEnforcer.enforce as jest.Mock) = jest.fn().mockResolvedValue({
      allowed: true,
      reason: "Allowed for performance test",
    });
  });

  afterAll(() => {
    const report = performanceTestRunner.generateReport();
    console.log("\n" + report);
    trendRecorder.saveReport(performanceTestRunner.getResults());
  });

  describe("Single Step Execution", () => {
    it("should execute single step plan within regression budgets", async () => {
      (toolRegistry.executeTool as jest.Mock) = jest.fn().mockResolvedValue({
        action: "get_balance",
        status: "success",
        data: { balance: 1000 },
      });

      const plan: ExecutionPlan = {
        planId: "test-plan-1",
        steps: [
          {
            stepNumber: 1,
            action: "get_balance",
            payload: { asset: "XLM" },
            description: "Get XLM balance",
          },
        ],
        totalSteps: 1,
        estimatedDuration: 3000,
        riskLevel: "low",
        requiresApproval: false,
        summary: "Get balance",
      };

      const result = await performanceTestRunner.runTest(
        "Execution: Single Step Execution",
        async () => {
          await planExecutor.executePlan(plan, "bench-user", {
            durable: false,
          });
        },
        {
          iterations: PERFORMANCE_TEST_CONFIG.defaultIterations,
          warmupIterations: PERFORMANCE_TEST_CONFIG.warmupIterations,
          threshold: PERFORMANCE_BASELINES.agentExecution.singleStep,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.p95).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.agentExecution.singleStep.p95!
      );
    });

    it("should handle error execution paths within budget", async () => {
      (toolRegistry.executeTool as jest.Mock) = jest
        .fn()
        .mockRejectedValue(new Error("Tool failed"));

      const plan: ExecutionPlan = {
        planId: "test-plan-error",
        steps: [
          {
            stepNumber: 1,
            action: "failing_tool",
            payload: {},
            description: "Failing tool",
          },
        ],
        totalSteps: 1,
        estimatedDuration: 3000,
        riskLevel: "low",
        requiresApproval: false,
        summary: "Error handling test",
      };

      const result = await performanceTestRunner.runTest(
        "Execution: Error Handling Path",
        async () => {
          await planExecutor.executePlan(plan, "bench-user", {
            durable: false,
          });
        },
        {
          iterations: PERFORMANCE_TEST_CONFIG.defaultIterations,
          warmupIterations: PERFORMANCE_TEST_CONFIG.warmupIterations,
          threshold: PERFORMANCE_BASELINES.agentExecution.errorHandling,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.p95).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.agentExecution.errorHandling.p95!
      );
    });
  });

  describe("Multi-Step Execution Flow", () => {
    it("should execute multi-step plan within regression budgets", async () => {
      (toolRegistry.executeTool as jest.Mock) = jest.fn().mockResolvedValue({
        action: "test_action",
        status: "success",
        data: { ok: true },
      });

      const plan: ExecutionPlan = {
        planId: "test-plan-multi",
        steps: [
          {
            stepNumber: 1,
            action: "get_balance",
            payload: { asset: "XLM" },
            description: "Get balance",
          },
          {
            stepNumber: 2,
            action: "swap_tool",
            payload: { from: "XLM", to: "USDC", amount: 100 },
            description: "Swap tokens",
          },
          {
            stepNumber: 3,
            action: "transfer",
            payload: { to: "recipient", amount: 50, asset: "USDC" },
            description: "Transfer tokens",
          },
        ],
        totalSteps: 3,
        estimatedDuration: 9000,
        riskLevel: "medium",
        requiresApproval: false,
        summary: "Multi-step workflow",
      };

      const result = await performanceTestRunner.runTest(
        "Execution: Multi-Step Execution (3 steps)",
        async () => {
          await planExecutor.executePlan(plan, "bench-user", {
            durable: false,
          });
        },
        {
          iterations: PERFORMANCE_TEST_CONFIG.defaultIterations,
          warmupIterations: PERFORMANCE_TEST_CONFIG.warmupIterations,
          threshold: PERFORMANCE_BASELINES.agentExecution.multiStep,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.p95).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.agentExecution.multiStep.p95!
      );
    });

    it("should process dry-run executions with minimal overhead", async () => {
      const plan: ExecutionPlan = {
        planId: "test-plan-dryrun",
        steps: Array.from({ length: 5 }, (_, i) => ({
          stepNumber: i + 1,
          action: `action_${i + 1}`,
          payload: { index: i },
          description: `Action ${i + 1}`,
        })),
        totalSteps: 5,
        estimatedDuration: 15000,
        riskLevel: "medium",
        requiresApproval: false,
        summary: "Dry run test",
      };

      const result = await performanceTestRunner.runTest(
        "Execution: Dry Run Flow (5 steps)",
        async () => {
          await planExecutor.executePlan(plan, "bench-user", {
            dryRun: true,
            durable: false,
          });
        },
        {
          iterations: 25,
          warmupIterations: 3,
          threshold: PERFORMANCE_BASELINES.agentExecution.dryRun,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.p95).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.agentExecution.dryRun.p95!
      );
    });
  });

  describe("Memory & Resource Efficiency", () => {
    it("should maintain steady memory profile across repeated executions", async () => {
      (toolRegistry.executeTool as jest.Mock) = jest.fn().mockResolvedValue({
        action: "test_action",
        status: "success",
        data: { ok: true },
      });

      const plan: ExecutionPlan = {
        planId: "memory-test-plan",
        steps: [
          {
            stepNumber: 1,
            action: "test_action",
            payload: {},
            description: "Test action",
          },
        ],
        totalSteps: 1,
        estimatedDuration: 3000,
        riskLevel: "low",
        requiresApproval: false,
        summary: "Memory test",
      };

      const initialMemory = process.memoryUsage().heapUsed;

      for (let i = 0; i < 50; i++) {
        await planExecutor.executePlan(plan, `bench-user-${i}`, {
          durable: false,
        });
      }

      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncreaseMB = (finalMemory - initialMemory) / 1024 / 1024;

      expect(memoryIncreaseMB).toBeLessThan(25);
    });
  });
});
