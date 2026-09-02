import { PerformanceTestRunner } from "./utils/PerformanceTestRunner";
import { TrendRecorder } from "./utils/TrendRecorder";
import { budgetValidator } from "./utils/BudgetValidator";
import * as fs from "fs";
import * as path from "path";

describe("Regression Budget Engine & Governance Verification", () => {
  describe("Statistical Regression Detection", () => {
    it("should detect statistically meaningful regressions when latency exceeds budget", async () => {
      const runner = new PerformanceTestRunner();

      // Simulated slow operation that violates a 10ms budget
      const result = await runner.runTest(
        "Regression Test: Injected Latency",
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 25));
        },
        {
          iterations: 10,
          warmupIterations: 2,
          threshold: {
            mean: 10,
            p95: 15,
            p99: 20,
          },
        }
      );

      expect(result.passed).toBe(false);
      expect(result.violations?.length).toBeGreaterThan(0);
      expect(result.regressionAnalysis?.isStatisticallySignificant).toBe(true);
      expect(result.regressionAnalysis?.relativeIncreasePct).toBeGreaterThan(
        50
      );
    });

    it("should pass when operation meets all percentiles, CPU, and memory budgets", async () => {
      const runner = new PerformanceTestRunner();

      const result = await runner.runTest(
        "Regression Test: Compliant Fast Operation",
        () => {
          let sum = 0;
          for (let i = 0; i < 1000; i++) sum += i;
          return sum;
        },
        {
          iterations: 15,
          warmupIterations: 2,
          threshold: {
            mean: 50,
            p95: 100,
            p99: 150,
            maxCpuMs: 50,
            maxMemoryDeltaBytes: 10 * 1024 * 1024,
          },
        }
      );

      expect(result.passed).toBe(true);
      expect(result.violations?.length).toBe(0);
    });
  });

  describe("Per-Commit Trend Persistence & Analysis", () => {
    const testReportsDir = path.resolve(__dirname, "./reports/test-temp");

    afterAll(() => {
      try {
        if (fs.existsSync(testReportsDir)) {
          fs.rmSync(testReportsDir, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup errors
      }
    });

    it("should persist commit report to JSON and generate trend markdown", () => {
      const trendRecorder = new TrendRecorder(testReportsDir);

      const mockResult = {
        testName: "Trend Benchmark",
        iterations: 10,
        metrics: [],
        statistics: {
          min: 1.0,
          max: 5.0,
          mean: 2.5,
          median: 2.4,
          p90: 3.5,
          p95: 4.0,
          p99: 4.8,
          stdDev: 0.8,
          variance: 0.64,
          standardError: 0.25,
          cpuUserMeanMs: 1.2,
          cpuSystemMeanMs: 0.3,
          cpuTotalMeanMs: 1.5,
          cpuTotalP95Ms: 2.8,
          heapUsedDeltaMeanBytes: 1024,
          heapUsedDeltaP95Bytes: 2048,
        },
        passed: true,
        threshold: { mean: 10, p95: 20 },
        violations: [],
      };

      const report = trendRecorder.saveReport([mockResult]);
      expect(report.commitSha).toBeDefined();
      expect(
        report.benchmarks.some((b) => b.testName === "Trend Benchmark")
      ).toBe(true);

      const markdown = trendRecorder.generateTrendMarkdown(report, report);
      expect(markdown).toContain("Performance Regression & Budget Report");
      expect(markdown).toContain("Trend Benchmark");
      expect(markdown).toContain("±0%");
    });
  });

  describe("Budget Governance & Changelog Verification", () => {
    it("should validate that BUDGET_CHANGELOG.md is intact and includes current version", () => {
      const validation = budgetValidator.validate();
      expect(validation.valid).toBe(true);
      expect(validation.changelogFound).toBe(true);
      expect(validation.hasEntryForCurrentVersion).toBe(true);
      expect(validation.errors.length).toBe(0);
    });
  });
});
