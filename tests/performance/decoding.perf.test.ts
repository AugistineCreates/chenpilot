import {
  decodeScVal,
  decodeReturnValue,
} from "../../src/services/soroban/decoder";
import { eventNormalizer } from "../../src/services/stellarIndexer/eventNormalizer";
import { performanceTestRunner } from "./utils/PerformanceTestRunner";
import { PERFORMANCE_BASELINES } from "./config/performanceBaselines";
import { DECODING_DATASETS } from "./fixtures/benchmarkDatasets";
import { trendRecorder } from "./utils/TrendRecorder";
import { SimulationSuccess } from "../../src/services/soroban/sdkAdapter";

describe("Decoding Flow Benchmarks & Regression Budgets", () => {
  beforeAll(() => {
    performanceTestRunner.clear();
  });

  afterAll(() => {
    const report = performanceTestRunner.generateReport();
    console.log("\n" + report);
    trendRecorder.saveReport(performanceTestRunner.getResults());
  });

  describe("ScVal Decoding", () => {
    it("should decode primitive ScVal types within tight latency & CPU budget", async () => {
      const primitives = Object.values(DECODING_DATASETS.primitives);

      const result = await performanceTestRunner.runTest(
        "Decoding: Primitive ScVals Batch (i32, i64, u128, u256, symbol, str, addr)",
        () => {
          for (const val of primitives) {
            decodeScVal(val);
          }
        },
        {
          iterations: 50,
          warmupIterations: 5,
          threshold: PERFORMANCE_BASELINES.decoding.primitiveScVal,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.p95).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.decoding.primitiveScVal.p95!
      );
      expect(result.statistics.p99).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.decoding.primitiveScVal.p99!
      );
    });

    it("should decode complex nested ScVal structures within budget", async () => {
      const complexScVal = DECODING_DATASETS.complexNested;

      const result = await performanceTestRunner.runTest(
        "Decoding: Complex Nested ScVal Structure",
        () => {
          decodeScVal(complexScVal);
        },
        {
          iterations: 50,
          warmupIterations: 5,
          threshold: PERFORMANCE_BASELINES.decoding.complexNestedScVal,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.p95).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.decoding.complexNestedScVal.p95!
      );
    });
  });

  describe("Simulation Result & Event Normalization", () => {
    it("should decode simulation return values within budget", async () => {
      const simResult: SimulationSuccess = {
        result: {
          retval: DECODING_DATASETS.complexNested,
        },
      };

      const result = await performanceTestRunner.runTest(
        "Decoding: Simulation Return Value",
        () => {
          decodeReturnValue(simResult);
        },
        {
          iterations: 50,
          warmupIterations: 5,
          threshold: PERFORMANCE_BASELINES.decoding.simulationReturnValue,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.p95).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.decoding.simulationReturnValue.p95!
      );
    });

    it("should normalize and decode contract events within budget", async () => {
      const rawEvent = DECODING_DATASETS.contractEvent as unknown as Parameters<
        typeof eventNormalizer.normalizeSorobanEvent
      >[0];

      const result = await performanceTestRunner.runTest(
        "Decoding: Contract Event Normalization",
        () => {
          const normalized = eventNormalizer.normalizeSorobanEvent(rawEvent);
          eventNormalizer.extractTransferPayload(normalized);
        },
        {
          iterations: 50,
          warmupIterations: 5,
          threshold: PERFORMANCE_BASELINES.decoding.contractEvent,
        }
      );

      expect(result.passed).toBe(true);
      expect(result.statistics.p95).toBeLessThanOrEqual(
        PERFORMANCE_BASELINES.decoding.contractEvent.p95!
      );
    });
  });
});
