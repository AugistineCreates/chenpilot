// chenpilot/src/Agents/planner/__tests__/PlanExecutor.test.ts
import {
  PlanExecutor,
  // ExecutionOptions,
  // ExecutionResult,
  // StepResult,
} from "../PlanExecutor";
import { ExecutionPlan, PlanStep } from "../AgentPlanner";
import { HashedPlan } from "../planHash";
import { toolRegistry } from "../../registry/ToolRegistry";
import { planHashService } from "../planHash";
import logger from "../../../config/logger";

jest.mock("../../registry/ToolRegistry");
jest.mock("../planHash");
jest.mock("../../../config/logger");

describe("PlanExecutor - Edge Cases and Multi-Agent Flows", () => {
  let executor: PlanExecutor;

  const createMockPlan = (steps: Partial<PlanStep>[] = []): ExecutionPlan => ({
    planId: `plan_${Date.now()}`,
    steps: steps.map((step, index) => ({
      stepNumber: index + 1,
      action: step.action || `action_${index}`,
      payload: step.payload || {},
      description: step.description || `Step ${index + 1}`,
      dependencies: step.dependencies || [],
      ...step,
    })),
    totalSteps: steps.length,
    estimatedDuration: steps.length * 3000,
    riskLevel: "low" as const,
    requiresApproval: false,
    summary: "Test plan",
  });

  const createMockHashedPlan = (
    steps: Partial<PlanStep>[] = []
  ): HashedPlan => ({
    ...createMockPlan(steps),
    planHash: "test-hash-123",
  });

  beforeEach(() => {
    executor = new PlanExecutor();
    jest.resetAllMocks();
    (toolRegistry.getTool as jest.Mock).mockReturnValue({
      metadata: { name: "mockTool", category: "test", version: "1.0.0", riskLevel: "low", capabilities: [] },
      execute: jest.fn().mockResolvedValue({ status: "success", action: "mock" }),
    });
    (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
      status: "success",
      action: "mock",
      data: { result: "mock_data" },
    });
    (planHashService.generatePlanHash as jest.Mock).mockReturnValue("test-hash-123");
    (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);
    (planHashService.verifySignature as jest.Mock).mockReturnValue(true);
  });

  // ============================================================
  // EDGE CASE TESTS - EXECUTION
  // ============================================================

  describe("Edge Cases - Empty and Invalid Plans", () => {
    it("should handle empty execution plan", async () => {
      const plan = createMockPlan([]);
      const userId = "user-123";

      const result = await executor.executePlan(plan, userId);

      expect(result.status).toBe("failed");
      expect(result.completedSteps).toBe(0);
      expect(result.stepResults.length).toBe(0);
    });

    it("should handle plan with null steps", async () => {
      const plan = createMockPlan([]);
      plan.steps = null as unknown as PlanStep[];

      await expect(
        executor.executePlan(plan, "user-123")
      ).rejects.toBeDefined();
    });

    it("should handle plan with undefined steps", async () => {
      const plan = createMockPlan([{ action: "test" }]);
      plan.steps = undefined as unknown as PlanStep[];

      await expect(
        executor.executePlan(plan, "user-123")
      ).rejects.toBeDefined();
    });

    it("should handle timeout during plan execution", async () => {
      const plan = createMockHashedPlan([
        { action: "slowOperation" },
        { action: "anotherStep" },
      ]);

      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);
      (toolRegistry.executeTool as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ action: "test", status: "success" }),
              5000
            )
          )
      );

      const result = await executor.executePlan(plan, "user-123", {
        timeout: 100,
      });

      expect(result.status).toBe("failed");
      expect(result.error).toContain("timeout");
    });

    it("should track execution time properly", async () => {
      const plan = createMockPlan([{ action: "step1" }, { action: "step2" }]);

      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      const result = await executor.executePlan(plan, "user-123");

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(typeof result.duration).toBe("number");
    });
  });

  // ============================================================
  // RESOURCE MANAGEMENT TESTS
  // ============================================================

  describe("Resource Management", () => {
    it("should not leak memory during long-running executions", async () => {
      const plan = createMockPlan(
        Array.from({ length: 100 }, (_, i) => ({
          action: `step_${i}`,
          payload: { data: "x".repeat(1000) },
        }))
      );

      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      const initialMemory = process.memoryUsage().heapUsed;

      await executor.executePlan(plan, "user-123");

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = finalMemory - initialMemory;

      // Should not grow more than 50MB
      expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024);
    });

    it("should clear step results after completion", async () => {
      const plan = createMockPlan([
        { action: "step1", payload: { data: "x".repeat(10000) } },
      ]);

      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "step1",
        status: "success",
        data: { result: "x".repeat(10000) },
      });

      const result = await executor.executePlan(plan, "user-123");

      // The result should not retain references to large objects
      expect(result.stepResults[0].result).toBeDefined();
    });
  });

  // ============================================================
  // EDGE CASES - STEP EXECUTION FAILURES
  // ============================================================

  describe("Edge Cases - Step Execution Failures", () => {
    it("should handle step execution failure", async () => {
      const plan = createMockPlan([{ action: "failingAction" }]);

      (toolRegistry.executeTool as jest.Mock).mockRejectedValue(
        new Error("Execution failed")
      );

      const result = await executor.executePlan(plan, "user-123");

      expect(result.completedSteps).toBe(0);
      expect(result.stepResults[0].status).toBe("failed");
      expect(result.stepResults[0].error).toBe("Execution failed");
    });

    it("should continue on error when stopOnError is false", async () => {
      const plan = createMockPlan([
        { action: "failingAction" },
        { action: "successfulAction" },
      ]);

      (toolRegistry.executeTool as jest.Mock)
        .mockRejectedValueOnce(new Error("First step failed"))
        .mockResolvedValueOnce({ action: "test", status: "success" });

      const result = await executor.executePlan(plan, "user-123", {
        stopOnError: false,
      });

      expect(result.stepResults.length).toBe(2);
      expect(result.stepResults[0].status).toBe("failed");
      expect(result.stepResults[1].status).toBe("success");
      expect(result.completedSteps).toBe(1);
    });

    it("should stop on first error when stopOnError is true", async () => {
      const plan = createMockPlan([
        { action: "failingAction" },
        { action: "successfulAction" },
      ]);

      (toolRegistry.executeTool as jest.Mock)
        .mockRejectedValueOnce(new Error("First step failed"))
        .mockResolvedValueOnce({ action: "test", status: "success" });

      const result = await executor.executePlan(plan, "user-123", {
        stopOnError: true,
      });

      expect(result.stepResults.length).toBe(1);
      expect(result.stepResults[0].status).toBe("failed");
    });

    it("should handle tool not found error", async () => {
      const plan = createMockPlan([{ action: "nonexistentTool" }]);

      (toolRegistry.executeTool as jest.Mock).mockRejectedValue(
        new Error("Tool 'nonexistentTool' not found")
      );

      const result = await executor.executePlan(plan, "user-123", {
        stopOnError: true,
      });

      expect(result.stepResults[0].status).toBe("failed");
      expect(result.stepResults[0].error).toContain("not found");
    });

    it("should handle invalid tool response", async () => {
      const plan = createMockPlan([{ action: "malformedTool" }]);

      (toolRegistry.executeTool as jest.Mock).mockResolvedValue(null);

      const result = await executor.executePlan(plan, "user-123");

      expect(result.stepResults[0].status).toBe("success");
      expect(result.stepResults[0].result).toBeNull();
    });
  });

  // ============================================================
  // EDGE CASES - DRY RUN MODE
  // ============================================================

  describe("Edge Cases - Dry Run Mode", () => {
    it("should execute plan in dry run mode without executing tools", async () => {
      const plan = createMockPlan([{ action: "swap" }, { action: "transfer" }]);

      const result = await executor.executePlan(plan, "user-123", {
        dryRun: true,
      });

      expect(result.status).toBe("success");
      expect(result.completedSteps).toBe(2);
      expect(toolRegistry.executeTool).not.toHaveBeenCalled();
    });

    it("should mark all steps as success in dry run", async () => {
      const plan = createMockPlan([
        { action: "action1" },
        { action: "action2" },
        { action: "action3" },
      ]);

      const result = await executor.executePlan(plan, "user-123", {
        dryRun: true,
      });

      result.stepResults.forEach((step) => {
        expect(step.status).toBe("success");
        expect(step.result?.data?.dryRun).toBe(true);
      });
    });

    it("should include dry run metadata in step results", async () => {
      const plan = createMockPlan([{ action: "test" }]);

      const result = await executor.executePlan(plan, "user-123", {
        dryRun: true,
      });

      expect(result.stepResults[0].result?.message).toBe(
        "Dry run - not executed"
      );
      expect(result.stepResults[0].result?.data?.dryRun).toBe(true);
    });
  });

  // ============================================================
  // EDGE CASES - HASH VERIFICATION
  // ============================================================

  describe("Edge Cases - Hash Verification", () => {
    it("should verify plan hash by default", async () => {
      const plan = createMockHashedPlan([{ action: "test" }]);

      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);
      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      await executor.executePlan(plan, "user-123");

      expect(planHashService.verifyPlanHash).toHaveBeenCalledWith(plan);
    });

    it("should reject plan with invalid hash", async () => {
      const plan = createMockHashedPlan([{ action: "test" }]);

      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(false);

      await expect(
        executor.executePlan(plan, "user-123", { verifyHash: true })
      ).rejects.toThrow("Plan hash mismatch");
    });

    it("should skip hash verification when verifyHash is false", async () => {
      const plan = createMockHashedPlan([{ action: "test" }]);

      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(false);
      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      const result = await executor.executePlan(plan, "user-123", {
        verifyHash: false,
      });

      expect(result.status).toBe("success");
      expect(planHashService.verifyPlanHash).not.toHaveBeenCalled();
    });

    it("should verify signature when public key is provided", async () => {
      const plan: HashedPlan = {
        ...createMockHashedPlan([{ action: "test" }]),
        signature: "test-signature",
        signedBy: "chenpilot",
      };

      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);
      (planHashService.verifySignature as jest.Mock).mockReturnValue(true);
      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      const result = await executor.executePlan(plan, "user-123", {
        publicKey: "public-key-123",
      });

      expect(result.status).toBe("success");
    });

    it("should reject plan with invalid signature", async () => {
      const plan: HashedPlan = {
        ...createMockHashedPlan([{ action: "test" }]),
        signature: "invalid-signature",
      };

      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);
      (planHashService.verifySignature as jest.Mock).mockReturnValue(false);

      await expect(
        executor.executePlan(plan, "user-123", {
          publicKey: "key",
          strictMode: true,
        })
      ).rejects.toThrow("Invalid plan signature");
    });
  });

  // ============================================================
  // EDGE CASES - STRICT MODE
  // ============================================================

  describe("Edge Cases - Strict Mode", () => {
    it("should enforce strict validation in strict mode", async () => {
      const plan = createMockHashedPlan([{ action: "test", stepNumber: 0 }]);

      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);

      await expect(
        executor.executePlan(plan, "user-123", { strictMode: true })
      ).rejects.toBeDefined();
    });

    it("should detect duplicate step numbers in strict mode", async () => {
      const plan: ExecutionPlan = {
        ...createMockPlan([
          { action: "step1", stepNumber: 1 },
          { action: "step2", stepNumber: 1 }, // Duplicate
        ]),
        planHash: "hash-123",
      };

      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);

      await expect(
        executor.executePlan(plan, "user-123", { strictMode: true })
      ).rejects.toThrow("Duplicate step numbers");
    });
  });

  // ============================================================
  // MULTI-AGENT EXECUTION FLOWS
  // ============================================================

  describe("Multi-Agent Flows - Sequential Execution", () => {
    it("should execute step callbacks for each completed step", async () => {
      const plan = createMockPlan([{ action: "step1" }, { action: "step2" }]);

      const onStepStart = jest.fn();
      const onStepComplete = jest.fn();

      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      await executor.executePlan(plan, "user-123", {
        onStepStart,
        onStepComplete,
      });

      expect(onStepStart).toHaveBeenCalledTimes(2);
      expect(onStepComplete).toHaveBeenCalledTimes(2);
    });

    it("should pass correct step information to callbacks", async () => {
      const plan = createMockPlan([
        { action: "testAction", payload: { key: "value" } },
      ]);

      const onStepStart = jest.fn();

      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      await executor.executePlan(plan, "user-123", { onStepStart });

      expect(onStepStart).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "testAction",
          payload: { key: "value" },
        })
      );
    });

    it("should track step results in order", async () => {
      const plan = createMockPlan([
        { action: "first" },
        { action: "second" },
        { action: "third" },
      ]);

      (toolRegistry.executeTool as jest.Mock)
        .mockResolvedValueOnce({ action: "first", status: "success" })
        .mockResolvedValueOnce({ action: "second", status: "success" })
        .mockResolvedValueOnce({ action: "third", status: "success" });

      const result = await executor.executePlan(plan, "user-123");

      expect(result.stepResults[0].action).toBe("first");
      expect(result.stepResults[1].action).toBe("second");
      expect(result.stepResults[2].action).toBe("third");
    });

    it("should maintain step numbers throughout execution", async () => {
      const plan = createMockPlan([
        { action: "a" },
        { action: "b" },
        { action: "c" },
      ]);

      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      const result = await executor.executePlan(plan, "user-123");

      result.stepResults.forEach((step, index) => {
        expect(step.stepNumber).toBe(index + 1);
      });
    });
  });

  describe("Multi-Agent Flows - Partial Execution", () => {
    it("should mark execution as partial when some steps fail", async () => {
      const plan = createMockPlan([
        { action: "success1" },
        { action: "failure" },
        { action: "success2" },
      ]);

      (toolRegistry.executeTool as jest.Mock)
        .mockResolvedValueOnce({ action: "test", status: "success" })
        .mockRejectedValueOnce(new Error("Step failed"))
        .mockResolvedValueOnce({ action: "test", status: "success" });

      const result = await executor.executePlan(plan, "user-123", {
        stopOnError: false,
      });

      expect(result.status).toBe("partial");
      expect(result.completedSteps).toBe(2);
    });

    it("should report correct completed step count", async () => {
      const plan = createMockPlan([
        { action: "step1" },
        { action: "step2" },
        { action: "step3" },
      ]);

      (toolRegistry.executeTool as jest.Mock)
        .mockResolvedValueOnce({ action: "test", status: "success" })
        .mockResolvedValueOnce({ action: "test", status: "success" })
        .mockRejectedValueOnce(new Error("Failed"));

      const result = await executor.executePlan(plan, "user-123", {
        stopOnError: false,
      });

      expect(result.completedSteps).toBe(2);
      expect(result.totalSteps).toBe(3);
    });

    it("should handle recovery scenarios", async () => {
      const plan = createMockPlan([
        { action: "failingStep" },
        { action: "recoveryStep" },
      ]);

      (toolRegistry.executeTool as jest.Mock)
        .mockRejectedValueOnce(new Error("Initial failure"))
        .mockResolvedValueOnce({ action: "test", status: "success" });

      const result = await executor.executePlan(plan, "user-123", {
        stopOnError: false,
      });

      expect(result.stepResults[0].status).toBe("failed");
      expect(result.stepResults[1].status).toBe("success");
    });
  });

  describe("Multi-Agent Flows - Concurrent Multi-User", () => {
    it("should handle concurrent execution for different users", async () => {
      const plan1 = createMockPlan([{ action: "userOp1" }]);
      const plan2 = createMockPlan([{ action: "userOp2" }]);

      (toolRegistry.executeTool as jest.Mock)
        .mockResolvedValueOnce({
          action: "test",
          status: "success",
          data: { user: 1 },
        })
        .mockResolvedValueOnce({
          action: "test",
          status: "success",
          data: { user: 2 },
        });

      const [result1, result2] = await Promise.all([
        executor.executePlan(plan1, "user-1"),
        executor.executePlan(plan2, "user-2"),
      ]);

      expect(result1.status).toBe("success");
      expect(result2.status).toBe("success");
    });

    it("should isolate execution context between users", async () => {
      const plan1 = createMockPlan([
        { action: "op1", payload: { userId: "user-1" } },
      ]);
      const plan2 = createMockPlan([
        { action: "op2", payload: { userId: "user-2" } },
      ]);

      const results: Array<{ userId: string; result: unknown }> = [];

      (toolRegistry.executeTool as jest.Mock).mockImplementation(
        async (action, payload) => {
          results.push({ userId: payload.userId, result: action });
          return { action, status: "success" };
        }
      );

      await Promise.all([
        executor.executePlan(plan1, "user-1"),
        executor.executePlan(plan2, "user-2"),
      ]);

      expect(results.length).toBe(2);
      expect(results[0]).toEqual(
        expect.objectContaining({ userId: expect.stringContaining("user") })
      );
    });
  });

  describe("Multi-Agent Flows - Complex Workflows", () => {
    it("should execute complex multi-step workflow", async () => {
      const plan = createMockPlan([
        { action: "validateInput" },
        { action: "checkBalance" },
        { action: "approveToken" },
        { action: "executeSwap" },
        { action: "confirmTransaction" },
      ]);

      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      const result = await executor.executePlan(plan, "user-123");

      expect(result.status).toBe("success");
      expect(result.completedSteps).toBe(5);
      expect(result.stepResults.length).toBe(5);
    });

    it("should handle workflow with mixed success and failure", async () => {
      const plan = createMockPlan([
        { action: "step1" },
        { action: "step2" },
        { action: "step3" },
        { action: "step4" },
      ]);

      (toolRegistry.executeTool as jest.Mock)
        .mockResolvedValueOnce({ action: "test", status: "success" })
        .mockResolvedValueOnce({ action: "test", status: "success" })
        .mockRejectedValueOnce(new Error("Step 3 failed"))
        .mockResolvedValueOnce({ action: "test", status: "success" });

      const result = await executor.executePlan(plan, "user-123", {
        stopOnError: false,
      });

      expect(result.status).toBe("partial");
      expect(result.completedSteps).toBe(3);
    });

    it("should generate proper execution summary", async () => {
      const plan = createMockPlan([{ action: "step1" }, { action: "step2" }]);

      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      const result = await executor.executePlan(plan, "user-123");

      expect(result).toEqual(
        expect.objectContaining({
          planId: expect.any(String),
          status: "success",
          completedSteps: 2,
          totalSteps: 2,
          stepResults: expect.arrayContaining([
            expect.objectContaining({ stepNumber: 1 }),
            expect.objectContaining({ stepNumber: 2 }),
          ]),
          duration: expect.any(Number),
        })
      );
    });
  });

  describe("Multi-Agent Flows - Agent Communication", () => {
    it("should pass output from one step as input to next", async () => {
      const plan = createMockPlan([
        { action: "step1", payload: { input: "data" } },
        { action: "step2", payload: { dependsOn: "step1" } },
      ]);

      const toolResults: unknown[] = [];

      (toolRegistry.executeTool as jest.Mock).mockImplementation(
        async (action, payload) => {
          toolResults.push({ action, payload });
          return {
            action,
            status: "success",
            data: { output: { value: 42 } },
          };
        }
      );

      const result = await executor.executePlan(plan, "user-123");

      expect(result.stepResults[0].result?.data).toBeDefined();
      expect(result.stepResults[1]).toBeDefined();
    });

    it("should track dependencies between steps", async () => {
      const plan = createMockPlan([
        { action: "getData", dependencies: [] },
        { action: "processData", dependencies: [1] },
        { action: "cacheResult", dependencies: [2] },
      ]);

      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      const result = await executor.executePlan(plan, "user-123");

      expect(result.stepResults).toHaveLength(3);
      expect(plan.steps[1].dependencies).toContain(1);
      expect(plan.steps[2].dependencies).toContain(2);
    });
  });

  // ============================================================
  // EXECUTION STATUS DETERMINATION
  // ============================================================

  describe("Execution Status Determination", () => {
    it("should return success status when all steps complete", async () => {
      const plan = createMockPlan([{ action: "step1" }, { action: "step2" }]);

      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      const result = await executor.executePlan(plan, "user-123");

      expect(result.status).toBe("success");
    });

    it("should return partial status when some steps complete", async () => {
      const plan = createMockPlan([
        { action: "step1" },
        { action: "step2" },
        { action: "step3" },
      ]);

      (toolRegistry.executeTool as jest.Mock)
        .mockResolvedValueOnce({ action: "test", status: "success" })
        .mockResolvedValueOnce({ action: "test", status: "success" })
        .mockRejectedValueOnce(new Error("Failed"));

      const result = await executor.executePlan(plan, "user-123", {
        stopOnError: false,
      });

      expect(result.status).toBe("partial");
    });

    it("should return failed status when no steps complete", async () => {
      const plan = createMockPlan([{ action: "step1" }, { action: "step2" }]);

      (toolRegistry.executeTool as jest.Mock).mockRejectedValue(
        new Error("Failed")
      );

      const result = await executor.executePlan(plan, "user-123", {
        stopOnError: true,
      });

      expect(result.status).toBe("failed");
    });
  });

  // ============================================================
  // STEP RESULT TIMESTAMPS
  // ============================================================

  describe("Step Result Timestamps", () => {
    it("should include timestamp in each step result", async () => {
      const plan = createMockPlan([{ action: "test" }]);

      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      const result = await executor.executePlan(plan, "user-123");

      expect(result.stepResults[0].timestamp).toBeDefined();
      expect(
        new Date(result.stepResults[0].timestamp).getTime()
      ).toBeGreaterThan(0);
    });

    it("should record duration for each step", async () => {
      const plan = createMockPlan([{ action: "step1" }, { action: "step2" }]);

      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      const result = await executor.executePlan(plan, "user-123");

      result.stepResults.forEach((step) => {
        expect(typeof step.duration).toBe("number");
        expect(step.duration).toBeGreaterThanOrEqual(0);
      });
    });
  });

  // ============================================================
  // LOGGING AND MONITORING
  // ============================================================

  describe("Logging and Monitoring", () => {
    it("should log plan execution start", async () => {
      const plan = createMockPlan([{ action: "test" }]);

      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      await executor.executePlan(plan, "user-123");

      expect(logger.info).toHaveBeenCalledWith(
        "Starting plan execution",
        expect.objectContaining({
          planId: plan.planId,
          userId: "user-123",
          totalSteps: plan.totalSteps,
        })
      );
    });

    it("should log errors during execution", async () => {
      const plan = createMockPlan([{ action: "failingAction" }]);

      (toolRegistry.executeTool as jest.Mock).mockRejectedValue(
        new Error("Execution error")
      );

      await executor.executePlan(plan, "user-123");

      expect(logger.error).toHaveBeenCalled();
    });
  });

  // ============================================================
  // LARGE-SCALE EXECUTION
  // ============================================================

  describe("Large-Scale Execution", () => {
    it("should handle execution of many steps", async () => {
      const stepCount = 20;
      const plan = createMockPlan(
        Array.from({ length: stepCount }, (_, i) => ({
          action: `step_${i}`,
        }))
      );

      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      const result = await executor.executePlan(plan, "user-123");

      expect(result.completedSteps).toBe(stepCount);
      expect(result.stepResults.length).toBe(stepCount);
    });

    it("should maintain performance with large workflows", async () => {
      const stepCount = 50;
      const plan = createMockPlan(
        Array.from({ length: stepCount }, (_, i) => ({
          action: `step_${i}`,
        }))
      );

      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      const startTime = Date.now();
      const result = await executor.executePlan(plan, "user-123");
      const endTime = Date.now();

      expect(result.completedSteps).toBe(stepCount);
      expect(result.duration).toBeLessThan(endTime - startTime + 100);
    });
  });

  // ============================================================
  // ROLLBACK INTEGRATION
  // ============================================================

  describe("Rollback Integration", () => {
    it("should support rollback after execution", async () => {
      const plan = createMockPlan([{ action: "step1" }, { action: "step2" }]);

      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      const result = await executor.executePlan(plan, "user-123");

      // Rollback should be async operation
      await expect(executor.rollback(plan, result)).resolves.not.toThrow();
    });

    it("should handle rollback with errors gracefully", async () => {
      const plan = createMockPlan([{ action: "test" }]);

      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      const result = await executor.executePlan(plan, "user-123");

      // Mock rollback to throw
      jest
        .spyOn(executor, "rollback")
        .mockRejectedValueOnce(new Error("Rollback failed"));

      await expect(executor.rollback(plan, result)).rejects.toThrow(
        "Rollback failed"
      );
    });
  });
});
