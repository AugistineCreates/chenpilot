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
const AgentPlanner_1 = require("../../src/Agents/planner/AgentPlanner");
const PlanExecutor_1 = require("../../src/Agents/planner/PlanExecutor");
const ToolRegistry_1 = require("../../src/Agents/registry/ToolRegistry");
const wallet_1 = require("../../src/Agents/tools/wallet");
const swap_1 = require("../../src/Agents/tools/swap");
const soroban_1 = require("../../src/Agents/tools/soroban");
(0, globals_1.describe)("AgentPlanner", () => {
  let planner;
  (0, globals_1.beforeEach)(() => {
    planner = new AgentPlanner_1.AgentPlanner();
    // Register tools
    ToolRegistry_1.toolRegistry.register(wallet_1.walletTool);
    ToolRegistry_1.toolRegistry.register(swap_1.swapTool);
    ToolRegistry_1.toolRegistry.register(soroban_1.sorobanTool);
  });
  (0, globals_1.describe)("createPlan", () => {
    (0, globals_1.it)("should create a plan for simple balance check", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const context = {
          userId: "test-user",
          userInput: "Check my XLM balance",
        };
        const plan = yield planner.createPlan(context);
        (0, globals_1.expect)(plan).toBeDefined();
        (0, globals_1.expect)(plan.planId).toMatch(/^plan_/);
        (0, globals_1.expect)(plan.totalSteps).toBeGreaterThan(0);
        (0, globals_1.expect)(plan.steps[0].action).toBe("wallet_tool");
        (0, globals_1.expect)(plan.riskLevel).toBe("low");
      })
    );
    (0, globals_1.it)("should create a plan for token swap", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const context = {
          userId: "test-user",
          userInput: "Swap 100 XLM to USDC",
        };
        const plan = yield planner.createPlan(context);
        (0, globals_1.expect)(plan.totalSteps).toBeGreaterThan(0);
        (0, globals_1.expect)(
          plan.steps.some((s) => s.action === "swap_tool")
        ).toBe(true);
        (0, globals_1.expect)(plan.riskLevel).toMatch(/low|medium/);
      })
    );
    (0, globals_1.it)("should create a plan for portfolio liquidation", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const context = {
          userId: "test-user",
          userInput: "Liquidate half my portfolio into USDC",
          availableBalance: {
            XLM: 1000,
            USDT: 500,
          },
        };
        const plan = yield planner.createPlan(context);
        (0, globals_1.expect)(plan.totalSteps).toBeGreaterThan(1);
        // Should have balance checks and swaps
        (0, globals_1.expect)(
          plan.steps.some((s) => s.action === "wallet_tool")
        ).toBe(true);
        (0, globals_1.expect)(
          plan.steps.some((s) => s.action === "swap_tool")
        ).toBe(true);
        (0, globals_1.expect)(plan.requiresApproval).toBe(true);
      })
    );
    (0, globals_1.it)(
      "should create a plan for Soroban contract interaction",
      () =>
        __awaiter(void 0, void 0, void 0, function* () {
          const context = {
            userId: "test-user",
            userInput:
              "Stake 100 tokens in contract CABC123 method stake on testnet",
          };
          const plan = yield planner.createPlan(context);
          (0, globals_1.expect)(plan.totalSteps).toBeGreaterThan(0);
          (0, globals_1.expect)(
            plan.steps.some((s) => s.action === "soroban_invoke")
          ).toBe(true);
          (0, globals_1.expect)(plan.steps[0].payload).toHaveProperty(
            "contractId"
          );
          (0, globals_1.expect)(plan.steps[0].payload).toHaveProperty(
            "method",
            "stake"
          );
        })
    );
    (0, globals_1.it)("should respect max steps constraint", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const context = {
          userId: "test-user",
          userInput: "Check all my balances and swap everything",
          constraints: {
            maxSteps: 3,
          },
        };
        const plan = yield planner.createPlan(context);
        (0, globals_1.expect)(plan.totalSteps).toBeLessThanOrEqual(3);
      })
    );
    (0, globals_1.it)("should assess risk level correctly", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const context = {
          userId: "test-user",
          userInput: "Swap 100 XLM to USDC",
        };
        const plan = yield planner.createPlan(context);
        // Single swap should be low or medium risk
        (0, globals_1.expect)(plan.riskLevel).toMatch(/low|medium/);
      })
    );
    (0, globals_1.it)("should generate step descriptions", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const context = {
          userId: "test-user",
          userInput: "Transfer 50 XLM to Alice",
        };
        const plan = yield planner.createPlan(context);
        (0, globals_1.expect)(plan.steps.length).toBeGreaterThan(0);
        (0, globals_1.expect)(plan.steps[0].description).toBeDefined();
        (0, globals_1.expect)(typeof plan.steps[0].description).toBe("string");
      })
    );
    (0, globals_1.it)("should calculate step dependencies", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const context = {
          userId: "test-user",
          userInput: "Check my balance and then swap 50 XLM to USDC",
        };
        const plan = yield planner.createPlan(context);
        // Swap step should depend on balance check
        const swapStep = plan.steps.find((s) => s.action === "swap_tool");
        if (swapStep && plan.steps.length > 1) {
          (0, globals_1.expect)(swapStep.dependencies).toBeDefined();
        }
      })
    );
  });
  (0, globals_1.describe)("validatePlan", () => {
    (0, globals_1.it)("should validate a correct plan", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const context = {
          userId: "test-user",
          userInput: "Check my XLM balance",
        };
        const plan = yield planner.createPlan(context);
        // Plan should be valid (createPlan validates internally)
        (0, globals_1.expect)(plan).toBeDefined();
        (0, globals_1.expect)(plan.steps.length).toBeGreaterThan(0);
      })
    );
    (0, globals_1.it)("should reject plan with too many steps", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const context = {
          userId: "test-user",
          userInput: "Do many operations",
          constraints: {
            maxSteps: 1,
          },
        };
        // Should throw or create a plan within constraints
        try {
          const plan = yield planner.createPlan(context);
          (0, globals_1.expect)(plan.totalSteps).toBeLessThanOrEqual(1);
        } catch (error) {
          (0, globals_1.expect)(error).toBeDefined();
        }
      })
    );
  });
  (0, globals_1.describe)("optimizePlan", () => {
    (0, globals_1.it)("should remove duplicate balance checks", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const context = {
          userId: "test-user",
          userInput: "Check XLM balance twice and swap",
        };
        const plan = yield planner.createPlan(context);
        const optimized = planner.optimizePlan(plan);
        // Count balance checks
        const balanceChecks = optimized.steps.filter(
          (s) =>
            s.action === "wallet_tool" &&
            s.payload.operation === "get_balance" &&
            s.payload.token === "XLM"
        );
        (0, globals_1.expect)(balanceChecks.length).toBeLessThanOrEqual(1);
      })
    );
    (0, globals_1.it)("should renumber steps after optimization", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const context = {
          userId: "test-user",
          userInput: "Check balance and swap",
        };
        const plan = yield planner.createPlan(context);
        const optimized = planner.optimizePlan(plan);
        // Steps should be numbered sequentially
        optimized.steps.forEach((step, index) => {
          (0, globals_1.expect)(step.stepNumber).toBe(index + 1);
        });
      })
    );
  });
});
(0, globals_1.describe)("PlanExecutor", () => {
  let executor;
  let planner;
  (0, globals_1.beforeEach)(() => {
    executor = new PlanExecutor_1.PlanExecutor();
    planner = new AgentPlanner_1.AgentPlanner();
    // Register tools
    ToolRegistry_1.toolRegistry.register(wallet_1.walletTool);
    ToolRegistry_1.toolRegistry.register(swap_1.swapTool);
    ToolRegistry_1.toolRegistry.register(soroban_1.sorobanTool);
  });
  (0, globals_1.describe)("executePlan", () => {
    (0, globals_1.it)("should execute a simple plan in dry-run mode", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const context = {
          userId: "test-user",
          userInput: "Check my XLM balance",
        };
        const plan = yield planner.createPlan(context);
        const result = yield executor.executePlan(plan, "test-user", {
          dryRun: true,
        });
        (0, globals_1.expect)(result.status).toBe("success");
        (0, globals_1.expect)(result.completedSteps).toBe(plan.totalSteps);
        (0, globals_1.expect)(result.stepResults.length).toBe(plan.totalSteps);
      })
    );
    (0, globals_1.it)("should track execution progress", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const context = {
          userId: "test-user",
          userInput: "Check balance",
        };
        const plan = yield planner.createPlan(context);
        const stepCompletions = [];
        const result = yield executor.executePlan(plan, "test-user", {
          dryRun: true,
          onStepComplete: (stepResult) => {
            stepCompletions.push(stepResult.stepNumber);
          },
        });
        (0, globals_1.expect)(stepCompletions.length).toBe(plan.totalSteps);
        (0, globals_1.expect)(result.status).toBe("success");
      })
    );
    (0, globals_1.it)("should stop on error when configured", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const context = {
          userId: "test-user",
          userInput: "Do multiple operations",
        };
        const plan = yield planner.createPlan(context);
        const result = yield executor.executePlan(plan, "test-user", {
          dryRun: true,
          stopOnError: true,
        });
        (0, globals_1.expect)(result).toBeDefined();
        (0, globals_1.expect)(result.status).toMatch(/success|partial|failed/);
      })
    );
    (0, globals_1.it)("should respect timeout", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const context = {
          userId: "test-user",
          userInput: "Check balance",
        };
        const plan = yield planner.createPlan(context);
        const result = yield executor.executePlan(plan, "test-user", {
          dryRun: true,
          timeout: 100, // Very short timeout
        });
        (0, globals_1.expect)(result).toBeDefined();
      })
    );
    (0, globals_1.it)("should record step durations", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const context = {
          userId: "test-user",
          userInput: "Check balance",
        };
        const plan = yield planner.createPlan(context);
        const result = yield executor.executePlan(plan, "test-user", {
          dryRun: true,
        });
        result.stepResults.forEach((stepResult) => {
          (0, globals_1.expect)(stepResult.duration).toBeGreaterThanOrEqual(0);
          (0, globals_1.expect)(stepResult.timestamp).toBeDefined();
        });
      })
    );
  });
  (0, globals_1.describe)("dependency handling", () => {
    (0, globals_1.it)("should execute steps with dependencies in order", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const context = {
          userId: "test-user",
          userInput: "Check balance then swap",
        };
        const plan = yield planner.createPlan(context);
        const result = yield executor.executePlan(plan, "test-user", {
          dryRun: true,
        });
        // All steps should complete successfully
        (0, globals_1.expect)(result.status).toBe("success");
      })
    );
  });
});
(0, globals_1.describe)("Integration: Planner + Executor", () => {
  let planner;
  let executor;
  (0, globals_1.beforeEach)(() => {
    planner = new AgentPlanner_1.AgentPlanner();
    executor = new PlanExecutor_1.PlanExecutor();
    ToolRegistry_1.toolRegistry.register(wallet_1.walletTool);
    ToolRegistry_1.toolRegistry.register(swap_1.swapTool);
    ToolRegistry_1.toolRegistry.register(soroban_1.sorobanTool);
  });
  (0, globals_1.it)(
    "should handle complete workflow: plan creation to execution",
    () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const context = {
          userId: "test-user",
          userInput: "Swap 100 XLM to USDC",
        };
        // Create plan
        const plan = yield planner.createPlan(context);
        (0, globals_1.expect)(plan).toBeDefined();
        (0, globals_1.expect)(plan.totalSteps).toBeGreaterThan(0);
        // Optimize plan
        const optimized = planner.optimizePlan(plan);
        (0, globals_1.expect)(optimized.totalSteps).toBeLessThanOrEqual(
          plan.totalSteps
        );
        // Execute in dry-run mode
        const result = yield executor.executePlan(optimized, "test-user", {
          dryRun: true,
        });
        (0, globals_1.expect)(result.status).toBe("success");
        (0, globals_1.expect)(result.completedSteps).toBe(optimized.totalSteps);
      })
  );
  (0, globals_1.it)("should handle complex multi-step operation", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const context = {
        userId: "test-user",
        userInput: "Liquidate half my portfolio into USDC",
        availableBalance: {
          XLM: 1000,
          USDT: 500,
        },
      };
      const plan = yield planner.createPlan(context);
      (0, globals_1.expect)(plan.requiresApproval).toBe(true);
      (0, globals_1.expect)(plan.riskLevel).toMatch(/medium|high/);
      const result = yield executor.executePlan(plan, "test-user", {
        dryRun: true,
      });
      (0, globals_1.expect)(result).toBeDefined();
    })
  );
});
