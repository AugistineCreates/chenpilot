import { AgentPlanner } from "../../src/Agents/planner/AgentPlanner";
import { agentLLM } from "../../src/Agents/agent";
import { performanceTestRunner } from "./utils/PerformanceTestRunner";
import {
  PERFORMANCE_BASELINES,
  PERFORMANCE_TEST_CONFIG,
} from "./config/performanceBaselines";
import { PLANNING_DATASETS } from "./fixtures/benchmarkDatasets";
import { trendRecorder } from "./utils/TrendRecorder";

jest.mock("../../src/Agents/agent");
jest.mock("../../src/config/logger");

describe("Agent Planning Flow Benchmarks & Regression Budgets", () => {
  let agentPlanner: AgentPlanner;

  beforeAll(() => {
    agentPlanner = new AgentPlanner();
    performanceTestRunner.clear();
  });

  afterAll(() => {
    const report = performanceTestRunner.generateReport();
    console.log("\n" + report);
    trendRecorder.saveReport(performanceTestRunner.getResults());
  });

  describe("Simple Planning Operations", () => {
    it("should create simple plan within regression latency & CPU budgets", async () => {
      agentLLM.callLLM = jest
        .fn()
        .mockResolvedValue(PLANNING_DATASETS.simple.mockLLMResponse);

      const result = await performanceTestRunner.runTest(
        "Planning: Simple Plan Creation",
        async () => {
          await agentPlanner.createPlan({
            userId: PLANNING_DATASETS.simple.userId,
            userInput: PLANNING_DATASETS.simple.userInput,
          });
        },
        {
          iterations: PERFORMANCE_TEST_CONFIG.defaultIterations,
          warmupIterations: PERFORMANCE_TEST_CONFIG.warmupIterations,
          threshold: PERFORMANCE_BASELINES.agentPlanning.simple,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.p95).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.agentPlanning.simple.p95!
      );
      expect(result.statistics.p99).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.agentPlanning.simple.p99!
      );
    });

    it("should parse Soroban intents within regression latency & CPU budgets", async () => {
      agentLLM.callLLM = jest
        .fn()
        .mockResolvedValue(PLANNING_DATASETS.sorobanIntent.mockLLMResponse);

      const result = await performanceTestRunner.runTest(
        "Planning: Soroban Intent Parsing",
        async () => {
          await agentPlanner.createPlan({
            userId: PLANNING_DATASETS.sorobanIntent.userId,
            userInput: PLANNING_DATASETS.sorobanIntent.userInput,
          });
        },
        {
          iterations: PERFORMANCE_TEST_CONFIG.defaultIterations,
          warmupIterations: PERFORMANCE_TEST_CONFIG.warmupIterations,
          threshold: PERFORMANCE_BASELINES.agentPlanning.sorobanIntent,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.p95).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.agentPlanning.sorobanIntent.p95!
      );
    });
  });

  describe("Complex Multi-Step Planning Operations", () => {
    it("should create complex multi-step plan within budget", async () => {
      agentLLM.callLLM = jest
        .fn()
        .mockResolvedValue(PLANNING_DATASETS.complex.mockLLMResponse);

      const result = await performanceTestRunner.runTest(
        "Planning: Complex Multi-Step Plan",
        async () => {
          await agentPlanner.createPlan({
            userId: PLANNING_DATASETS.complex.userId,
            userInput: PLANNING_DATASETS.complex.userInput,
          });
        },
        {
          iterations: PERFORMANCE_TEST_CONFIG.defaultIterations,
          warmupIterations: PERFORMANCE_TEST_CONFIG.warmupIterations,
          threshold: PERFORMANCE_BASELINES.agentPlanning.complex,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.p95).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.agentPlanning.complex.p95!
      );
    });

    it("should optimize plans within tight latency and CPU budget", async () => {
      const mockPlan = JSON.parse(
        JSON.stringify(PLANNING_DATASETS.planForOptimization)
      );

      const result = await performanceTestRunner.runTest(
        "Planning: Plan Optimization",
        () => {
          agentPlanner.optimizePlan(mockPlan);
        },
        {
          iterations: 30,
          warmupIterations: 5,
          threshold: PERFORMANCE_BASELINES.agentPlanning.optimize,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.p95).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.agentPlanning.optimize.p95!
      );
    });

    it("should validate plans within tight latency and CPU budget", async () => {
      const mockPlan = JSON.parse(
        JSON.stringify(PLANNING_DATASETS.planForValidation)
      );

      const result = await performanceTestRunner.runTest(
        "Planning: Plan Validation",
        () => {
          (agentPlanner as unknown as Record<string, unknown>).validatePlan?.(
            mockPlan
          );
        },
        {
          iterations: 30,
          warmupIterations: 5,
          threshold: PERFORMANCE_BASELINES.agentPlanning.validate,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.p95).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.agentPlanning.validate.p95!
      );
    });
  });

  describe("Concurrent Planning Operations", () => {
    it("should handle concurrent plan creation within budget", async () => {
      agentLLM.callLLM = jest
        .fn()
        .mockResolvedValue(PLANNING_DATASETS.simple.mockLLMResponse);

      const result = await performanceTestRunner.runTest(
        "Planning: Concurrent Plan Creation (x3)",
        async () => {
          await Promise.all([
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
        },
        {
          iterations: 10,
          warmupIterations: 2,
          threshold: PERFORMANCE_BASELINES.agentPlanning.concurrent,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.p95).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.agentPlanning.concurrent.p95!
      );
    });
  });

  describe("Memory & Allocation Integrity", () => {
    it("should not leak memory during repeated planning cycles", async () => {
      agentLLM.callLLM = jest
        .fn()
        .mockResolvedValue(PLANNING_DATASETS.simple.mockLLMResponse);

      const initialMemory = process.memoryUsage().heapUsed;

      for (let i = 0; i < 50; i++) {
        await agentPlanner.createPlan({
          userId: `test-user-${i}`,
          userInput: "Check my balance",
        });
      }

      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncreaseMB = (finalMemory - initialMemory) / 1024 / 1024;

      expect(memoryIncreaseMB).toBeLessThan(30);
    });
  });
});
