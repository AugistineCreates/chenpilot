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
const AgentPlanner_1 = require("../../src/Agents/planner/AgentPlanner");
const agent_1 = require("../../src/Agents/agent");
const PerformanceTestRunner_1 = require("./utils/PerformanceTestRunner");
const performanceBaselines_1 = require("./config/performanceBaselines");
jest.mock("../../src/Agents/agent");
jest.mock("../../src/config/logger");
describe("Agent Planning Performance Tests", () => {
  let agentPlanner;
  beforeAll(() => {
    agentPlanner = new AgentPlanner_1.AgentPlanner();
    PerformanceTestRunner_1.performanceTestRunner.clear();
  });
  afterAll(() => {
    const report =
      PerformanceTestRunner_1.performanceTestRunner.generateReport();
    console.log("\n" + report);
  });
  describe("Simple Planning Operations", () => {
    it("should create simple plan within performance threshold", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockLLMResponse = {
          workflow: [
            {
              action: "get_balance",
              payload: { asset: "XLM" },
            },
          ],
        };
        agent_1.agentLLM.callLLM = jest.fn().mockResolvedValue(mockLLMResponse);
        const result =
          yield PerformanceTestRunner_1.performanceTestRunner.runTest(
            "Simple Plan Creation",
            () =>
              __awaiter(void 0, void 0, void 0, function* () {
                yield agentPlanner.createPlan({
                  userId: "test-user",
                  userInput: "Check my XLM balance",
                });
              }),
            {
              iterations:
                performanceBaselines_1.PERFORMANCE_TEST_CONFIG
                  .defaultIterations,
              warmupIterations:
                performanceBaselines_1.PERFORMANCE_TEST_CONFIG.warmupIterations,
              threshold:
                performanceBaselines_1.PERFORMANCE_BASELINES.agentPlanning
                  .simple,
            }
          );
        expect(result.passed).toBe(true);
        expect(result.statistics.mean).toBeLessThan(
          performanceBaselines_1.PERFORMANCE_BASELINES.agentPlanning.simple.mean
        );
      }));
    it("should handle Soroban intent parsing efficiently", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const result =
          yield PerformanceTestRunner_1.performanceTestRunner.runTest(
            "Soroban Intent Parsing",
            () =>
              __awaiter(void 0, void 0, void 0, function* () {
                yield agentPlanner.createPlan({
                  userId: "test-user",
                  userInput: "swap 100 XLM to USDC",
                });
              }),
            {
              iterations:
                performanceBaselines_1.PERFORMANCE_TEST_CONFIG
                  .defaultIterations,
              warmupIterations:
                performanceBaselines_1.PERFORMANCE_TEST_CONFIG.warmupIterations,
              threshold:
                performanceBaselines_1.PERFORMANCE_BASELINES.agentPlanning
                  .simple,
            }
          );
        expect(result.passed).toBe(true);
      }));
  });
  describe("Complex Planning Operations", () => {
    it("should create multi-step plan within performance threshold", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockLLMResponse = {
          workflow: [
            { action: "get_balance", payload: { asset: "XLM" } },
            {
              action: "swap_tool",
              payload: { from: "XLM", to: "USDC", amount: 100 },
            },
            {
              action: "transfer",
              payload: { to: "recipient", amount: 50, asset: "USDC" },
            },
          ],
        };
        agent_1.agentLLM.callLLM = jest.fn().mockResolvedValue(mockLLMResponse);
        const result =
          yield PerformanceTestRunner_1.performanceTestRunner.runTest(
            "Complex Multi-Step Plan Creation",
            () =>
              __awaiter(void 0, void 0, void 0, function* () {
                yield agentPlanner.createPlan({
                  userId: "test-user",
                  userInput:
                    "Swap 100 XLM to USDC and send 50 USDC to recipient",
                });
              }),
            {
              iterations:
                performanceBaselines_1.PERFORMANCE_TEST_CONFIG
                  .defaultIterations,
              warmupIterations:
                performanceBaselines_1.PERFORMANCE_TEST_CONFIG.warmupIterations,
              threshold:
                performanceBaselines_1.PERFORMANCE_BASELINES.agentPlanning
                  .complex,
            }
          );
        expect(result.passed).toBe(true);
      }));
    it("should optimize plan efficiently", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockPlan = {
          planId: "test-plan",
          steps: [
            {
              stepNumber: 1,
              action: "swap_tool",
              payload: { from: "XLM", to: "USDC", amount: 100 },
              description: "Swap XLM to USDC",
            },
          ],
          totalSteps: 1,
          estimatedDuration: 3000,
          riskLevel: "low",
          requiresApproval: false,
          summary: "Test plan",
        };
        const result =
          yield PerformanceTestRunner_1.performanceTestRunner.runTest(
            "Plan Optimization",
            () =>
              __awaiter(void 0, void 0, void 0, function* () {
                agentPlanner.optimizePlan(mockPlan);
              }),
            {
              iterations: 50,
              warmupIterations: 5,
              threshold: {
                mean: 50,
                p95: 100,
                max: 200,
              },
            }
          );
        expect(result.passed).toBe(true);
      }));
  });
  describe("Planning with LLM Integration", () => {
    it("should handle LLM-based planning within threshold", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockLLMResponse = {
          workflow: [
            { action: "get_balance", payload: { asset: "XLM" } },
            {
              action: "swap_tool",
              payload: { from: "XLM", to: "USDC", amount: 100 },
            },
          ],
        };
        agent_1.agentLLM.callLLM = jest
          .fn()
          .mockImplementation(
            () =>
              new Promise((resolve) =>
                setTimeout(() => resolve(mockLLMResponse), 100)
              )
          );
        const result =
          yield PerformanceTestRunner_1.performanceTestRunner.runTest(
            "LLM-Based Planning",
            () =>
              __awaiter(void 0, void 0, void 0, function* () {
                yield agentPlanner.createPlan({
                  userId: "test-user",
                  userInput: "I want to swap some XLM for USDC",
                });
              }),
            {
              iterations: 5,
              warmupIterations: 1,
              threshold:
                performanceBaselines_1.PERFORMANCE_BASELINES.agentPlanning
                  .withLLM,
            }
          );
        expect(result.passed).toBe(true);
      }));
  });
  describe("Plan Validation Performance", () => {
    it("should validate plans quickly", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockPlan = {
          planId: "test-plan",
          steps: Array.from({ length: 5 }, (_, i) => ({
            stepNumber: i + 1,
            action: "test_action",
            payload: { data: "test" },
            description: `Step ${i + 1}`,
          })),
          totalSteps: 5,
          estimatedDuration: 15000,
          riskLevel: "medium",
          requiresApproval: true,
          summary: "Test plan with 5 steps",
        };
        const result =
          yield PerformanceTestRunner_1.performanceTestRunner.runTest(
            "Plan Validation",
            () =>
              __awaiter(void 0, void 0, void 0, function* () {
                var _a, _b;
                // Access private method through type assertion for testing
                (_b = (_a = agentPlanner).validatePlan) === null ||
                _b === void 0
                  ? void 0
                  : _b.call(_a, mockPlan);
              }),
            {
              iterations: 100,
              warmupIterations: 10,
              threshold: {
                mean: 10,
                p95: 20,
                max: 50,
              },
            }
          );
        expect(result.passed).toBe(true);
      }));
  });
  describe("Concurrent Planning Operations", () => {
    it("should handle concurrent plan creation efficiently", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockLLMResponse = {
          workflow: [{ action: "get_balance", payload: { asset: "XLM" } }],
        };
        agent_1.agentLLM.callLLM = jest.fn().mockResolvedValue(mockLLMResponse);
        const result =
          yield PerformanceTestRunner_1.performanceTestRunner.runTest(
            "Concurrent Plan Creation",
            () =>
              __awaiter(void 0, void 0, void 0, function* () {
                yield Promise.all([
                  agentPlanner.createPlan({
                    userId: "user-1",
                    userInput: "Check balance",
                  }),
                  agentPlanner.createPlan({
                    userId: "user-2",
                    userInput: "Check balance",
                  }),
                  agentPlanner.createPlan({
                    userId: "user-3",
                    userInput: "Check balance",
                  }),
                ]);
              }),
            {
              iterations: 5,
              warmupIterations: 1,
              threshold: {
                mean: 1500,
                p95: 2500,
                max: 3500,
              },
            }
          );
        expect(result.passed).toBe(true);
      }));
  });
  describe("Memory Usage", () => {
    it("should not leak memory during repeated planning", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockLLMResponse = {
          workflow: [{ action: "get_balance", payload: { asset: "XLM" } }],
        };
        agent_1.agentLLM.callLLM = jest.fn().mockResolvedValue(mockLLMResponse);
        const initialMemory = process.memoryUsage().heapUsed;
        for (let i = 0; i < 50; i++) {
          yield agentPlanner.createPlan({
            userId: `test-user-${i}`,
            userInput: "Check my balance",
          });
        }
        if (global.gc) {
          global.gc();
        }
        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = finalMemory - initialMemory;
        const memoryIncreaseMB = memoryIncrease / 1024 / 1024;
        // Memory increase should be reasonable (less than 50MB for 50 operations)
        expect(memoryIncreaseMB).toBeLessThan(50);
      }));
  });
});
