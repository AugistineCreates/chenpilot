"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REGRESSION_TOLERANCE =
  exports.PERFORMANCE_TEST_CONFIG =
  exports.PERFORMANCE_BASELINES =
    void 0;
/**
 * Performance baseline thresholds for agent operations
 * All values are in milliseconds
 */
exports.PERFORMANCE_BASELINES = {
  // Agent Planning Flow
  agentPlanning: {
    simple: {
      mean: 500,
      p95: 800,
      p99: 1000,
      max: 1500,
    },
    complex: {
      mean: 1500,
      p95: 2500,
      p99: 3000,
      max: 4000,
    },
    withLLM: {
      mean: 3000,
      p95: 5000,
      p99: 6000,
      max: 8000,
    },
  },
  // Agent Execution Flow
  agentExecution: {
    singleStep: {
      mean: 300,
      p95: 500,
      p99: 700,
      max: 1000,
    },
    multiStep: {
      mean: 1000,
      p95: 1500,
      p99: 2000,
      max: 3000,
    },
    withToolExecution: {
      mean: 2000,
      p95: 3500,
      p99: 4500,
      max: 6000,
    },
  },
  // Tool Execution
  toolExecution: {
    lightweight: {
      mean: 100,
      p95: 200,
      p99: 300,
      max: 500,
    },
    standard: {
      mean: 500,
      p95: 800,
      p99: 1000,
      max: 1500,
    },
    heavy: {
      mean: 2000,
      p95: 3000,
      p99: 4000,
      max: 5000,
    },
  },
  // LLM Operations
  llmOperations: {
    simple: {
      mean: 2000,
      p95: 3500,
      p99: 4500,
      max: 6000,
    },
    complex: {
      mean: 4000,
      p95: 6000,
      p99: 7500,
      max: 10000,
    },
  },
  // End-to-End Workflows
  endToEnd: {
    simpleWorkflow: {
      mean: 3000,
      p95: 5000,
      p99: 6500,
      max: 8000,
    },
    complexWorkflow: {
      mean: 8000,
      p95: 12000,
      p99: 15000,
      max: 20000,
    },
  },
};
/**
 * Performance test configuration
 */
exports.PERFORMANCE_TEST_CONFIG = {
  defaultIterations: 10,
  warmupIterations: 2,
  delayBetweenTests: 500, // ms
  collectMemoryMetrics: true,
  enableGarbageCollection: true,
};
/**
 * Regression tolerance (percentage)
 * If performance degrades by more than this percentage, test fails
 */
exports.REGRESSION_TOLERANCE = {
  mean: 10, // 10% slower than baseline
  p95: 15, // 15% slower than baseline
  p99: 20, // 20% slower than baseline
};
