import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { ExecutionPlan } from "../../src/Agents/planner/AgentPlanner";
import { PlanExecutor } from "../../src/Agents/planner/PlanExecutor";
import { toolRegistry } from "../../src/Agents/registry/ToolRegistry";

jest.mock("../../src/Agents/registry/ToolRegistry");
jest.mock("../../src/Agents/policy/PolicyEnforcer", () => ({
  policyEnforcer: {
    enforce: jest.fn().mockResolvedValue({ allowed: true }),
  },
}));
jest.mock("../../src/config/logger");

function createFiveStepPlan(): ExecutionPlan {
  return {
    planId: "plan_failure-semantics",
    steps: Array.from({ length: 5 }, (_, index) => ({
      stepNumber: index + 1,
      action: `step_${index + 1}`,
      payload: {},
      description: `Step ${index + 1}`,
      dependencies: [],
    })),
    totalSteps: 5,
    estimatedDuration: 15000,
    riskLevel: "low",
    requiresApproval: false,
    summary: "Five-step failure semantics test plan",
  };
}

describe("PlanExecutor multi-step failure semantics", () => {
  let executor: PlanExecutor;

  beforeEach(() => {
    executor = new PlanExecutor();
    jest.clearAllMocks();
  });

  it("stops at a failure on the first step and reports no completed steps", async () => {
    const plan = createFiveStepPlan();
    (toolRegistry.executeTool as jest.Mock).mockResolvedValueOnce({
      action: "step_1",
      status: "error",
      error: "first step failed",
    });

    const result = await executor.executePlan(plan, "user-1", {
      durable: false,
    });

    expect(result.status).toBe("failed");
    expect(result.completedSteps).toBe(0);
    expect(result.totalSteps).toBe(5);
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0]).toMatchObject({
      stepNumber: 1,
      status: "failed",
    });
    expect(toolRegistry.executeTool).toHaveBeenCalledTimes(1);
  });

  it("stops at a middle-step failure and reports prior steps as successful", async () => {
    const plan = createFiveStepPlan();
    (toolRegistry.executeTool as jest.Mock)
      .mockResolvedValueOnce({ action: "step_1", status: "success" })
      .mockResolvedValueOnce({ action: "step_2", status: "success" })
      .mockResolvedValueOnce({
        action: "step_3",
        status: "error",
        error: "middle step failed",
      });

    const result = await executor.executePlan(plan, "user-1", {
      durable: false,
    });

    expect(result.status).toBe("partial");
    expect(result.completedSteps).toBe(2);
    expect(result.totalSteps).toBe(5);
    expect(result.stepResults.map((step) => step.status)).toEqual([
      "success",
      "success",
      "failed",
    ]);
    expect(toolRegistry.executeTool).toHaveBeenCalledTimes(3);
  });

  it("stops at a failure on the last step and reports all prior steps as successful", async () => {
    const plan = createFiveStepPlan();
    (toolRegistry.executeTool as jest.Mock)
      .mockResolvedValueOnce({ action: "step_1", status: "success" })
      .mockResolvedValueOnce({ action: "step_2", status: "success" })
      .mockResolvedValueOnce({ action: "step_3", status: "success" })
      .mockResolvedValueOnce({ action: "step_4", status: "success" })
      .mockResolvedValueOnce({
        action: "step_5",
        status: "error",
        error: "last step failed",
      });

    const result = await executor.executePlan(plan, "user-1", {
      durable: false,
    });

    expect(result.status).toBe("partial");
    expect(result.completedSteps).toBe(4);
    expect(result.totalSteps).toBe(5);
    expect(result.stepResults).toHaveLength(5);
    expect(result.stepResults[4]).toMatchObject({
      stepNumber: 5,
      status: "failed",
    });
    expect(toolRegistry.executeTool).toHaveBeenCalledTimes(5);
  });
});
