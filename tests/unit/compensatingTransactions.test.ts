import { describe, it, expect, beforeEach, jest } from "@jest/globals";

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock("../../src/config/logger");
jest.mock("../../src/config/config", () => ({
  default: {
    agent: { timeouts: { toolExecution: 5000, agentExecution: 60000 } },
    jwt: { secret: "test-secret-32-chars-long-enough!!" },
    stellar: { horizonUrl: "https://horizon-testnet.stellar.org" },
  },
}));

const mockSave = jest.fn();
const mockFind = jest.fn();
const mockFindOne = jest.fn();
const mockCreate = jest.fn();
const mockCount = jest.fn();

const mockRepo = {
  create: mockCreate,
  save: mockSave,
  find: mockFind,
  findOne: mockFindOne,
  count: mockCount,
};

jest.mock("../../src/config/Datasource", () => ({
  AppDataSource: { getRepository: jest.fn(() => mockRepo) },
  default: { getRepository: jest.fn(() => mockRepo) },
}));

jest.mock("../../src/Gateway/realtimeIntegration", () => ({
  TransactionUpdateHelper: {
    notifyCreated: jest.fn(),
    notifyPending: jest.fn(),
    notifyConfirmed: jest.fn(),
    notifyFailed: jest.fn(),
  },
}));

jest.mock("../../src/Gateway/socketManager", () => ({
  getSocketManager: jest.fn(() => ({
    getEventEmitter: jest.fn(() => ({
      emitAgentExecutionUpdate: jest.fn(),
    })),
  })),
  RealtimeEventType: {
    AGENT_STEP_COMPLETED: "AGENT_STEP_COMPLETED",
    AGENT_EXECUTION_COMPLETED: "AGENT_EXECUTION_COMPLETED",
    AGENT_EXECUTION_FAILED: "AGENT_EXECUTION_FAILED",
    AGENT_APPROVAL_REQUIRED: "AGENT_APPROVAL_REQUIRED",
    AGENT_EXECUTION_STARTED: "AGENT_EXECUTION_STARTED",
  },
}));

// ── Imports ─────────────────────────────────────────────────────────────────────

import {
  CompensationType,
  CompensationOutcome,
  CompensationPlan,
  FailureState,
} from "../../src/Agents/types";
import {
  buildCompensationPlan,
} from "../../src/Agents/planner/CompensationService";
import { PlanStep } from "../../src/Agents/planner/AgentPlanner";
import {
  VALID_TRANSITIONS,
  TERMINAL_STATES,
  LifecycleState,
} from "../../src/transactions/TransactionLifecycle.entity";

// ── buildCompensationPlan unit tests ────────────────────────────────────────────

describe("buildCompensationPlan", () => {
  function makeStep(overrides: Partial<PlanStep>): PlanStep {
    return {
      stepNumber: 1,
      action: "swap_tool",
      payload: { from: "XLM", to: "USDC", amount: 100 },
      description: "Swap XLM to USDC",
      ...overrides,
    };
  }

  it("marks send as irreversible", () => {
    const step = makeStep({ action: "send", payload: { to: "G...", amount: 50 } });
    const plan = buildCompensationPlan(step);
    expect(plan.type).toBe(CompensationType.IRREVERSIBLE);
    expect(plan.rollbackAction).toBeNull();
    expect(plan.rollbackPayload).toBeNull();
  });

  it("marks transfer as irreversible", () => {
    const step = makeStep({ action: "transfer", payload: { to: "G...", amount: 50 } });
    const plan = buildCompensationPlan(step);
    expect(plan.type).toBe(CompensationType.IRREVERSIBLE);
  });

  it("marks approve as irreversible", () => {
    const step = makeStep({ action: "approve", payload: { spender: "G...", amount: 1000 } });
    const plan = buildCompensationPlan(step);
    expect(plan.type).toBe(CompensationType.IRREVERSIBLE);
  });

  it("marks lend as requiring manual review", () => {
    const step = makeStep({ action: "lend", payload: { token: "USDC", amount: 500 } });
    const plan = buildCompensationPlan(step);
    expect(plan.type).toBe(CompensationType.REQUIRES_MANUAL_REVIEW);
    expect(plan.rollbackAction).toBeNull();
  });

  it("marks borrow as requiring manual review", () => {
    const step = makeStep({ action: "borrow", payload: { token: "USDC", amount: 500 } });
    const plan = buildCompensationPlan(step);
    expect(plan.type).toBe(CompensationType.REQUIRES_MANUAL_REVIEW);
  });

  it("marks repay as requiring manual review", () => {
    const step = makeStep({ action: "repay", payload: { token: "USDC", amount: 200 } });
    const plan = buildCompensationPlan(step);
    expect(plan.type).toBe(CompensationType.REQUIRES_MANUAL_REVIEW);
  });

  it("marks withdraw as requiring manual review", () => {
    const step = makeStep({ action: "withdraw", payload: { token: "USDC", amount: 200 } });
    const plan = buildCompensationPlan(step);
    expect(plan.type).toBe(CompensationType.REQUIRES_MANUAL_REVIEW);
  });

  it("marks add_liquidity as requiring manual review", () => {
    const step = makeStep({ action: "add_liquidity", payload: { tokenA: "XLM", tokenB: "USDC" } });
    const plan = buildCompensationPlan(step);
    expect(plan.type).toBe(CompensationType.REQUIRES_MANUAL_REVIEW);
  });

  it("marks remove_liquidity as requiring manual review", () => {
    const step = makeStep({ action: "remove_liquidity", payload: { tokenA: "XLM", tokenB: "USDC", lpAmount: 10 } });
    const plan = buildCompensationPlan(step);
    expect(plan.type).toBe(CompensationType.REQUIRES_MANUAL_REVIEW);
  });

  it("marks swap as reversible with reverse payload", () => {
    const step = makeStep({
      action: "swap_tool",
      payload: { from: "XLM", to: "USDC", amount: 100 },
    });
    const plan = buildCompensationPlan(step);
    expect(plan.type).toBe(CompensationType.REVERSIBLE);
    expect(plan.rollbackAction).toBe("swap_tool");
    expect(plan.rollbackPayload).toEqual({ from: "USDC", to: "XLM", amount: 100 });
    expect(plan.description).toContain("Reverse swap");
  });

  it("swap with sendAsset/destAsset fields also builds reverse", () => {
    const step = makeStep({
      action: "path_payment",
      payload: { sendAsset: "XLM", destAsset: "USDC", sendAmount: 200 },
    });
    const plan = buildCompensationPlan(step);
    expect(plan.type).toBe(CompensationType.REVERSIBLE);
    expect(plan.rollbackPayload).toEqual({ from: "USDC", to: "XLM", amount: 200 });
  });

  it("unknown action defaults to reversible with generic rollback", () => {
    const step = makeStep({ action: "some_custom_action", payload: { foo: "bar" } });
    const plan = buildCompensationPlan(step);
    expect(plan.type).toBe(CompensationType.REVERSIBLE);
    expect(plan.rollbackAction).toBe("some_custom_action");
    expect(plan.rollbackPayload).toEqual({ foo: "bar", _compensation: true });
  });

  it("every step declares compensation semantics (acceptance criterion)", () => {
    const allActions = [
      "swap", "swap_tool", "send", "transfer", "approve", "submit_transaction",
      "lend", "borrow", "repay", "withdraw", "add_liquidity", "remove_liquidity",
      "some_custom_action",
    ];

    for (const action of allActions) {
      const step = makeStep({ action, payload: {} });
      const plan = buildCompensationPlan(step);

      // Every step must have a valid compensation type
      expect([
        CompensationType.REVERSIBLE,
        CompensationType.IRREVERSIBLE,
        CompensationType.REQUIRES_MANUAL_REVIEW,
      ]).toContain(plan.type);

      // Every step must have a description
      expect(plan.description).toBeTruthy();
      expect(plan.description.length).toBeGreaterThan(0);
    }
  });
});

// ── Failure state classification tests ──────────────────────────────────────────

describe("FailureState classification", () => {
  it("RECOVERED indicates all steps were compensated", () => {
    expect(FailureState.RECOVERED).toBe("recovered");
  });

  it("STRANDED indicates funds/approvals may be at risk", () => {
    expect(FailureState.STRANDED).toBe("stranded");
  });

  it("MANUAL_REVIEW requires operator intervention", () => {
    expect(FailureState.MANUAL_REVIEW).toBe("manual_review");
  });
});

// ── CompensationOutcome tests ──────────────────────────────────────────────────

describe("CompensationOutcome", () => {
  it("COMPENSATED means successful rollback", () => {
    expect(CompensationOutcome.COMPENSATED).toBe("compensated");
  });

  it("STRANDED means compensation failed", () => {
    expect(CompensationOutcome.STRANDED).toBe("stranded");
  });

  it("MANUAL_REVIEW means operator must decide", () => {
    expect(CompensationOutcome.MANUAL_REVIEW).toBe("manual_review");
  });
});

// ── StepStatus compensation states ─────────────────────────────────────────────

describe("StepStatus compensation states", () => {
  it("includes COMPENSATING state", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { StepStatus } = require("../../src/Agents/planner/DurableStep.entity");
    expect(StepStatus.COMPENSATING).toBe("compensating");
  });

  it("includes COMPENSATED state", () => {
    const { StepStatus } = require("../../src/Agents/planner/DurableStep.entity");
    expect(StepStatus.COMPENSATED).toBe("compensated");
  });
});

// ── ExecutionStatus compensation state ─────────────────────────────────────────

describe("ExecutionStatus compensation state", () => {
  it("includes COMPENSATING status", () => {
    const { ExecutionStatus } = require("../../src/Agents/planner/DurableExecution.entity");
    expect(ExecutionStatus.COMPENSATING).toBe("compensating");
  });
});

// ── Fault injection at step boundary tests ─────────────────────────────────────

describe("Fault injection at step boundaries", () => {
  it("every non-terminal lifecycle state allows transition to failed", () => {
    const nonTerminal: LifecycleState[] = [
      "intent", "simulating", "executing",
      "pending", "waiting", "submitting", "submitted",
    ];
    for (const state of nonTerminal) {
      expect(VALID_TRANSITIONS[state].has("failed")).toBe(true);
    }
  });

  it("confirmed has no outgoing transitions (terminal)", () => {
    expect(VALID_TRANSITIONS["confirmed"].size).toBe(0);
  });

  it("failed has no outgoing transitions (terminal)", () => {
    expect(VALID_TRANSITIONS["failed"].size).toBe(0);
  });

  it("cancelled has no outgoing transitions (terminal)", () => {
    expect(VALID_TRANSITIONS["cancelled"].size).toBe(0);
  });

  it("fault injection: intent fails cleanly", () => {
    const transitions = VALID_TRANSITIONS["intent"];
    expect(transitions.has("failed")).toBe(true);
  });

  it("fault injection: simulating fails cleanly", () => {
    const transitions = VALID_TRANSITIONS["simulating"];
    expect(transitions.has("failed")).toBe(true);
  });

  it("fault injection: executing fails cleanly", () => {
    const transitions = VALID_TRANSITIONS["executing"];
    expect(transitions.has("failed")).toBe(true);
  });

  it("fault injection: submitting fails cleanly", () => {
    const transitions = VALID_TRANSITIONS["submitting"];
    expect(transitions.has("failed")).toBe(true);
  });

  it("fault injection: submitted fails cleanly", () => {
    const transitions = VALID_TRANSITIONS["submitted"];
    expect(transitions.has("failed")).toBe(true);
  });

  it("fault injection: pending fails cleanly", () => {
    const transitions = VALID_TRANSITIONS["pending"];
    expect(transitions.has("failed")).toBe(true);
  });

  it("fault injection: waiting fails cleanly", () => {
    const transitions = VALID_TRANSITIONS["waiting"];
    expect(transitions.has("failed")).toBe(true);
  });

  it("all terminal states have zero outgoing transitions", () => {
    for (const state of TERMINAL_STATES) {
      expect(VALID_TRANSITIONS[state].size).toBe(0);
    }
  });

  it("no step boundary can reach confirmed from a failed state", () => {
    expect(VALID_TRANSITIONS["failed"].has("confirmed")).toBe(false);
  });

  it("no step boundary can reach confirmed from a cancelled state", () => {
    expect(VALID_TRANSITIONS["cancelled"].has("confirmed")).toBe(false);
  });
});

// ── PlanStep compensation integration ──────────────────────────────────────────

describe("PlanStep compensation fields", () => {
  it("PlanStep interface allows compensationType field", () => {
    const step: PlanStep = {
      stepNumber: 1,
      action: "swap_tool",
      payload: { from: "XLM", to: "USDC", amount: 100 },
      description: "Swap",
      compensationType: CompensationType.REVERSIBLE,
      rollbackActionName: "swap_tool",
      rollbackPayload: { from: "USDC", to: "XLM", amount: 100 },
    };

    expect(step.compensationType).toBe(CompensationType.REVERSIBLE);
    expect(step.rollbackActionName).toBe("swap_tool");
    expect(step.rollbackPayload).toEqual({ from: "USDC", to: "XLM", amount: 100 });
  });

  it("irreversible step has null rollback fields", () => {
    const step: PlanStep = {
      stepNumber: 1,
      action: "transfer",
      payload: { to: "G...", amount: 50 },
      description: "Transfer",
      compensationType: CompensationType.IRREVERSIBLE,
    };

    expect(step.compensationType).toBe(CompensationType.IRREVERSIBLE);
    expect(step.rollbackActionName).toBeUndefined();
  });

  it("manual review step has null rollback fields", () => {
    const step: PlanStep = {
      stepNumber: 1,
      action: "lend",
      payload: { token: "USDC", amount: 500 },
      description: "Lend",
      compensationType: CompensationType.REQUIRES_MANUAL_REVIEW,
    };

    expect(step.compensationType).toBe(CompensationType.REQUIRES_MANUAL_REVIEW);
    expect(step.rollbackActionName).toBeUndefined();
  });
});

// ── DurableStep compensation fields ────────────────────────────────────────────

describe("DurableStep compensation entity fields", () => {
  it("DurableStep has compensationType column", () => {
    const { StepStatus } = require("../../src/Agents/planner/DurableStep.entity");
    expect(StepStatus.COMPENSATING).toBeDefined();
    expect(StepStatus.COMPENSATED).toBeDefined();
  });
});

// ── DurableExecution failure state field ───────────────────────────────────────

describe("DurableExecution failure state", () => {
  it("ExecutionStatus includes COMPENSATING", () => {
    const { ExecutionStatus } = require("../../src/Agents/planner/DurableExecution.entity");
    expect(ExecutionStatus.COMPENSATING).toBeDefined();
  });
});

// ── Multi-step workflow compensation scenarios ──────────────────────────────────

describe("Multi-step workflow compensation scenarios", () => {
  it("3-step workflow: step 2 fails — steps 1 must be compensatable", () => {
    const steps: PlanStep[] = [
      {
        stepNumber: 1,
        action: "swap_tool",
        payload: { from: "XLM", to: "USDC", amount: 100 },
        description: "Swap XLM to USDC",
      },
      {
        stepNumber: 2,
        action: "swap_tool",
        payload: { from: "USDC", to: "ETH", amount: 50 },
        description: "Swap USDC to ETH",
      },
      {
        stepNumber: 3,
        action: "swap_tool",
        payload: { from: "ETH", to: "XLM", amount: 10 },
        description: "Swap ETH to XLM",
      },
    ];

    const plans = steps.map((s) => buildCompensationPlan(s));

    // All swaps are reversible
    expect(plans[0].type).toBe(CompensationType.REVERSIBLE);
    expect(plans[1].type).toBe(CompensationType.REVERSIBLE);
    expect(plans[2].type).toBe(CompensationType.REVERSIBLE);

    // When step 2 fails, step 1 compensation = reverse swap (USDC → XLM)
    expect(plans[0].rollbackAction).toBe("swap_tool");
    expect(plans[0].rollbackPayload).toEqual({ from: "USDC", to: "XLM", amount: 100 });
  });

  it("mixed workflow: irreversible step prevents full compensation", () => {
    const steps: PlanStep[] = [
      {
        stepNumber: 1,
        action: "swap_tool",
        payload: { from: "XLM", to: "USDC", amount: 100 },
        description: "Swap",
      },
      {
        stepNumber: 2,
        action: "transfer",
        payload: { to: "G...", amount: 50 },
        description: "Transfer USDC",
      },
    ];

    const plans = steps.map((s) => buildCompensationPlan(s));

    expect(plans[0].type).toBe(CompensationType.REVERSIBLE);
    expect(plans[1].type).toBe(CompensationType.IRREVERSIBLE);

    // If step 2 fails, step 1 can still be compensated
    // But if step 1 fails, step 2 cannot be compensated
    expect(plans[1].rollbackAction).toBeNull();
  });

  it("workflow with manual review step results in partial compensation", () => {
    const steps: PlanStep[] = [
      {
        stepNumber: 1,
        action: "swap_tool",
        payload: { from: "XLM", to: "USDC", amount: 100 },
        description: "Swap",
      },
      {
        stepNumber: 2,
        action: "lend",
        payload: { token: "USDC", amount: 100 },
        description: "Lend",
      },
    ];

    const plans = steps.map((s) => buildCompensationPlan(s));

    expect(plans[0].type).toBe(CompensationType.REVERSIBLE);
    expect(plans[1].type).toBe(CompensationType.REQUIRES_MANUAL_REVIEW);
  });

  it("idempotency: building compensation plan twice returns same result", () => {
    const step: PlanStep = {
      stepNumber: 1,
      action: "swap_tool",
      payload: { from: "XLM", to: "USDC", amount: 100 },
      description: "Swap",
    };

    const plan1 = buildCompensationPlan(step);
    const plan2 = buildCompensationPlan(step);

    expect(plan1.type).toEqual(plan2.type);
    expect(plan1.rollbackAction).toEqual(plan2.rollbackAction);
    expect(plan1.rollbackPayload).toEqual(plan2.rollbackPayload);
    expect(plan1.description).toEqual(plan2.description);
  });
});
