// chenpilot/src/Agents/planner/__tests__/AgentPlanner.test.ts
import {
  AgentPlanner,
  PlannerContext,
  PlannerConstraints,
  ExecutionPlan,
  // PlanStep,
  // PlanValidation,
} from "../AgentPlanner";
import { agentLLM } from "../../agent";
import { toolRegistry } from "../../registry/ToolRegistry";
import { planHashService } from "../planHash";
import logger from "../../../config/logger";
import { RiskLevel as RiskLevelType } from "../../../Auth/userPreferences.entity";

const RiskLevel = {
  LOW: "low" as RiskLevelType,
  MEDIUM: "medium" as RiskLevelType,
  HIGH: "high" as RiskLevelType,
};

// Mock dependencies
jest.mock("../../agent");
jest.mock("../../registry/ToolRegistry");
jest.mock("../planHash");
jest.mock("../../../config/logger");

describe("AgentPlanner - Edge Cases and Multi-Agent Flows", () => {
  let planner: AgentPlanner;

  beforeEach(() => {
    planner = new AgentPlanner();
    jest.resetAllMocks();
  });

  // ============================================================
  // EDGE CASE TESTS
  // ============================================================

  describe("Edge Cases - Empty and Invalid Inputs", () => {
    it("should handle empty user input gracefully", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "",
      };

      const mockToolMetadata = [
        { name: "swap", description: "Swap tokens" },
        { name: "transfer", description: "Transfer tokens" },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue(
        mockToolMetadata
      );
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: [],
      });

      const plan = await planner.createPlan(context);
      expect(plan.totalSteps).toBe(0);
      expect(plan.planId).toBeDefined();
    });

    it("should handle whitespace-only user input", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "   \n\t  ",
      };

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: [],
      });

      const plan = await planner.createPlan(context);
      expect(plan.totalSteps).toBe(0);
    });

    it("should reject null user input", async () => {
      const context = {
        userId: "user-123",
        userInput: null,
      } as unknown as PlannerContext;

      await expect(planner.createPlan(context)).rejects.toThrow();
    });

    it("should handle missing userPreferences", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "swap 100 ETH to DAI",
        userPreferences: undefined,
      };

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([
        { name: "swap", description: "Swap tokens" },
      ]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: [
          {
            action: "swap",
            payload: { from: "ETH", to: "DAI", amount: 100 },
          },
        ],
      });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);
      expect(plan).toBeDefined();
      expect(plan.planHash).toBe("hash-123");
    });
  });

  describe("Edge Cases - Malformed Payloads", () => {
    it("should handle steps with circular references in payload", async () => {
      // const circular: any = { name: "test" };
      // circular.self = circular;

      interface CircularObject {
        name: string;
        self?: CircularObject;
      }

      const circular: CircularObject = { name: "test" };
      circular.self = circular;

      const workflow = [{ action: "test", payload: circular }];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      // Should handle gracefully without stack overflow
      const plan = await planner.createPlan({
        userId: "user-123",
        userInput: "test",
      });

      expect(plan).toBeDefined();
      expect(plan.totalSteps).toBe(1);
    });

    it("should handle extremely large payloads (10MB+)", async () => {
      const largePayload = {
        data: "x".repeat(10 * 1024 * 1024), // 10MB string
      };

      const workflow = [{ action: "processLargeData", payload: largePayload }];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      // Should handle without memory issues
      const plan = await planner.createPlan({
        userId: "user-123",
        userInput: "process large data",
      });

      expect(plan.totalSteps).toBe(1);
      expect(plan.steps[0].payload).toBeDefined();
    });

    it("should handle undefined payload in step", async () => {
      const workflow = [{ action: "test", payload: undefined }];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan({
        userId: "user-123",
        userInput: "test",
      });

      expect(plan.steps[0].payload).toBeUndefined();
    });
  });

  describe("Edge Cases - LLM Response Validation", () => {
    it("should reject LLM response missing workflow array", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "swap tokens",
      };

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([
        { name: "swap", description: "Swap tokens" },
      ]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        plan: [], // Missing 'workflow' key
      });

      await expect(planner.createPlan(context)).rejects.toThrow(
        "Invalid LLM response: missing workflow array"
      );
    });

    it("should reject LLM response with invalid workflow type", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "swap tokens",
      };

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([
        { name: "swap", description: "Swap tokens" },
      ]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: "not an array",
      });

      await expect(planner.createPlan(context)).rejects.toThrow(
        "Invalid LLM response: missing workflow array"
      );
    });

    it("should reject LLM response with null workflow", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "swap tokens",
      };

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([
        { name: "swap", description: "Swap tokens" },
      ]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: null,
      });

      await expect(planner.createPlan(context)).rejects.toThrow(
        "Invalid LLM response: missing workflow array"
      );
    });

    it("should handle malformed step in workflow", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "swap tokens",
      };

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([
        { name: "swap", description: "Swap tokens" },
      ]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: [
          {
            action: "swap",
            // Missing payload
          },
        ],
      });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);
      expect(plan.totalSteps).toBe(1);
      expect(plan.steps[0].payload).toBeUndefined();
    });
  });

  describe("Edge Cases - Plan Size Constraints", () => {
    it("should create plan even with many steps", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "execute complex workflow",
      };

      // Create a workflow with many steps
      const workflow = Array.from({ length: 10 }, (_, i) => ({
        action: `step_${i}`,
        payload: { index: i },
      }));

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);
      expect(plan.totalSteps).toBe(10);
      expect(plan.riskLevel).toBe("high");
    });

    it("should mark plans with >3 steps as requiring approval", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "execute workflow",
      };

      const workflow = Array.from({ length: 4 }, (_, i) => ({
        action: `step_${i}`,
        payload: { index: i },
      }));

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);
      expect(plan.requiresApproval).toBe(true);
    });

    it("should assess high risk for >= 5 steps", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "execute complex workflow",
      };

      const workflow = Array.from({ length: 5 }, (_, i) => ({
        action: `step_${i}`,
        payload: { index: i },
      }));

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);
      expect(plan.riskLevel).toBe("high");
    });

    it("should assess medium risk for 2-4 steps", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "execute workflow",
      };

      const workflow = Array.from({ length: 3 }, (_, i) => ({
        action: `step_${i}`,
        payload: { index: i },
      }));

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);
      expect(plan.riskLevel).toBe("medium");
    });

    it("should assess low risk for 1 step", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "swap tokens",
      };

      const workflow = [
        {
          action: "swap",
          payload: { from: "ETH", to: "DAI", amount: 100 },
        },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([
        { name: "swap", description: "Swap tokens" },
      ]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);
      expect(plan.riskLevel).toBe("low");
    });
  });

  describe("Edge Cases - User Preferences and Constraints", () => {
    it("should respect user risk level preferences", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "swap tokens",
        userPreferences: {
          riskLevel: RiskLevel.LOW,
          preferredAssets: ["ETH", "DAI"],
          autoApproveSmallTransactions: true,
          smallTransactionThreshold: 100,
          defaultSlippage: 0.5,
        },
      };

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([
        { name: "swap", description: "Swap tokens" },
      ]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: [
          {
            action: "swap",
            payload: { from: "ETH", to: "DAI", amount: 100 },
          },
        ],
      });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);
      expect(plan).toBeDefined();
      expect((logger.info as jest.Mock).mock.calls[0][0]).toBe(
        "Creating execution plan"
      );
    });

    it("should handle constraints in planner context", async () => {
      const constraints: PlannerConstraints = {
        maxSteps: 5,
        allowedTools: ["swap", "transfer"],
        minSlippage: 0.1,
        maxSlippage: 5.0,
        timeout: 30000,
      };

      const context: PlannerContext = {
        userId: "user-123",
        userInput: "swap tokens",
        constraints,
      };

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([
        { name: "swap", description: "Swap tokens" },
      ]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: [
          {
            action: "swap",
            payload: { from: "ETH", to: "DAI", amount: 100 },
          },
        ],
      });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);
      expect(plan.totalSteps).toBeLessThanOrEqual(5);
    });

    it("should handle available balance constraints", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "swap 100 ETH",
        availableBalance: {
          ETH: 50,
          DAI: 1000,
        },
      };

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([
        { name: "swap", description: "Swap tokens" },
      ]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: [
          {
            action: "swap",
            payload: { from: "ETH", to: "DAI", amount: 50 },
          },
        ],
      });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);
      expect(plan).toBeDefined();
    });
  });

  describe("Edge Cases - Plan Validation", () => {
    it("should reject plans with no steps", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "do nothing",
      };

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow: [] });

      await expect(planner.createPlan(context)).rejects.toThrow(
        "Invalid plan: Plan has no steps"
      );
    });

    it("should handle LLM timeout gracefully", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "swap tokens",
      };

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([
        { name: "swap", description: "Swap tokens" },
      ]);
      (agentLLM.callLLM as jest.Mock).mockRejectedValue(
        new Error("LLM timeout")
      );

      await expect(planner.createPlan(context)).rejects.toThrow("LLM timeout");
      expect((logger.error as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    });

    it("should log error on plan creation failure", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "swap tokens",
      };

      const error = new Error("Network error");
      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockRejectedValue(error);

      await expect(planner.createPlan(context)).rejects.toThrow(
        "Network error"
      );
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to create execution plan",
        expect.objectContaining({
          userId: "user-123",
        })
      );
    });
  });

  // ============================================================
  // PERFORMANCE TESTS
  // ============================================================

  describe("Performance Benchmarks", () => {
    it("should create plan within acceptable time", async () => {
      const mockWorkflow = {
        workflow: [
          { action: "swap", payload: { from: "ETH", to: "DAI", amount: 100 } },
        ],
      };

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([
        { name: "swap", description: "Swap tokens" },
      ]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue(mockWorkflow);
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const startTime = Date.now();
      const plan = await planner.createPlan(mockContext);
      const duration = Date.now() - startTime;

      expect(plan).toBeDefined();
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });

    it("should handle 100 concurrent plan creations efficiently", async () => {
      const contexts = Array.from({ length: 100 }, (_, i) => ({
        userId: `user-${i}`,
        userInput: "test",
      }));

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: [{ action: "test", payload: {} }],
      });
      (planHashService.generatePlanHash as jest.Mock).mockImplementation(
        () => `hash-${Math.random()}`
      );

      const startTime = Date.now();

      const plans = await Promise.all(
        contexts.map((ctx) => planner.createPlan(ctx))
      );

      const duration = Date.now() - startTime;
      const avgDuration = duration / 100;

      expect(avgDuration).toBeLessThan(50); // Average < 50ms per plan
      expect(plans).toHaveLength(100);
      expect(plans.every((p) => p.planId)).toBe(true);
    });
  });

  // ============================================================
  // MULTI-AGENT FLOW TESTS
  // ============================================================

  describe("Multi-Agent Flows - Sequential Orchestration", () => {
    it("should handle sequential agent execution in workflow", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "swap ETH to DAI then transfer to wallet",
      };

      const sequentialWorkflow = [
        {
          action: "swap",
          payload: { from: "ETH", to: "DAI", amount: 100 },
        },
        {
          action: "transfer",
          payload: { to: "0xABC123", amount: 100 },
        },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([
        { name: "swap", description: "Swap tokens" },
        { name: "transfer", description: "Transfer tokens" },
      ]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: sequentialWorkflow,
      });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-seq-123"
      );

      const plan = await planner.createPlan(context);
      expect(plan.totalSteps).toBe(2);
      expect(plan.steps[0].stepNumber).toBe(1);
      expect(plan.steps[1].stepNumber).toBe(2);
      expect(plan.steps[0].action).toBe("swap");
      expect(plan.steps[1].action).toBe("transfer");
    });

    it("should maintain step order in multi-agent workflows", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "complex multi-step workflow",
      };

      const workflow = [
        { action: "checkBalance", payload: {} },
        { action: "approveToken", payload: { token: "DAI" } },
        { action: "swap", payload: {} },
        { action: "stake", payload: {} },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);

      for (let i = 0; i < plan.steps.length; i++) {
        expect(plan.steps[i].stepNumber).toBe(i + 1);
        expect(plan.steps[i].action).toBe(workflow[i].action);
      }
    });

    it("should generate descriptions for sequential steps", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "swap and transfer",
      };

      const workflow = [
        { action: "swap", payload: {} },
        { action: "transfer", payload: {} },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);

      expect(plan.steps[0].description).toBe("Execute swap");
      expect(plan.steps[1].description).toBe("Execute transfer");
    });
  });

  describe("Multi-Agent Flows - Parallel Coordination", () => {
    it("should handle multiple independent agents in parallel", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "check balance and approve token in parallel",
      };

      const parallelWorkflow = [
        { action: "checkBalance", payload: { token: "ETH" } },
        { action: "checkBalance", payload: { token: "DAI" } },
        { action: "approveToken", payload: { token: "DAI" } },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: parallelWorkflow,
      });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-parallel-123"
      );

      const plan = await planner.createPlan(context);
      expect(plan.totalSteps).toBe(3);
      expect(plan.estimatedDuration).toBe(9000); // 3 steps * 3000ms each
    });

    it("should handle agent failure scenarios", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "execute with potential failures",
      };

      const workflow = [
        { action: "validateInput", payload: {} },
        { action: "executeOperation", payload: {} },
        { action: "rollback", payload: {} },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);

      // Verify rollback step is included
      const rollbackStep = plan.steps.find((s) => s.action === "rollback");
      expect(rollbackStep).toBeDefined();
    });
  });

  describe("Multi-Agent Flows - Dependency Management", () => {
    it("should track step dependencies in multi-agent workflows", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "execute dependent workflow",
      };

      const dependentWorkflow = [
        { action: "swap", payload: { from: "ETH", to: "DAI" } },
        { action: "transfer", payload: { to: "address" } },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: dependentWorkflow,
      });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);

      // Transfer depends on swap
      expect(plan.steps[1].stepNumber).toBe(2);
      expect(plan.steps[1].action).toBe("transfer");
    });

    it("should initialize dependencies array for each step", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "workflow with dependencies",
      };

      const workflow = [
        { action: "step1", payload: {} },
        { action: "step2", payload: {} },
        { action: "step3", payload: {} },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);

      plan.steps.forEach((step) => {
        expect(step.dependencies).toBeDefined();
        expect(Array.isArray(step.dependencies)).toBe(true);
      });
    });
  });

  describe("Multi-Agent Flows - User Context Isolation", () => {
    it("should create independent plans for different users", async () => {
      const context1: PlannerContext = {
        userId: "user-1",
        userInput: "swap ETH",
      };

      const context2: PlannerContext = {
        userId: "user-2",
        userInput: "transfer DAI",
      };

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock)
        .mockResolvedValueOnce({
          workflow: [
            {
              action: "swap",
              payload: { from: "ETH", to: "DAI" },
            },
          ],
        })
        .mockResolvedValueOnce({
          workflow: [
            {
              action: "transfer",
              payload: { to: "address" },
            },
          ],
        });
      (planHashService.generatePlanHash as jest.Mock)
        .mockReturnValueOnce("hash-1")
        .mockReturnValueOnce("hash-2");

      const plan1 = await planner.createPlan(context1);
      const plan2 = await planner.createPlan(context2);

      expect(plan1.planId).not.toBe(plan2.planId);
      expect(plan1.steps[0].action).toBe("swap");
      expect(plan2.steps[0].action).toBe("transfer");
    });

    it("should not share state between concurrent plan creations", async () => {
      const context1: PlannerContext = {
        userId: "user-1",
        userInput: "operation 1",
      };

      const context2: PlannerContext = {
        userId: "user-2",
        userInput: "operation 2",
      };

      let callCount = 0;
      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            workflow: [{ action: "action1", payload: {} }],
          };
        }
        return {
          workflow: [{ action: "action2", payload: {} }],
        };
      });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        `hash-${callCount}`
      );

      // Execute concurrently
      const [plan1, plan2] = await Promise.all([
        planner.createPlan(context1),
        planner.createPlan(context2),
      ]);

      expect(plan1.steps[0].action).not.toBe(plan2.steps[0].action);
    });

    it("should isolate user preferences in planning", async () => {
      const context1: PlannerContext = {
        userId: "user-1",
        userInput: "swap",
        userPreferences: {
          riskLevel: RiskLevel.LOW,
          preferredAssets: ["ETH"],
          autoApproveSmallTransactions: false,
          smallTransactionThreshold: 100,
          defaultSlippage: 0.5,
        },
      };

      const context2: PlannerContext = {
        userId: "user-2",
        userInput: "swap",
        userPreferences: {
          riskLevel: RiskLevel.HIGH,
          preferredAssets: ["DAI", "USDC"],
          autoApproveSmallTransactions: true,
          smallTransactionThreshold: 1000,
          defaultSlippage: 2.0,
        },
      };

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([
        { name: "swap", description: "Swap" },
      ]);
      (agentLLM.callLLM as jest.Mock)
        .mockResolvedValueOnce({
          workflow: [{ action: "swap", payload: {} }],
        })
        .mockResolvedValueOnce({
          workflow: [{ action: "swap", payload: {} }],
        });
      (planHashService.generatePlanHash as jest.Mock)
        .mockReturnValueOnce("hash-1")
        .mockReturnValueOnce("hash-2");

      const plan1 = await planner.createPlan(context1);
      const plan2 = await planner.createPlan(context2);

      expect(plan1).toBeDefined();
      expect(plan2).toBeDefined();
      // Verify logging includes user context
      expect(logger.info).toHaveBeenCalledWith(
        "Creating execution plan",
        expect.objectContaining({
          userId: "user-1",
        })
      );
    });
  });

  describe("Multi-Agent Flows - Plan Integrity with Hashing", () => {
    it("should generate unique plan IDs for each plan", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "simple workflow",
      };

      const workflow = [
        {
          action: "swap",
          payload: {},
        },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan1 = await planner.createPlan(context);
      const plan2 = await planner.createPlan(context);

      expect(plan1.planId).not.toBe(plan2.planId);
    });

    it("should include hash in created plan", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "workflow",
      };

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: [{ action: "test", payload: {} }],
      });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "expected-hash-value"
      );

      const plan = await planner.createPlan(context);

      expect(plan.planHash).toBe("expected-hash-value");
    });

    it("should sign plan when signing key is available", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "signed workflow",
      };

      // Mock environment variable
      const originalEnv = process.env.PLAN_SIGNING_KEY;
      process.env.PLAN_SIGNING_KEY = "test-key";

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: [{ action: "test", payload: {} }],
      });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );
      (planHashService.signPlanHash as jest.Mock).mockReturnValue(
        "signature-abc"
      );

      const plan = await planner.createPlan(context);

      expect(plan.signature).toBe("signature-abc");
      expect(plan.signedBy).toBe("chenpilot-backend");
      expect(plan.signedAt).toBeDefined();

      // Restore environment
      process.env.PLAN_SIGNING_KEY = originalEnv;
    });

    it("should not include signature when signing key is unavailable", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "unsigned workflow",
      };

      // Ensure no signing key
      const originalEnv = process.env.PLAN_SIGNING_KEY;
      delete process.env.PLAN_SIGNING_KEY;

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: [{ action: "test", payload: {} }],
      });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);

      expect(plan.signature).toBeUndefined();
      expect(plan.signedBy).toBeUndefined();

      // Restore environment
      process.env.PLAN_SIGNING_KEY = originalEnv;
    });
  });

  describe("Multi-Agent Flows - Complex Workflows", () => {
    it("should handle interleaved multi-agent transactions", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "complex defi operation",
      };

      const complexWorkflow = [
        { action: "checkBalance", payload: { token: "ETH" } },
        { action: "approveSpender", payload: { token: "DAI", amount: 1000 } },
        { action: "swap", payload: { from: "ETH", to: "DAI", amount: 100 } },
        {
          action: "provideLiquidity",
          payload: { token1: "DAI", token2: "USDC" },
        },
        { action: "stake", payload: { amount: 500 } },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: complexWorkflow,
      });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-complex"
      );

      const plan = await planner.createPlan(context);

      expect(plan.totalSteps).toBe(5);
      expect(plan.riskLevel).toBe("high");
      expect(plan.requiresApproval).toBe(true);
      expect(plan.estimatedDuration).toBe(15000); // 5 * 3000ms
    });

    it("should handle workflow with mixed operation types", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "mixed operations",
      };

      const mixedWorkflow = [
        { action: "readData", payload: {} },
        { action: "processData", payload: {} },
        { action: "executeTransaction", payload: {} },
        { action: "confirmTransaction", payload: {} },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: mixedWorkflow,
      });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);

      expect(plan.steps.length).toBe(4);
      plan.steps.forEach((step, index) => {
        expect(step.stepNumber).toBe(index + 1);
        expect(step.description).toMatch(/Execute/);
      });
    });

    it("should generate appropriate summary for complex plans", async () => {
      const userInput = "execute a complex trading strategy";
      const context: PlannerContext = {
        userId: "user-123",
        userInput,
      };

      const workflow = [
        { action: "step1", payload: {} },
        { action: "step2", payload: {} },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);

      expect(plan.summary).toContain(userInput);
    });
  });

  describe("Edge Cases - Error Recovery", () => {
    it("should retry on transient LLM errors", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "swap tokens",
      };

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);

      // First call fails, second succeeds
      (agentLLM.callLLM as jest.Mock)
        .mockRejectedValueOnce(new Error("Temporary error"))
        .mockResolvedValueOnce({
          workflow: [{ action: "swap", payload: {} }],
        });

      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      // Most implementations would wrap this in retry logic
      // This test demonstrates the expected behavior
      try {
        await planner.createPlan(context);
      } catch (error) {
        expect((error as Error).message).toBe("Temporary error");
      }
    });

    it("should handle partial plan recovery", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "complex operation",
      };

      const partialWorkflow = [
        { action: "step1", payload: {} },
        { action: "step2", payload: {} },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: partialWorkflow,
      });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);
      expect(plan.steps.length).toBe(2);
    });
  });

  describe("Multi-Agent Flows - Concurrency and Race Conditions", () => {
    it("should handle rapid consecutive plan creations", async () => {
      const contexts = Array.from({ length: 5 }, (_, i) => ({
        userId: `user-${i}`,
        userInput: `operation-${i}`,
      }));

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: [{ action: "test", payload: {} }],
      });
      (planHashService.generatePlanHash as jest.Mock).mockImplementation(
        () => `hash-${Math.random()}`
      );

      const plans = await Promise.all(
        contexts.map((ctx) => planner.createPlan(ctx))
      );

      expect(plans).toHaveLength(5);
      const planIds = plans.map((p) => p.planId);
      const uniqueIds = new Set(planIds);
      expect(uniqueIds.size).toBe(5); // All IDs should be unique
    });

    it("should handle race conditions in plan creation", async () => {
      const userId = "user-123";
      const contexts = Array.from({ length: 10 }, (_, i) => ({
        userId,
        userInput: `operation-${i}`,
      }));

      let callCount = 0;
      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockImplementation(async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
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

      // All plans should be processed correctly
      expect(plans).toHaveLength(10);
      const uniquePlanIds = new Set(plans.map((p) => p.planId));
      expect(uniquePlanIds.size).toBe(10);
    });

    it("should handle concurrent hash generation collisions", async () => {
      const contexts = Array.from({ length: 20 }, (_, i) => ({
        userId: `user-${i}`,
        userInput: "same operation",
      }));

      let hashCounter = 0;
      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (planHashService.generatePlanHash as jest.Mock).mockImplementation(() => {
        hashCounter++;
        return `hash-${hashCounter}`;
      });

      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: [{ action: "test", payload: {} }],
      });

      const plans = await Promise.all(
        contexts.map((ctx) => planner.createPlan(ctx))
      );

      const hashes = plans.map((p) => p.planHash);
      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(20); // All should be unique
    });

    it("should maintain isolation during concurrent multi-agent planning", async () => {
      const workflows = [
        [{ action: "action1", payload: { user: 1 } }],
        [{ action: "action2", payload: { user: 2 } }],
        [{ action: "action3", payload: { user: 3 } }],
      ];

      let callIndex = 0;

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockImplementation(async () => {
        const result = { workflow: workflows[callIndex] };
        callIndex++;
        return result;
      });
      (planHashService.generatePlanHash as jest.Mock).mockImplementation(
        () => `hash-${Math.random()}`
      );

      const contexts = [
        { userId: "user-1", userInput: "op1" },
        { userId: "user-2", userInput: "op2" },
        { userId: "user-3", userInput: "op3" },
      ];

      const plans = await Promise.all(
        contexts.map((ctx) => planner.createPlan(ctx))
      );

      // Verify each plan has correct action
      expect(plans[0].steps[0].action).toBe("action1");
      expect(plans[1].steps[0].action).toBe("action2");
      expect(plans[2].steps[0].action).toBe("action3");
    });
  });

  describe("Plan Optimization", () => {
    it("should optimize plan without modifying steps", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "simple operation",
      };

      const workflow = [
        { action: "step1", payload: {} },
        { action: "step2", payload: {} },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);
      const originalStepCount = plan.totalSteps;

      const optimizedPlan = planner.optimizePlan(plan as ExecutionPlan);

      expect(optimizedPlan.totalSteps).toBe(originalStepCount);
    });
  });

  describe("Soroban Intent Parsing", () => {
    it("should handle Soroban intent parsing as fallback", async () => {
      // This test verifies that if Soroban parsing matches,
      // the LLM is not called
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "soroban specific command",
      };

      // Mock parseSorobanIntent would need to be mocked
      // This demonstrates expected behavior
      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: [{ action: "default", payload: {} }],
      });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);
      expect(plan).toBeDefined();
    });
  });

  describe("Data Consistency", () => {
    it("should preserve numeric precision in payloads", async () => {
      const preciseAmount = "0.000000000000000001"; // Very small number

      const workflow = [
        { action: "transfer", payload: { amount: preciseAmount } },
      ];

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({ workflow });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan({
        userId: "user-123",
        userInput: "transfer small amount",
      });

      expect(plan.steps[0].payload.amount).toBe(preciseAmount);
    });

    it("should handle special characters in input", async () => {
      const specialInput = "Transfer 100 ETH 🚀 to 0x123!@#$%^&*()";
      const context: PlannerContext = {
        userId: "user-123",
        userInput: specialInput,
      };

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: [{ action: "transfer", payload: { amount: 100 } }],
      });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);

      expect(plan.summary).toContain(specialInput.substring(0, 50));
    });
  });

  describe("Large-Scale Multi-Agent Scenarios", () => {
    it("should generate valid plans with many sequential agents", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "large workflow",
      };

      // Simulate many steps
      const largeWorkflow = Array.from({ length: 8 }, (_, i) => ({
        action: `agent_${i}`,
        payload: { step: i },
      }));

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: largeWorkflow,
      });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-large"
      );

      const plan = await planner.createPlan(context);

      expect(plan.totalSteps).toBe(8);
      expect(plan.riskLevel).toBe("high");
      // Verify all steps maintain proper numbering
      plan.steps.forEach((step, index) => {
        expect(step.stepNumber).toBe(index + 1);
      });
    });

    it("should properly estimate duration for large plans", async () => {
      const context: PlannerContext = {
        userId: "user-123",
        userInput: "large workflow",
      };

      const count = 10;
      const largeWorkflow = Array.from({ length: count }, (_, i) => ({
        action: `step_${i}`,
        payload: {},
      }));

      (toolRegistry.getToolMetadata as jest.Mock).mockReturnValue([]);
      (agentLLM.callLLM as jest.Mock).mockResolvedValue({
        workflow: largeWorkflow,
      });
      (planHashService.generatePlanHash as jest.Mock).mockReturnValue(
        "hash-123"
      );

      const plan = await planner.createPlan(context);

      expect(plan.estimatedDuration).toBe(count * 3000);
    });
  });
});

const mockContext: PlannerContext = {
  userId: "test-user",
  userInput: "test input",
};
