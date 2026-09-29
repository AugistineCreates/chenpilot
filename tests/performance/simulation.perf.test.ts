import { simulate } from "../../src/services/soroban/simulator";
import { SimulationEngine } from "../../src/simulation/SimulationEngine";
import { GasSimulator } from "../../src/simulation/GasSimulator";
import * as sdkAdapter from "../../src/services/soroban/sdkAdapter";
import { performanceTestRunner } from "./utils/PerformanceTestRunner";
import {
  PERFORMANCE_BASELINES,
  PERFORMANCE_TEST_CONFIG,
} from "./config/performanceBaselines";
import { SIMULATION_DATASETS } from "./fixtures/benchmarkDatasets";
import { trendRecorder } from "./utils/TrendRecorder";
import { SeededRNG } from "../../src/simulation/SeededRNG";

jest.mock("../../src/config/logger");

describe("Simulation Flow Benchmarks & Regression Budgets", () => {
  let simulationEngine: SimulationEngine;
  let gasSimulator: GasSimulator;

  beforeAll(async () => {
    performanceTestRunner.clear();

    // Mock RPC server factory to return fixed deterministic simulation response
    jest.spyOn(sdkAdapter, "buildRpcServer").mockReturnValue({
      simulateTransaction: jest
        .fn()
        .mockResolvedValue(SIMULATION_DATASETS.mockRpcSimulationSuccess),
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 123456 }),
      getLedgerEntries: jest.fn().mockResolvedValue({ entries: [] }),
    });

    // Initialize SimulationEngine in local mode
    simulationEngine = new SimulationEngine();
    await simulationEngine.initialize({
      mode: "local",
      enabledServices: ["soroban", "wallet", "swap"],
      deterministicSeed: 42,
      simulation: {
        latency: { baseDelay: 0, variability: 0 },
        failureRate: 0,
        gasMultiplier: 1.0,
      },
    });

    gasSimulator = new GasSimulator();
    await gasSimulator.initialize({
      mode: "local",
      enabledServices: ["soroban", "wallet", "swap"],
      deterministicSeed: 42,
      simulation: {
        latency: { baseDelay: 0, variability: 0 },
        failureRate: 0,
        gasMultiplier: 1.0,
      },
    });
  });

  afterAll(() => {
    const report = performanceTestRunner.generateReport();
    console.log("\n" + report);
    trendRecorder.saveReport(performanceTestRunner.getResults());
    jest.restoreAllMocks();
  });

  describe("Soroban RPC Simulation", () => {
    it("should simulate simple contract call within regression budget", async () => {
      const result = await performanceTestRunner.runTest(
        "Simulation: Soroban Simple Contract Call",
        async () => {
          await simulate(SIMULATION_DATASETS.simpleContractCall);
        },
        {
          iterations: PERFORMANCE_TEST_CONFIG.defaultIterations,
          warmupIterations: PERFORMANCE_TEST_CONFIG.warmupIterations,
          threshold: PERFORMANCE_BASELINES.simulation.sorobanSimple,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.p95).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.simulation.sorobanSimple.p95!
      );
      expect(result.statistics.p99).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.simulation.sorobanSimple.p99!
      );
    });

    it("should simulate complex contract call with resource parsing within budget", async () => {
      const result = await performanceTestRunner.runTest(
        "Simulation: Soroban Complex Contract Call",
        async () => {
          await simulate(SIMULATION_DATASETS.complexContractCall);
        },
        {
          iterations: PERFORMANCE_TEST_CONFIG.defaultIterations,
          warmupIterations: PERFORMANCE_TEST_CONFIG.warmupIterations,
          threshold: PERFORMANCE_BASELINES.simulation.sorobanComplex,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.p95).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.simulation.sorobanComplex.p95!
      );
    });
  });

  describe("SimulationEngine Flow", () => {
    it("should process simulation engine requests within budget", async () => {
      const result = await performanceTestRunner.runTest(
        "Simulation: SimulationEngine Request Processing",
        async () => {
          await simulationEngine.processRequest(
            SIMULATION_DATASETS.simulationEngineRequest
          );
        },
        {
          iterations: PERFORMANCE_TEST_CONFIG.defaultIterations,
          warmupIterations: PERFORMANCE_TEST_CONFIG.warmupIterations,
          threshold: PERFORMANCE_BASELINES.simulation.simulationEngineRequest,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.p95).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.simulation.simulationEngineRequest.p95!
      );
    });

    it("should estimate gas deterministically within tight budget", async () => {
      const rng = new SeededRNG(12345);
      const result = await performanceTestRunner.runTest(
        "Simulation: Gas Estimation",
        async () => {
          await gasSimulator.estimateGas(
            {
              service: "soroban",
              operation: "invoke",
              parameters: { contractId: "C123", amount: "500" },
            },
            rng
          );
        },
        {
          iterations: 30,
          warmupIterations: 5,
          threshold: PERFORMANCE_BASELINES.simulation.gasEstimation,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.p95).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.simulation.gasEstimation.p95!
      );
    });
  });
});
