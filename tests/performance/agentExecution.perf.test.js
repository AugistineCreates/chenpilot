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
const PlanExecutor_1 = require("../../src/Agents/planner/PlanExecutor");
const ToolRegistry_1 = require("../../src/Agents/registry/ToolRegistry");
const PerformanceTestRunner_1 = require("./utils/PerformanceTestRunner");
const performanceBaselines_1 = require("./config/performanceBaselines");
jest.mock("../../src/Agents/registry/ToolRegistry");
jest.mock("../../src/config/logger");
describe("Agent Execution Performance Tests", () => {
  let planExecutor;
  beforeAll(() => {
    planExecutor = new PlanExecutor_1.PlanExecutor();
    PerformanceTestRunner_1.performanceTestRunner.clear();
  });
  afterAll(() => {
    const report =
      PerformanceTestRunner_1.performanceTestRunner.generateReport();
    console.log("\n" + report);
  });
  describe("Single Step Execution", () => {
    it("should execute single step plan within performance threshold", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockExecuteTool = jest.fn().mockResolvedValue({
          action: "get_balance",
          status: "success",
          data: { balance: 1000 },
        });
        ToolRegistry_1.toolRegistry.executeTool = mockExecuteTool;
        const plan = {
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
        const result =
          yield PerformanceTestRunner_1.performanceTestRunner.runTest(
            "Single Step Execution",
            () =>
              __awaiter(void 0, void 0, void 0, function* () {
                yield planExecutor.executePlan(plan, "test-user");
              }),
            {
              iterations:
                performanceBaselines_1.PERFORMANCE_TEST_CONFIG
                  .defaultIterations,
              warmupIterations:
                performanceBaselines_1.PERFORMANCE_TEST_CONFIG.warmupIterations,
              threshold:
                performanceBaselines_1.PERFORMANCE_BASELINES.agentExecution
                  .singleStep,
            }
          );
        expect(result.passed).toBe(true);
        expect(result.statistics.mean).toBeLessThan(
          performanceBaselines_1.PERFORMANCE_BASELINES.agentExecution.singleStep
            .mean
        );
      }));
    it("should handle tool execution errors efficiently", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockExecuteTool = jest
          .fn()
          .mockRejectedValue(new Error("Tool failed"));
        ToolRegistry_1.toolRegistry.executeTool = mockExecuteTool;
        const plan = {
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
        const result =
          yield PerformanceTestRunner_1.performanceTestRunner.runTest(
            "Error Handling Performance",
            () =>
              __awaiter(void 0, void 0, void 0, function* () {
                yield planExecutor.executePlan(plan, "test-user");
              }),
            {
              iterations:
                performanceBaselines_1.PERFORMANCE_TEST_CONFIG
                  .defaultIterations,
              warmupIterations:
                performanceBaselines_1.PERFORMANCE_TEST_CONFIG.warmupIterations,
              threshold:
                performanceBaselines_1.PERFORMANCE_BASELINES.agentExecution
                  .singleStep,
            }
          );
        expect(result.passed).toBe(true);
      }));
  });
  describe("Multi-Step Execution", () => {
    it("should execute multi-step plan within performance threshold", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockExecuteTool = jest.fn().mockResolvedValue({
          action: "test_action",
          status: "success",
          data: {},
        });
        ToolRegistry_1.toolRegistry.executeTool = mockExecuteTool;
        const plan = {
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
          requiresApproval: true,
          summary: "Multi-step workflow",
        };
        const result =
          yield PerformanceTestRunner_1.performanceTestRunner.runTest(
            "Multi-Step Execution",
            () =>
              __awaiter(void 0, void 0, void 0, function* () {
                yield planExecutor.executePlan(plan, "test-user");
              }),
            {
              iterations:
                performanceBaselines_1.PERFORMANCE_TEST_CONFIG
                  .defaultIterations,
              warmupIterations:
                performanceBaselines_1.PERFORMANCE_TEST_CONFIG.warmupIterations,
              threshold:
                performanceBaselines_1.PERFORMANCE_BASELINES.agentExecution
                  .multiStep,
            }
          );
        expect(result.passed).toBe(true);
      }));
    it("should handle partial execution efficiently", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockExecuteTool = jest
          .fn()
          .mockResolvedValueOnce({
            action: "step1",
            status: "success",
            data: {},
          })
          .mockRejectedValueOnce(new Error("Step 2 failed"))
          .mockResolvedValueOnce({
            action: "step3",
            status: "success",
            data: {},
          });
        ToolRegistry_1.toolRegistry.executeTool = mockExecuteTool;
        const plan = {
          planId: "test-plan-partial",
          steps: [
            {
              stepNumber: 1,
              action: "step1",
              payload: {},
              description: "Step 1",
            },
            {
              stepNumber: 2,
              action: "step2",
              payload: {},
              description: "Step 2",
            },
            {
              stepNumber: 3,
              action: "step3",
              payload: {},
              description: "Step 3",
            },
          ],
          totalSteps: 3,
          estimatedDuration: 9000,
          riskLevel: "medium",
          requiresApproval: false,
          summary: "Partial execution test",
        };
        const result =
          yield PerformanceTestRunner_1.performanceTestRunner.runTest(
            "Partial Execution Performance",
            () =>
              __awaiter(void 0, void 0, void 0, function* () {
                yield planExecutor.executePlan(plan, "test-user", {
                  stopOnError: true,
                });
              }),
            {
              iterations:
                performanceBaselines_1.PERFORMANCE_TEST_CONFIG
                  .defaultIterations,
              warmupIterations:
                performanceBaselines_1.PERFORMANCE_TEST_CONFIG.warmupIterations,
              threshold:
                performanceBaselines_1.PERFORMANCE_BASELINES.agentExecution
                  .multiStep,
            }
          );
        expect(result.passed).toBe(true);
      }));
  });
  describe("Execution with Tool Integration", () => {
    it("should execute plan with realistic tool delays", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockExecuteTool = jest.fn().mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    action: "test_action",
                    status: "success",
                    data: {},
                  }),
                50
              )
            )
        );
        ToolRegistry_1.toolRegistry.executeTool = mockExecuteTool;
        const plan = {
          planId: "test-plan-realistic",
          steps: [
            {
              stepNumber: 1,
              action: "action1",
              payload: {},
              description: "Action 1",
            },
            {
              stepNumber: 2,
              action: "action2",
              payload: {},
              description: "Action 2",
            },
          ],
          totalSteps: 2,
          estimatedDuration: 6000,
          riskLevel: "low",
          requiresApproval: false,
          summary: "Realistic execution test",
        };
        const result =
          yield PerformanceTestRunner_1.performanceTestRunner.runTest(
            "Execution with Tool Delays",
            () =>
              __awaiter(void 0, void 0, void 0, function* () {
                yield planExecutor.executePlan(plan, "test-user");
              }),
            {
              iterations: 5,
              warmupIterations: 1,
              threshold:
                performanceBaselines_1.PERFORMANCE_BASELINES.agentExecution
                  .withToolExecution,
            }
          );
        expect(result.passed).toBe(true);
      }));
  });
  describe("Dry Run Performance", () => {
    it("should execute dry run efficiently", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const plan = {
          planId: "test-plan-dryrun",
          steps: Array.from({ length: 5 }, (_, i) => ({
            stepNumber: i + 1,
            action: `action${i + 1}`,
            payload: {},
            description: `Action ${i + 1}`,
          })),
          totalSteps: 5,
          estimatedDuration: 15000,
          riskLevel: "medium",
          requiresApproval: false,
          summary: "Dry run test",
        };
        const result =
          yield PerformanceTestRunner_1.performanceTestRunner.runTest(
            "Dry Run Execution",
            () =>
              __awaiter(void 0, void 0, void 0, function* () {
                yield planExecutor.executePlan(plan, "test-user", {
                  dryRun: true,
                });
              }),
            {
              iterations: 20,
              warmupIterations: 3,
              threshold: {
                mean: 100,
                p95: 200,
                max: 300,
              },
            }
          );
        expect(result.passed).toBe(true);
      }));
  });
  describe("Concurrent Execution", () => {
    it("should handle concurrent plan executions efficiently", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockExecuteTool = jest.fn().mockResolvedValue({
          action: "test_action",
          status: "success",
          data: {},
        });
        ToolRegistry_1.toolRegistry.executeTool = mockExecuteTool;
        const createPlan = (id) => ({
          planId: `concurrent-plan-${id}`,
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
          summary: `Concurrent test ${id}`,
        });
        const result =
          yield PerformanceTestRunner_1.performanceTestRunner.runTest(
            "Concurrent Plan Execution",
            () =>
              __awaiter(void 0, void 0, void 0, function* () {
                yield Promise.all([
                  planExecutor.executePlan(createPlan(1), "user-1"),
                  planExecutor.executePlan(createPlan(2), "user-2"),
                  planExecutor.executePlan(createPlan(3), "user-3"),
                ]);
              }),
            {
              iterations: 5,
              warmupIterations: 1,
              threshold: {
                mean: 1000,
                p95: 1500,
                max: 2000,
              },
            }
          );
        expect(result.passed).toBe(true);
      }));
  });
  describe("Execution Callbacks Performance", () => {
    it("should handle step callbacks without significant overhead", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockExecuteTool = jest.fn().mockResolvedValue({
          action: "test_action",
          status: "success",
          data: {},
        });
        ToolRegistry_1.toolRegistry.executeTool = mockExecuteTool;
        const onStepStart = jest.fn();
        const onStepComplete = jest.fn();
        const plan = {
          planId: "test-plan-callbacks",
          steps: Array.from({ length: 3 }, (_, i) => ({
            stepNumber: i + 1,
            action: `action${i + 1}`,
            payload: {},
            description: `Action ${i + 1}`,
          })),
          totalSteps: 3,
          estimatedDuration: 9000,
          riskLevel: "low",
          requiresApproval: false,
          summary: "Callback test",
        };
        const result =
          yield PerformanceTestRunner_1.performanceTestRunner.runTest(
            "Execution with Callbacks",
            () =>
              __awaiter(void 0, void 0, void 0, function* () {
                yield planExecutor.executePlan(plan, "test-user", {
                  onStepStart,
                  onStepComplete,
                });
              }),
            {
              iterations:
                performanceBaselines_1.PERFORMANCE_TEST_CONFIG
                  .defaultIterations,
              warmupIterations:
                performanceBaselines_1.PERFORMANCE_TEST_CONFIG.warmupIterations,
              threshold:
                performanceBaselines_1.PERFORMANCE_BASELINES.agentExecution
                  .multiStep,
            }
          );
        expect(result.passed).toBe(true);
      }));
  });
  describe("Memory Usage During Execution", () => {
    it("should not leak memory during repeated executions", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockExecuteTool = jest.fn().mockResolvedValue({
          action: "test_action",
          status: "success",
          data: { result: "test" },
        });
        ToolRegistry_1.toolRegistry.executeTool = mockExecuteTool;
        const plan = {
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
        for (let i = 0; i < 100; i++) {
          yield planExecutor.executePlan(plan, `test-user-${i}`);
        }
        if (global.gc) {
          global.gc();
        }
        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = finalMemory - initialMemory;
        const memoryIncreaseMB = memoryIncrease / 1024 / 1024;
        // Memory increase should be reasonable (less than 50MB for 100 operations)
        expect(memoryIncreaseMB).toBeLessThan(50);
      }));
  });
  describe("Large Plan Execution", () => {
    it("should handle large plans efficiently", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockExecuteTool = jest.fn().mockResolvedValue({
          action: "test_action",
          status: "success",
          data: {},
        });
        ToolRegistry_1.toolRegistry.executeTool = mockExecuteTool;
        const plan = {
          planId: "large-plan",
          steps: Array.from({ length: 10 }, (_, i) => ({
            stepNumber: i + 1,
            action: `action${i + 1}`,
            payload: { data: `test-${i}` },
            description: `Action ${i + 1}`,
          })),
          totalSteps: 10,
          estimatedDuration: 30000,
          riskLevel: "high",
          requiresApproval: true,
          summary: "Large plan test",
        };
        const result =
          yield PerformanceTestRunner_1.performanceTestRunner.runTest(
            "Large Plan Execution",
            () =>
              __awaiter(void 0, void 0, void 0, function* () {
                yield planExecutor.executePlan(plan, "test-user");
              }),
            {
              iterations: 3,
              warmupIterations: 1,
              threshold: {
                mean: 3000,
                p95: 4500,
                max: 6000,
              },
            }
          );
        expect(result.passed).toBe(true);
      }));
  });
});
