// chenpilot/src/Agents/planner/__tests__/AgentPlanner.integration.test.ts
import {
  AgentPlanner,
  PlannerContext,
  ExecutionPlan,
  // PlanStep,
} from "../AgentPlanner";
import { PlanExecutor } from "../PlanExecutor";
import { HashedPlan, planHashService } from "../planHash";
import { agentLLM } from "../../agent";
import { toolRegistry } from "../../registry/ToolRegistry";
import { RiskLevel } from "../../admin/workflow.types";

jest.mock("../../agent");
jest.mock("../../registry/ToolRegistry");
jest.mock("../planHash");
jest.mock("../../../config/logger");

describe("AgentPlanner + PlanExecutor Integration - Multi-Agent Flows", () => {
  let planner: AgentPlanner;
  let executor: PlanExecutor;

  beforeEach(() => {
    planner = new AgentPlanner();
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
    (planHashService.generatePlanHash as jest.Mock).mockReturnValue("plan-hash-123");
    (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);
    (planHashService.verifySignature as jest.Mock).mockReturnValue(true);
  });

  // ============================================================
  // INTEGRATION TEST SCENARIOS
  // ============================================================

  describe("Planning and Execution Integration", () => {
    it("should create and execute a complete plan flow", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "swap ETH for DAI",
      };

      const workflow = [
        { action: "swap", payload: { from: "ETH", to: "DAI", amount: 100 } },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([
        { name: "swap", description: "Swap tokens" },
      ]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "plan-hash-123"
      );

      // Create plan
      const plan = await planner.createPlan(context);

      expect(plan).toBeDefined();
      expect(plan.steps.length).toBe(1);

      // Execute plan
      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "swap",
        status: "success",
        data: { amount: 100, token: "DAI" },
      });
      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);

      const result = await executor.executePlan(plan, context.userId);

      expect(result.status).toBe("success");
      expect(result.completedSteps).toBe(1);
    });

    it("should execute multi-step plan created by planner", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "swap tokens and transfer proceeds",
      };

      const workflow = [
        { action: "swap", payload: { from: "ETH", to: "DAI" } },
        { action: "transfer", payload: { to: "0xABC", amount: 100 } },
        { action: "confirmTransaction", payload: {} },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([
        { name: "swap", description: "Swap" },
        { name: "transfer", description: "Transfer" },
        { name: "confirmTransaction", description: "Confirm" },
      ]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue("hash");

      const plan = await planner.createPlan(context);

      expect(plan.totalSteps).toBe(3);
      expect(plan.steps[0].stepNumber).toBe(1);
      expect(plan.steps[1].stepNumber).toBe(2);
      expect(plan.steps[2].stepNumber).toBe(3);

      (toolRegistry.executeTool as jest.Mock)
        .mockResolvedValueOnce({ action: "swap", status: "success" })
        .mockResolvedValueOnce({ action: "transfer", status: "success" })
        .mockResolvedValueOnce({
          action: "confirmTransaction",
          status: "success",
        });
      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);

      const result = await executor.executePlan(plan, context.userId);

      expect(result.status).toBe("success");
      expect(result.completedSteps).toBe(3);
      expect(toolRegistry.executeTool).toHaveBeenCalledTimes(3);
    });

    it("should handle plan creation and execution with user preferences", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "low risk swap",
        userPreferences: {
          riskLevel: RiskLevel.LOW,
          preferredAssets: ["ETH", "DAI"],
          autoApproveSmallTransactions: true,
          smallTransactionThreshold: 100,
          defaultSlippage: 0.5,
        },
      };

      const workflow = [
        { action: "swap", payload: { slippage: 0.5, from: "ETH", to: "DAI" } },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([
        { name: "swap", description: "Swap" },
      ]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue("hash");
      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);

      const plan = await planner.createPlan(context);

      expect(plan.riskLevel).toBe("low");

      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "swap",
        status: "success",
      });

      const result = await executor.executePlan(plan, context.userId, {
        verifyHash: true,
      });

      expect(result.status).toBe("success");
    });
  });

  describe("Multi-Agent Orchestration", () => {
    it("should orchestrate sequential agents in workflow", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "validate input, then execute trade, then confirm",
      };

      const workflow = [
        { action: "validateInput", payload: { input: "data" } },
        { action: "executeTrade", payload: { amount: 100 } },
        { action: "confirmTrade", payload: {} },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue("hash");
      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);

      const plan = await planner.createPlan(context);

      const executionCallOrder: string[] = [];

      (toolRegistry.executeTool as jest.Mock).mockImplementation(
        async (action) => {
          executionCallOrder.push(action);
          return { action, status: "success" };
        }
      );

      const result = await executor.executePlan(plan, context.userId);

      expect(executionCallOrder).toEqual([
        "validateInput",
        "executeTrade",
        "confirmTrade",
      ]);
      expect(result.status).toBe("success");
    });

    it("should handle multi-agent workflow with dependencies", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "complex defi operation",
      };

      const workflow = [
        { action: "checkBalance", payload: {} },
        { action: "approveToken", payload: {} },
        { action: "executeSwap", payload: {} },
        { action: "stakeRewards", payload: {} },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue("hash");
      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);

      const plan = await planner.createPlan(context);

      const stepDetails: Array<{
        stepNumber: number;
        action: string;
      }> = [];

      (toolRegistry.executeTool as jest.Mock).mockImplementation(
        async (action) => {
          const stepNum = stepDetails.length + 1;
          stepDetails.push({ stepNumber: stepNum, action });
          return { action, status: "success" };
        }
      );

      const result = await executor.executePlan(plan, context.userId, {
        onStepStart: (step) => {
          expect(step.stepNumber).toBeGreaterThan(0);
        },
        onStepComplete: (stepResult) => {
          expect(stepResult.status).toBe("success");
        },
      });

      expect(result.status).toBe("success");
      expect(stepDetails.length).toBe(4);
    });

    it("should handle multiple independent agents in parallel flow", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "check multiple balances in parallel",
      };

      const workflow = [
        { action: "getBalance", payload: { token: "ETH" } },
        { action: "getBalance", payload: { token: "DAI" } },
        { action: "getBalance", payload: { token: "USDC" } },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue("hash");
      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);

      const plan = await planner.createPlan(context);

      const balanceChecks: string[] = [];

      (toolRegistry.executeTool as jest.Mock).mockImplementation(
        async (action, payload) => {
          balanceChecks.push(
            (payload as Record<string, unknown>).token as string
          );
          return { action, status: "success", data: { balance: 100 } };
        }
      );

      const result = await executor.executePlan(plan, context.userId);

      expect(result.status).toBe("success");
      expect(balanceChecks).toContain("ETH");
      expect(balanceChecks).toContain("DAI");
      expect(balanceChecks).toContain("USDC");
    });
  });

  describe("Multi-User Concurrent Workflows", () => {
    it("should handle concurrent planning for multiple users", async () => {
      const contexts = [
        { userId: "user-1", userInput: "operation-1" },
        { userId: "user-2", userInput: "operation-2" },
        { userId: "user-3", userInput: "operation-3" },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);

      let callCount = 0;
      (agentLLM.callLLM as jest.Mock).mockImplementation(async () => {
        callCount++;
        return {
          workflow: [{ action: `action-${callCount}`, payload: {} }],
        };
      });

      (planHashService.generatePlanHash as jest.Mock).mockImplementation(
        () => `hash-${Math.random()}`
      );

      const plans = await Promise.all(
        contexts.map((ctx) => planner.createPlan(ctx))
      );

      expect(plans).toHaveLength(3);
      plans.forEach((plan, index) => {
        expect(plan.steps[0].action).toBe(`action-${index + 1}`);
      });
    });

    it("should execute concurrent plans for multiple users", async () => {
      const userId1 = "user-1";
      const userId2 = "user-2";

      const plan1: ExecutionPlan = {
        planId: "plan-1",
        steps: [
          {
            stepNumber: 1,
            action: "user1Action",
            payload: {},
            description: "User 1 action",
            dependencies: [],
          },
        ],
        totalSteps: 1,
        estimatedDuration: 3000,
        riskLevel: "low",
        requiresApproval: false,
        summary: "User 1 plan",
      };

      const plan2: ExecutionPlan = {
        planId: "plan-2",
        steps: [
          {
            stepNumber: 1,
            action: "user2Action",
            payload: {},
            description: "User 2 action",
            dependencies: [],
          },
        ],
        totalSteps: 1,
        estimatedDuration: 3000,
        riskLevel: "low",
        requiresApproval: false,
        summary: "User 2 plan",
      };

      const executedActions: Array<{
        userId: string;
        action: string;
      }> = [];

      (toolRegistry.executeTool as jest.Mock).mockImplementation(
        async (action) => {
          executedActions.push({ userId: "tracked", action });
          return { action, status: "success" };
        }
      );
      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);

      const [result1, result2] = await Promise.all([
        executor.executePlan(plan1, userId1),
        executor.executePlan(plan2, userId2),
      ]);

      expect(result1.status).toBe("success");
      expect(result2.status).toBe("success");
      expect(executedActions.length).toBe(2);
    });

    it("should maintain user context isolation throughout flow", async () => {
      const contexts = [
        {
          userId: "user-1",
          userInput: "op1",
          userPreferences: {
            riskLevel: RiskLevel.LOW,
            preferredAssets: ["ETH"],
            autoApproveSmallTransactions: false,
            smallTransactionThreshold: 100,
            defaultSlippage: 0.5,
          },
        },
        {
          userId: "user-2",
          userInput: "op2",
          userPreferences: {
            riskLevel: RiskLevel.HIGH,
            preferredAssets: ["DAI", "USDC"],
            autoApproveSmallTransactions: true,
            smallTransactionThreshold: 5000,
            defaultSlippage: 2.0,
          },
        },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock)
        .mockResolvedValueOnce({
          workflow: [
            {
              action: "lowRiskOperation",
              payload: { slippage: 0.5 },
            },
          ],
        })
        .mockResolvedValueOnce({
          workflow: [
            {
              action: "highRiskOperation",
              payload: { slippage: 2.0 },
            },
          ],
        });

      (planHashService.generatePlanHash as jest.Mock).mockReturnValue("hash");
      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);

      const [plan1, plan2] = await Promise.all(
        contexts.map((ctx) => planner.createPlan(ctx))
      );

      expect(plan1.riskLevel).toBe("low");
      expect(plan2.riskLevel).toBe("low");

      (toolRegistry.executeTool as jest.Mock)
        .mockResolvedValueOnce({
          action: "lowRiskOperation",
          status: "success",
        })
        .mockResolvedValueOnce({
          action: "highRiskOperation",
          status: "success",
        });

      const [result1, result2] = await Promise.all([
        executor.executePlan(plan1, "user-1"),
        executor.executePlan(plan2, "user-2"),
      ]);

      expect(result1.status).toBe("success");
      expect(result2.status).toBe("success");
    });
  });

  describe("Complex Workflow Scenarios", () => {
    it("should handle complete DeFi transaction workflow", async () => {
      const context: PlannerContext = {
        userId: "trader-1",
        userInput:
          "swap 100 ETH for DAI, then provide liquidity, then stake rewards",
        userPreferences: {
          riskLevel: RiskLevel.MEDIUM,
          preferredAssets: ["ETH", "DAI"],
          autoApproveSmallTransactions: false,
          smallTransactionThreshold: 100,
          defaultSlippage: 1.0,
        },
      };

      const workflow = [
        { action: "checkBalance", payload: { token: "ETH" } },
        { action: "approveToken", payload: { token: "DAI", amount: 500000 } },
        {
          action: "swapTokens",
          payload: { from: "ETH", to: "DAI", amount: 100 },
        },
        {
          action: "provideLiquidity",
          payload: { tokens: ["DAI", "USDC"], amounts: [50000, 50000] },
        },
        { action: "stakeLP", payload: { amount: 100000 } },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "defi-plan-hash"
      );
      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);

      const plan = await planner.createPlan(context);

      expect(plan.totalSteps).toBe(5);
      expect(plan.riskLevel).toBe("high");
      expect(plan.requiresApproval).toBe(true);

      const stepExecutionOrder: string[] = [];

      (toolRegistry.executeTool as jest.Mock).mockImplementation(
        async (action) => {
          stepExecutionOrder.push(action);
          return { action, status: "success", data: { executed: true } };
        }
      );

      const result = await executor.executePlan(plan, context.userId, {
        stopOnError: false,
      });

      expect(result.status).toBe("success");
      expect(result.completedSteps).toBe(5);
      expect(stepExecutionOrder).toEqual([
        "checkBalance",
        "approveToken",
        "swapTokens",
        "provideLiquidity",
        "stakeLP",
      ]);
    });

    it("should handle workflow with error recovery scenarios", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "safe swap with fallback",
      };

      const workflow = [
        { action: "validateSwap", payload: {} },
        { action: "executeSwap", payload: {} },
        { action: "rollbackIfFailed", payload: {} },
        { action: "confirmFinal", payload: {} },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue("hash");
      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);

      const plan = await planner.createPlan(context);

      (toolRegistry.executeTool as jest.Mock)
        .mockResolvedValueOnce({ action: "validateSwap", status: "success" })
        .mockRejectedValueOnce(new Error("Swap execution failed"))
        .mockResolvedValueOnce({
          action: "rollbackIfFailed",
          status: "success",
        })
        .mockResolvedValueOnce({ action: "confirmFinal", status: "success" });

      const result = await executor.executePlan(plan, context.userId, {
        stopOnError: false,
      });

      expect(result.status).toBe("partial");
      expect(result.completedSteps).toBe(3);
    });

    it("should handle large multi-step workflow efficiently", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "large batch operation",
      };

      const stepCount = 15;
      const workflow = Array.from({ length: stepCount }, (_, i) => ({
        action: `step_${i + 1}`,
        payload: { index: i + 1 },
      }));

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue("hash");
      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);

      const plan = await planner.createPlan(context);

      expect(plan.totalSteps).toBe(stepCount);
      expect(plan.estimatedDuration).toBe(stepCount * 3000);

      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      const startTime = Date.now();
      const result = await executor.executePlan(plan, context.userId);
      const endTime = Date.now();

      expect(result.status).toBe("success");
      expect(result.completedSteps).toBe(stepCount);
      expect(endTime - startTime).toBeLessThan(30000); // Should complete in reasonable time
    });
  });

  describe("Plan Verification and Integrity", () => {
    it("should verify plan integrity end-to-end", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "signed transaction",
      };

      const workflow = [
        { action: "executeTransaction", payload: { amount: 100 } },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "final-hash"
      );

      // Simulate signing
      process.env.PLAN_SIGNING_KEY = "test-key";
      (planHashService.signPlanHash as jest.Mock).mockReturnValue(
        "signature-123"
      );

      const plan = await planner.createPlan(context);

      expect(plan.planHash).toBe("final-hash");
      expect(plan.signature).toBe("signature-123");

      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);
      (planHashService.verifySignature as jest.Mock).mockReturnValue(true);
      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "executeTransaction",
        status: "success",
      });

      const result = await executor.executePlan(plan, context.userId, {
        publicKey: "public-key-123",
        verifyHash: true,
      });

      expect(result.status).toBe("success");

      delete process.env.PLAN_SIGNING_KEY;
    });

    it("should reject tampered plans during execution", async () => {
      const plan: HashedPlan = {
        planId: "plan-123",
        steps: [
          {
            stepNumber: 1,
            action: "test",
            payload: {},
            description: "Test",
            dependencies: [],
          },
        ],
        totalSteps: 1,
        estimatedDuration: 3000,
        riskLevel: "low",
        requiresApproval: false,
        summary: "Test",
        planHash: "original-hash",
      };

      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(false);

      await expect(
        executor.executePlan(plan, "user-123", {
          verifyHash: true,
          strictMode: true,
        })
      ).rejects.toThrow("plan hash mismatch");
    });
  });

  describe("Callbacks and Monitoring", () => {
    it("should invoke callbacks throughout execution", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "monitored operation",
      };

      const workflow = [
        { action: "step1", payload: {} },
        { action: "step2", payload: {} },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue("hash");
      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);

      const plan = await planner.createPlan(context);

      const events: Array<{
        type: "start" | "complete";
        step: number;
      }> = [];

      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      await executor.executePlan(plan, context.userId, {
        onStepStart: (step) => {
          events.push({ type: "start", step: step.stepNumber });
        },
        onStepComplete: (result) => {
          events.push({ type: "complete", step: result.stepNumber });
        },
      });

      expect(events).toEqual([
        { type: "start", step: 1 },
        { type: "complete", step: 1 },
        { type: "start", step: 2 },
        { type: "complete", step: 2 },
      ]);
    });
  });

  describe("Dry Run Through Workflow", () => {
    it("should allow dry run planning and execution", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "test workflow",
      };

      const workflow = [
        { action: "expensiveOp", payload: { amount: 1000 } },
        { action: "riskySetting", payload: { enabled: true } },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue("hash");
      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);

      const plan = await planner.createPlan(context);

      expect(plan.totalSteps).toBe(2);

      const result = await executor.executePlan(plan, context.userId, {
        dryRun: true,
      });

      expect(result.status).toBe("success");
      expect(result.completedSteps).toBe(2);
      expect(toolRegistry.executeTool).not.toHaveBeenCalled();
    });
  });

  describe("Data Consistency in Integration", () => {
    it("should preserve numeric precision through planning and execution", async () => {
      const preciseAmount = "0.000000000000000001";

      const context: PlannerContext = {
        userId: "user-123",
        userInput: `transfer ${preciseAmount} ETH`,
      };

      const workflow = [
        {
          action: "transfer",
          payload: { amount: preciseAmount, token: "ETH" },
        },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue("hash");
      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);

      const plan = await planner.createPlan(context);

      expect(plan.steps[0].payload.amount).toBe(preciseAmount);

      let executedAmount: string | undefined;
      (toolRegistry.executeTool as jest.Mock).mockImplementation(
        async (action, payload) => {
          executedAmount = payload.amount;
          return { action, status: "success" };
        }
      );

      await executor.executePlan(plan, context.userId);

      expect(executedAmount).toBe(preciseAmount);
    });
  });

  describe("Performance Benchmarks Integration", () => {
    it("should handle complete planning and execution within time limits", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "complex trading operation",
      };

      const workflow = [
        { action: "checkBalance", payload: {} },
        { action: "approveToken", payload: {} },
        { action: "executeTrade", payload: {} },
        { action: "confirmTrade", payload: {} },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue("hash");
      (planHashService.verifyPlanHash as jest.Mock).mockReturnValue(true);
      (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
        action: "test",
        status: "success",
      });

      const startTime = Date.now();

      const plan = await planner.createPlan(context);
      const result = await executor.executePlan(plan, context.userId);

      const totalTime = Date.now() - startTime;

      expect(result.status).toBe("success");
      expect(totalTime).toBeLessThan(5000); // Complete within 5 seconds
    });
  });
});
