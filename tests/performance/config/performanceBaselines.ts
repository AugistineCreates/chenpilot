import { PerformanceThreshold } from "../utils/PerformanceTestRunner";

/**
 * Regression budget thresholds across all critical execution paths.
 *
 * Each threshold defines:
 * - Latency budgets (mean, median/p50, p95, p99, max in milliseconds)
 * - CPU budgets (maxCpuMs: max CPU time user+sys in milliseconds)
 * - Memory & allocation budgets (maxMemoryDeltaBytes: max heap delta per run, maxAllocationsBytes)
 *
 * NOTE: Any modification to these baseline values requires an entry
 * in `tests/performance/BUDGET_CHANGELOG.md` with explicit reviewed rationale.
 */
export const PERFORMANCE_BASELINES = {
  // ─── 1. Planning Flow ───────────────────────────────────────────────────────
  agentPlanning: {
    simple: {
      mean: 25,
      p95: 50,
      p99: 100,
      max: 200,
      maxCpuMs: 30,
      maxMemoryDeltaBytes: 10 * 1024 * 1024, // 10MB
    } as PerformanceThreshold,
    sorobanIntent: {
      mean: 20,
      p95: 40,
      p99: 80,
      max: 150,
      maxCpuMs: 25,
      maxMemoryDeltaBytes: 10 * 1024 * 1024,
    } as PerformanceThreshold,
    complex: {
      mean: 40,
      p95: 80,
      p99: 150,
      max: 300,
      maxCpuMs: 50,
      maxMemoryDeltaBytes: 15 * 1024 * 1024,
    } as PerformanceThreshold,
    optimize: {
      mean: 10,
      p95: 25,
      p99: 50,
      max: 100,
      maxCpuMs: 15,
      maxMemoryDeltaBytes: 5 * 1024 * 1024,
    } as PerformanceThreshold,
    validate: {
      mean: 10,
      p95: 25,
      p99: 50,
      max: 100,
      maxCpuMs: 15,
      maxMemoryDeltaBytes: 5 * 1024 * 1024,
    } as PerformanceThreshold,
    withLLM: {
      mean: 3000,
      p95: 5000,
      p99: 6000,
      max: 8000,
      maxCpuMs: 500,
      maxMemoryDeltaBytes: 30 * 1024 * 1024,
    } as PerformanceThreshold,
    concurrent: {
      mean: 100,
      p95: 250,
      p99: 400,
      max: 600,
      maxCpuMs: 150,
      maxMemoryDeltaBytes: 25 * 1024 * 1024,
    } as PerformanceThreshold,
  },

  // ─── 2. Execution Flow ──────────────────────────────────────────────────────
  agentExecution: {
    singleStep: {
      mean: 30,
      p95: 60,
      p99: 100,
      max: 200,
      maxCpuMs: 40,
      maxMemoryDeltaBytes: 10 * 1024 * 1024,
    } as PerformanceThreshold,
    multiStep: {
      mean: 80,
      p95: 150,
      p99: 250,
      max: 400,
      maxCpuMs: 100,
      maxMemoryDeltaBytes: 20 * 1024 * 1024,
    } as PerformanceThreshold,
    dryRun: {
      mean: 20,
      p95: 40,
      p99: 80,
      max: 150,
      maxCpuMs: 25,
      maxMemoryDeltaBytes: 8 * 1024 * 1024,
    } as PerformanceThreshold,
    errorHandling: {
      mean: 30,
      p95: 60,
      p99: 100,
      max: 200,
      maxCpuMs: 40,
      maxMemoryDeltaBytes: 10 * 1024 * 1024,
    } as PerformanceThreshold,
    withToolExecution: {
      mean: 2000,
      p95: 3500,
      p99: 4500,
      max: 6000,
      maxCpuMs: 300,
      maxMemoryDeltaBytes: 30 * 1024 * 1024,
    } as PerformanceThreshold,
  },

  // ─── 3. Simulation Flow ─────────────────────────────────────────────────────
  simulation: {
    sorobanSimple: {
      mean: 30,
      p95: 60,
      p99: 100,
      max: 200,
      maxCpuMs: 40,
      maxMemoryDeltaBytes: 10 * 1024 * 1024,
    } as PerformanceThreshold,
    sorobanComplex: {
      mean: 50,
      p95: 100,
      p99: 180,
      max: 300,
      maxCpuMs: 60,
      maxMemoryDeltaBytes: 15 * 1024 * 1024,
    } as PerformanceThreshold,
    simulationEngineRequest: {
      mean: 40,
      p95: 80,
      p99: 150,
      max: 250,
      maxCpuMs: 50,
      maxMemoryDeltaBytes: 12 * 1024 * 1024,
    } as PerformanceThreshold,
    gasEstimation: {
      mean: 15,
      p95: 30,
      p99: 60,
      max: 100,
      maxCpuMs: 20,
      maxMemoryDeltaBytes: 5 * 1024 * 1024,
    } as PerformanceThreshold,
    stateSnapshot: {
      mean: 10,
      p95: 25,
      p99: 50,
      max: 80,
      maxCpuMs: 15,
      maxMemoryDeltaBytes: 5 * 1024 * 1024,
    } as PerformanceThreshold,
  },

  // ─── 4. Decoding Flow ───────────────────────────────────────────────────────
  decoding: {
    primitiveScVal: {
      mean: 5,
      p95: 15,
      p99: 30,
      max: 60,
      maxCpuMs: 10,
      maxMemoryDeltaBytes: 3 * 1024 * 1024,
    } as PerformanceThreshold,
    complexNestedScVal: {
      mean: 15,
      p95: 35,
      p99: 70,
      max: 120,
      maxCpuMs: 20,
      maxMemoryDeltaBytes: 8 * 1024 * 1024,
    } as PerformanceThreshold,
    simulationReturnValue: {
      mean: 10,
      p95: 25,
      p99: 50,
      max: 100,
      maxCpuMs: 15,
      maxMemoryDeltaBytes: 5 * 1024 * 1024,
    } as PerformanceThreshold,
    contractEvent: {
      mean: 12,
      p95: 30,
      p99: 60,
      max: 100,
      maxCpuMs: 18,
      maxMemoryDeltaBytes: 5 * 1024 * 1024,
    } as PerformanceThreshold,
  },

  // ─── 5. Transaction Construction Flow ───────────────────────────────────────
  transactionConstruction: {
    sorobanUnsignedTx: {
      mean: 25,
      p95: 50,
      p99: 90,
      max: 150,
      maxCpuMs: 30,
      maxMemoryDeltaBytes: 8 * 1024 * 1024,
    } as PerformanceThreshold,
    footprintSignedTx: {
      mean: 35,
      p95: 70,
      p99: 120,
      max: 200,
      maxCpuMs: 45,
      maxMemoryDeltaBytes: 12 * 1024 * 1024,
    } as PerformanceThreshold,
    multiOperationTx: {
      mean: 30,
      p95: 60,
      p99: 100,
      max: 180,
      maxCpuMs: 35,
      maxMemoryDeltaBytes: 10 * 1024 * 1024,
    } as PerformanceThreshold,
    swapEnvelope: {
      mean: 40,
      p95: 80,
      p99: 140,
      max: 220,
      maxCpuMs: 50,
      maxMemoryDeltaBytes: 12 * 1024 * 1024,
    } as PerformanceThreshold,
  },
};

/**
 * Performance test configuration defaults
 */
export const PERFORMANCE_TEST_CONFIG = {
  defaultIterations: 20,
  warmupIterations: 3,
  delayBetweenTests: 50, // ms
  collectMemoryMetrics: true,
  collectCpuMetrics: true,
  enableGarbageCollection: true,
};

/**
 * Regression tolerance (percentage above budget)
 */
export const REGRESSION_TOLERANCE = {
  mean: 10, // 10% slower than baseline mean
  p95: 15, // 15% slower than baseline p95
  p99: 20, // 20% slower than baseline p99
  cpu: 25, // 25% more CPU time
  memory: 30, // 30% more memory allocation
};

/**
 * Budget metadata and governance
 */
export const BUDGET_METADATA = {
  version: "1.0.0",
  lastReviewed: "2026-08-30",
  governancePolicy:
    "Explicit rationale in BUDGET_CHANGELOG.md required for modifications.",
};
