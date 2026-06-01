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
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.performanceTestRunner = exports.PerformanceTestRunner = void 0;
const logger_1 = __importDefault(require("../../../src/config/logger"));
class PerformanceTestRunner {
  constructor() {
    this.results = [];
  }
  /**
   * Run a performance test with multiple iterations
   */
  runTest(testName_1, operation_1) {
    return __awaiter(
      this,
      arguments,
      void 0,
      function* (testName, operation, options = {}) {
        const {
          iterations = 10,
          warmupIterations = 2,
          threshold,
          collectMemory = true,
        } = options;
        logger_1.default.info(`Starting performance test: ${testName}`, {
          iterations,
          warmupIterations,
        });
        // Warmup iterations
        for (let i = 0; i < warmupIterations; i++) {
          yield operation();
        }
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
        // Actual test iterations
        const metrics = [];
        for (let i = 0; i < iterations; i++) {
          const startMemory = collectMemory ? process.memoryUsage() : undefined;
          const startTime = performance.now();
          yield operation();
          const duration = performance.now() - startTime;
          const endMemory = collectMemory ? process.memoryUsage() : undefined;
          metrics.push({
            operationName: testName,
            duration,
            timestamp: new Date().toISOString(),
            memoryUsage: endMemory
              ? {
                  heapUsed:
                    endMemory.heapUsed -
                    ((startMemory === null || startMemory === void 0
                      ? void 0
                      : startMemory.heapUsed) || 0),
                  heapTotal: endMemory.heapTotal,
                  external: endMemory.external,
                }
              : undefined,
          });
          // Small delay between iterations
          yield new Promise((resolve) => setTimeout(resolve, 100));
        }
        const statistics = this.calculateStatistics(metrics);
        const { passed, violations } = this.checkThresholds(
          statistics,
          threshold
        );
        const result = {
          testName,
          iterations,
          metrics,
          statistics,
          passed,
          threshold,
          violations,
        };
        this.results.push(result);
        this.logResult(result);
        return result;
      }
    );
  }
  /**
   * Run a single timed operation
   */
  measureOperation(operationName, operation) {
    return __awaiter(this, void 0, void 0, function* () {
      const startTime = performance.now();
      const startMemory = process.memoryUsage();
      const result = yield operation();
      const duration = performance.now() - startTime;
      const endMemory = process.memoryUsage();
      const metrics = {
        operationName,
        duration,
        timestamp: new Date().toISOString(),
        memoryUsage: {
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
          heapTotal: endMemory.heapTotal,
          external: endMemory.external,
        },
      };
      return { result, metrics };
    });
  }
  /**
   * Calculate statistical metrics from performance data
   */
  calculateStatistics(metrics) {
    const durations = metrics.map((m) => m.duration).sort((a, b) => a - b);
    const n = durations.length;
    const min = durations[0];
    const max = durations[n - 1];
    const mean = durations.reduce((a, b) => a + b, 0) / n;
    const median = this.percentile(durations, 50);
    const p95 = this.percentile(durations, 95);
    const p99 = this.percentile(durations, 99);
    // Calculate standard deviation
    const variance =
      durations.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);
    return { min, max, mean, median, p95, p99, stdDev };
  }
  /**
   * Calculate percentile value
   */
  percentile(sortedValues, percentile) {
    const index = (percentile / 100) * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    if (lower === upper) {
      return sortedValues[lower];
    }
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }
  /**
   * Check if performance meets thresholds
   */
  checkThresholds(statistics, threshold) {
    if (!threshold) {
      return { passed: true, violations: [] };
    }
    const violations = [];
    if (threshold.mean && statistics.mean > threshold.mean) {
      violations.push(
        `Mean duration ${statistics.mean.toFixed(2)}ms exceeds threshold ${threshold.mean}ms`
      );
    }
    if (threshold.p50 && statistics.median > threshold.p50) {
      violations.push(
        `P50 duration ${statistics.median.toFixed(2)}ms exceeds threshold ${threshold.p50}ms`
      );
    }
    if (threshold.p95 && statistics.p95 > threshold.p95) {
      violations.push(
        `P95 duration ${statistics.p95.toFixed(2)}ms exceeds threshold ${threshold.p95}ms`
      );
    }
    if (threshold.p99 && statistics.p99 > threshold.p99) {
      violations.push(
        `P99 duration ${statistics.p99.toFixed(2)}ms exceeds threshold ${threshold.p99}ms`
      );
    }
    if (threshold.max && statistics.max > threshold.max) {
      violations.push(
        `Max duration ${statistics.max.toFixed(2)}ms exceeds threshold ${threshold.max}ms`
      );
    }
    return { passed: violations.length === 0, violations };
  }
  /**
   * Log test result
   */
  logResult(result) {
    const { testName, statistics, passed, violations } = result;
    logger_1.default.info(`Performance test completed: ${testName}`, {
      passed,
      statistics: {
        mean: `${statistics.mean.toFixed(2)}ms`,
        median: `${statistics.median.toFixed(2)}ms`,
        p95: `${statistics.p95.toFixed(2)}ms`,
        p99: `${statistics.p99.toFixed(2)}ms`,
        min: `${statistics.min.toFixed(2)}ms`,
        max: `${statistics.max.toFixed(2)}ms`,
      },
    });
    if (!passed && violations) {
      logger_1.default.warn(
        `Performance threshold violations for ${testName}:`,
        {
          violations,
        }
      );
    }
  }
  /**
   * Get all test results
   */
  getResults() {
    return this.results;
  }
  /**
   * Generate performance report
   */
  generateReport() {
    const lines = [
      "=".repeat(80),
      "PERFORMANCE TEST REPORT",
      "=".repeat(80),
      "",
    ];
    for (const result of this.results) {
      lines.push(`Test: ${result.testName}`);
      lines.push(`Iterations: ${result.iterations}`);
      lines.push(`Status: ${result.passed ? "✓ PASSED" : "✗ FAILED"}`);
      lines.push("");
      lines.push("Statistics:");
      lines.push(`  Mean:   ${result.statistics.mean.toFixed(2)}ms`);
      lines.push(`  Median: ${result.statistics.median.toFixed(2)}ms`);
      lines.push(`  P95:    ${result.statistics.p95.toFixed(2)}ms`);
      lines.push(`  P99:    ${result.statistics.p99.toFixed(2)}ms`);
      lines.push(`  Min:    ${result.statistics.min.toFixed(2)}ms`);
      lines.push(`  Max:    ${result.statistics.max.toFixed(2)}ms`);
      lines.push(`  StdDev: ${result.statistics.stdDev.toFixed(2)}ms`);
      if (result.violations && result.violations.length > 0) {
        lines.push("");
        lines.push("Violations:");
        result.violations.forEach((v) => lines.push(`  - ${v}`));
      }
      lines.push("");
      lines.push("-".repeat(80));
      lines.push("");
    }
    const totalTests = this.results.length;
    const passedTests = this.results.filter((r) => r.passed).length;
    const failedTests = totalTests - passedTests;
    lines.push("Summary:");
    lines.push(`  Total Tests:  ${totalTests}`);
    lines.push(`  Passed:       ${passedTests}`);
    lines.push(`  Failed:       ${failedTests}`);
    lines.push(
      `  Pass Rate:    ${((passedTests / totalTests) * 100).toFixed(1)}%`
    );
    lines.push("");
    lines.push("=".repeat(80));
    return lines.join("\n");
  }
  /**
   * Clear all results
   */
  clear() {
    this.results = [];
  }
}
exports.PerformanceTestRunner = PerformanceTestRunner;
exports.performanceTestRunner = new PerformanceTestRunner();
