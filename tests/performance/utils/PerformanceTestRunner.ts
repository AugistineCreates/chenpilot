import logger from "../../../src/config/logger";

export interface PerformanceMetrics {
  operationName: string;
  duration: number; // ms
  timestamp: string;
  cpuUsage?: {
    userMs: number;
    systemMs: number;
    totalMs: number;
  };
  memoryUsage?: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    heapUsedDelta: number;
  };
  metadata?: Record<string, unknown>;
}

export interface PerformanceThreshold {
  p50?: number;
  p90?: number;
  p95?: number;
  p99?: number;
  max?: number;
  mean?: number;
  maxCpuMs?: number;
  maxMemoryDeltaBytes?: number;
  maxAllocationsBytes?: number;
}

export interface StatisticalSummary {
  min: number;
  max: number;
  mean: number;
  median: number; // p50
  p90: number;
  p95: number;
  p99: number;
  stdDev: number;
  variance: number;
  standardError: number;
  cpuUserMeanMs: number;
  cpuSystemMeanMs: number;
  cpuTotalMeanMs: number;
  cpuTotalP95Ms: number;
  heapUsedDeltaMeanBytes: number;
  heapUsedDeltaP95Bytes: number;
}

export interface PerformanceTestResult {
  testName: string;
  iterations: number;
  metrics: PerformanceMetrics[];
  statistics: StatisticalSummary;
  passed: boolean;
  threshold?: PerformanceThreshold;
  violations?: string[];
  regressionDetected?: boolean;
  regressionAnalysis?: {
    isStatisticallySignificant: boolean;
    zScore: number;
    pValueEstimate: number;
    relativeIncreasePct: number;
  };
}

export class PerformanceTestRunner {
  private results: PerformanceTestResult[] = [];

  /**
   * Run a performance test with multiple iterations, warmup, CPU and memory tracking
   */
  async runTest(
    testName: string,
    operation: () => Promise<void> | void,
    options: {
      iterations?: number;
      warmupIterations?: number;
      threshold?: PerformanceThreshold;
      collectMemory?: boolean;
      collectCpu?: boolean;
      delayBetweenIterationsMs?: number;
    } = {}
  ): Promise<PerformanceTestResult> {
    const {
      iterations = 20,
      warmupIterations = 3,
      threshold,
      collectMemory = true,
      collectCpu = true,
      delayBetweenIterationsMs = 10,
    } = options;

    logger.info(`Starting performance test: ${testName}`, {
      iterations,
      warmupIterations,
    });

    // Warmup iterations
    for (let i = 0; i < warmupIterations; i++) {
      await operation();
    }

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    // Actual test iterations
    const metrics: PerformanceMetrics[] = [];
    for (let i = 0; i < iterations; i++) {
      const startCpu = collectCpu ? process.cpuUsage() : undefined;
      const startMemory = collectMemory ? process.memoryUsage() : undefined;
      const startTime = performance.now();

      await operation();

      const duration = performance.now() - startTime;
      const endCpu =
        collectCpu && startCpu ? process.cpuUsage(startCpu) : undefined;
      const endMemory = collectMemory ? process.memoryUsage() : undefined;

      const cpuUsage = endCpu
        ? {
            userMs: endCpu.user / 1000,
            systemMs: endCpu.system / 1000,
            totalMs: (endCpu.user + endCpu.system) / 1000,
          }
        : undefined;

      const heapUsedDelta =
        endMemory && startMemory
          ? Math.max(0, endMemory.heapUsed - startMemory.heapUsed)
          : 0;

      metrics.push({
        operationName: testName,
        duration,
        timestamp: new Date().toISOString(),
        cpuUsage,
        memoryUsage: endMemory
          ? {
              heapUsed: endMemory.heapUsed,
              heapTotal: endMemory.heapTotal,
              external: endMemory.external,
              heapUsedDelta,
            }
          : undefined,
      });

      if (delayBetweenIterationsMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, delayBetweenIterationsMs)
        );
      }
    }

    const statistics = this.calculateStatistics(metrics);
    const { passed, violations, regressionAnalysis } = this.checkThresholds(
      testName,
      statistics,
      threshold
    );

    const result: PerformanceTestResult = {
      testName,
      iterations,
      metrics,
      statistics,
      passed,
      threshold,
      violations,
      regressionDetected: !passed,
      regressionAnalysis,
    };

    this.results.push(result);
    this.logResult(result);

    return result;
  }

  /**
   * Run a single timed operation
   */
  async measureOperation<T>(
    operationName: string,
    operation: () => Promise<T> | T
  ): Promise<{ result: T; metrics: PerformanceMetrics }> {
    const startCpu = process.cpuUsage();
    const startMemory = process.memoryUsage();
    const startTime = performance.now();

    const result = await operation();

    const duration = performance.now() - startTime;
    const endCpu = process.cpuUsage(startCpu);
    const endMemory = process.memoryUsage();

    const metrics: PerformanceMetrics = {
      operationName,
      duration,
      timestamp: new Date().toISOString(),
      cpuUsage: {
        userMs: endCpu.user / 1000,
        systemMs: endCpu.system / 1000,
        totalMs: (endCpu.user + endCpu.system) / 1000,
      },
      memoryUsage: {
        heapUsed: endMemory.heapUsed,
        heapTotal: endMemory.heapTotal,
        external: endMemory.external,
        heapUsedDelta: Math.max(0, endMemory.heapUsed - startMemory.heapUsed),
      },
    };

    return { result, metrics };
  }

  /**
   * Calculate comprehensive statistical metrics
   */
  calculateStatistics(metrics: PerformanceMetrics[]): StatisticalSummary {
    const durations = metrics.map((m) => m.duration).sort((a, b) => a - b);
    const n = durations.length;

    const min = durations[0];
    const max = durations[n - 1];
    const mean = durations.reduce((a, b) => a + b, 0) / n;
    const median = this.percentile(durations, 50);
    const p90 = this.percentile(durations, 90);
    const p95 = this.percentile(durations, 95);
    const p99 = this.percentile(durations, 99);

    const variance =
      n > 1
        ? durations.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
          (n - 1)
        : 0;
    const stdDev = Math.sqrt(variance);
    const standardError = stdDev / Math.sqrt(n);

    // CPU stats
    const cpuUsers = metrics.map((m) => m.cpuUsage?.userMs || 0);
    const cpuSystems = metrics.map((m) => m.cpuUsage?.systemMs || 0);
    const cpuTotals = metrics
      .map((m) => m.cpuUsage?.totalMs || 0)
      .sort((a, b) => a - b);

    const cpuUserMeanMs = cpuUsers.reduce((a, b) => a + b, 0) / n;
    const cpuSystemMeanMs = cpuSystems.reduce((a, b) => a + b, 0) / n;
    const cpuTotalMeanMs = cpuTotals.reduce((a, b) => a + b, 0) / n;
    const cpuTotalP95Ms = this.percentile(cpuTotals, 95);

    // Memory stats
    const heapDeltas = metrics
      .map((m) => m.memoryUsage?.heapUsedDelta || 0)
      .sort((a, b) => a - b);
    const heapUsedDeltaMeanBytes = heapDeltas.reduce((a, b) => a + b, 0) / n;
    const heapUsedDeltaP95Bytes = this.percentile(heapDeltas, 95);

    return {
      min,
      max,
      mean,
      median,
      p90,
      p95,
      p99,
      stdDev,
      variance,
      standardError,
      cpuUserMeanMs,
      cpuSystemMeanMs,
      cpuTotalMeanMs,
      cpuTotalP95Ms,
      heapUsedDeltaMeanBytes,
      heapUsedDeltaP95Bytes,
    };
  }

  /**
   * Calculate percentile value from sorted array
   */
  private percentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) return 0;
    if (sortedValues.length === 1) return sortedValues[0];

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
   * Check if metrics meet budget thresholds and perform statistical regression analysis
   */
  private checkThresholds(
    testName: string,
    statistics: StatisticalSummary,
    threshold?: PerformanceThreshold
  ): {
    passed: boolean;
    violations: string[];
    regressionAnalysis?: PerformanceTestResult["regressionAnalysis"];
  } {
    if (!threshold) {
      return { passed: true, violations: [] };
    }

    const violations: string[] = [];

    // Latency Budget Checks
    if (threshold.mean !== undefined && statistics.mean > threshold.mean) {
      violations.push(
        `Mean duration ${statistics.mean.toFixed(2)}ms exceeds budget ${threshold.mean}ms`
      );
    }

    if (threshold.p50 !== undefined && statistics.median > threshold.p50) {
      violations.push(
        `P50 duration ${statistics.median.toFixed(2)}ms exceeds budget ${threshold.p50}ms`
      );
    }

    if (threshold.p90 !== undefined && statistics.p90 > threshold.p90) {
      violations.push(
        `P90 duration ${statistics.p90.toFixed(2)}ms exceeds budget ${threshold.p90}ms`
      );
    }

    if (threshold.p95 !== undefined && statistics.p95 > threshold.p95) {
      violations.push(
        `P95 duration ${statistics.p95.toFixed(2)}ms exceeds budget ${threshold.p95}ms`
      );
    }

    if (threshold.p99 !== undefined && statistics.p99 > threshold.p99) {
      violations.push(
        `P99 duration ${statistics.p99.toFixed(2)}ms exceeds budget ${threshold.p99}ms`
      );
    }

    if (threshold.max !== undefined && statistics.max > threshold.max) {
      violations.push(
        `Max duration ${statistics.max.toFixed(2)}ms exceeds budget ${threshold.max}ms`
      );
    }

    // CPU Budget Checks
    if (
      threshold.maxCpuMs !== undefined &&
      statistics.cpuTotalP95Ms > threshold.maxCpuMs
    ) {
      violations.push(
        `P95 CPU time ${statistics.cpuTotalP95Ms.toFixed(2)}ms exceeds budget ${threshold.maxCpuMs}ms`
      );
    }

    // Memory / Allocation Budget Checks
    if (
      threshold.maxMemoryDeltaBytes !== undefined &&
      statistics.heapUsedDeltaP95Bytes > threshold.maxMemoryDeltaBytes
    ) {
      const mb = (statistics.heapUsedDeltaP95Bytes / 1024 / 1024).toFixed(2);
      const budgetMb = (threshold.maxMemoryDeltaBytes / 1024 / 1024).toFixed(2);
      violations.push(
        `P95 Heap allocation delta ${mb}MB exceeds budget ${budgetMb}MB`
      );
    }

    // Statistical Regression Test against baseline mean
    let regressionAnalysis: PerformanceTestResult["regressionAnalysis"];
    if (threshold.mean) {
      const delta = statistics.mean - threshold.mean;
      const se =
        statistics.standardError > 0 ? statistics.standardError : 0.001;
      const zScore = delta / se;
      const relativeIncreasePct =
        ((statistics.mean - threshold.mean) / threshold.mean) * 100;
      // Normal distribution two-tailed approximation
      const pValueEstimate = Math.max(
        0.0001,
        1 - this.approximateCdf(Math.abs(zScore))
      );

      // Statistically significant regression if zScore > 1.96 (p < 0.05) and mean > budget
      const isStatisticallySignificant =
        zScore > 1.96 && statistics.mean > threshold.mean;

      regressionAnalysis = {
        isStatisticallySignificant,
        zScore: Number(zScore.toFixed(3)),
        pValueEstimate: Number(pValueEstimate.toFixed(4)),
        relativeIncreasePct: Number(relativeIncreasePct.toFixed(2)),
      };
    }

    return {
      passed: violations.length === 0,
      violations,
      regressionAnalysis,
    };
  }

  private approximateCdf(x: number): number {
    // Error function approximation for normal CDF
    const t = 1 / (1 + 0.2316419 * x);
    const d = 0.3989423 * Math.exp((-x * x) / 2);
    const prob =
      d *
      t *
      (0.3193815 +
        t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return 1 - prob;
  }

  /**
   * Log test result
   */
  private logResult(result: PerformanceTestResult): void {
    const { testName, statistics, passed, violations, regressionAnalysis } =
      result;

    logger.info(`Performance test completed: ${testName}`, {
      passed,
      statistics: {
        mean: `${statistics.mean.toFixed(2)}ms`,
        median: `${statistics.median.toFixed(2)}ms`,
        p95: `${statistics.p95.toFixed(2)}ms`,
        p99: `${statistics.p99.toFixed(2)}ms`,
        min: `${statistics.min.toFixed(2)}ms`,
        max: `${statistics.max.toFixed(2)}ms`,
        cpuTotalP95: `${statistics.cpuTotalP95Ms.toFixed(2)}ms`,
        heapAllocP95: `${(statistics.heapUsedDeltaP95Bytes / 1024).toFixed(1)}KB`,
      },
    });

    if (!passed && violations) {
      logger.warn(`Performance budget violations for ${testName}:`, {
        violations,
        regressionAnalysis,
      });
    }
  }

  /**
   * Get all test results
   */
  getResults(): PerformanceTestResult[] {
    return this.results;
  }

  /**
   * Generate performance report
   */
  generateReport(): string {
    const lines: string[] = [
      "=".repeat(80),
      "PERFORMANCE REGRESSION & BUDGET REPORT",
      "=".repeat(80),
      "",
    ];

    for (const result of this.results) {
      lines.push(`Test: ${result.testName}`);
      lines.push(`Iterations: ${result.iterations}`);
      lines.push(
        `Status: ${result.passed ? "✓ PASSED (Within Budget)" : "✗ FAILED (Regression Detected)"}`
      );
      lines.push("");
      lines.push("Latency Metrics:");
      lines.push(`  Mean:   ${result.statistics.mean.toFixed(2)}ms`);
      lines.push(`  Median: ${result.statistics.median.toFixed(2)}ms (P50)`);
      lines.push(`  P90:    ${result.statistics.p90.toFixed(2)}ms`);
      lines.push(`  P95:    ${result.statistics.p95.toFixed(2)}ms`);
      lines.push(`  P99:    ${result.statistics.p99.toFixed(2)}ms`);
      lines.push(`  Min:    ${result.statistics.min.toFixed(2)}ms`);
      lines.push(`  Max:    ${result.statistics.max.toFixed(2)}ms`);
      lines.push(
        `  StdDev: ${result.statistics.stdDev.toFixed(2)}ms (SE: ±${result.statistics.standardError.toFixed(2)}ms)`
      );
      lines.push("");
      lines.push("Resource & Allocation Metrics:");
      lines.push(
        `  CPU Time (Mean Total):  ${result.statistics.cpuTotalMeanMs.toFixed(2)}ms (User: ${result.statistics.cpuUserMeanMs.toFixed(2)}ms, Sys: ${result.statistics.cpuSystemMeanMs.toFixed(2)}ms)`
      );
      lines.push(
        `  CPU Time (P95 Total):   ${result.statistics.cpuTotalP95Ms.toFixed(2)}ms`
      );
      lines.push(
        `  Heap Delta (P95):       ${(result.statistics.heapUsedDeltaP95Bytes / 1024).toFixed(1)}KB`
      );

      if (result.regressionAnalysis) {
        lines.push("");
        lines.push("Statistical Regression Analysis:");
        lines.push(
          `  Z-Score:                ${result.regressionAnalysis.zScore}`
        );
        lines.push(
          `  Relative vs Budget:     ${result.regressionAnalysis.relativeIncreasePct > 0 ? "+" : ""}${result.regressionAnalysis.relativeIncreasePct}%`
        );
        lines.push(
          `  Significant (p < 0.05): ${result.regressionAnalysis.isStatisticallySignificant ? "YES" : "NO"}`
        );
      }

      if (result.violations && result.violations.length > 0) {
        lines.push("");
        lines.push("Budget Violations:");
        result.violations.forEach((v) => lines.push(`  ❌ ${v}`));
      }

      lines.push("");
      lines.push("-".repeat(80));
      lines.push("");
    }

    const totalTests = this.results.length;
    const passedTests = this.results.filter((r) => r.passed).length;
    const failedTests = totalTests - passedTests;

    lines.push("Summary:");
    lines.push(`  Total Benchmarks: ${totalTests}`);
    lines.push(`  Passed (Budget):  ${passedTests}`);
    lines.push(`  Failed:           ${failedTests}`);
    lines.push(
      `  Pass Rate:        ${totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : "100.0"}%`
    );
    lines.push("");
    lines.push("=".repeat(80));

    return lines.join("\n");
  }

  /**
   * Clear all results
   */
  clear(): void {
    this.results = [];
  }
}

export const performanceTestRunner = new PerformanceTestRunner();
