import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { PerformanceTestResult } from "./PerformanceTestRunner";

export interface CommitBenchmarkReport {
  commitSha: string;
  branch: string;
  timestamp: string;
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
  };
  benchmarks: Array<{
    testName: string;
    iterations: number;
    passed: boolean;
    statistics: {
      mean: number;
      median: number;
      p95: number;
      p99: number;
      min: number;
      max: number;
      stdDev: number;
      cpuTotalMeanMs: number;
      cpuTotalP95Ms: number;
      heapUsedDeltaP95Bytes: number;
    };
    threshold?: {
      mean?: number;
      p95?: number;
      p99?: number;
      maxCpuMs?: number;
      maxMemoryDeltaBytes?: number;
    };
    violations?: string[];
  }>;
}

export class TrendRecorder {
  private reportsDir: string;

  constructor(reportsDir?: string) {
    this.reportsDir = reportsDir || path.resolve(__dirname, "../reports");
    if (!fs.existsSync(this.reportsDir)) {
      fs.mkdirSync(this.reportsDir, { recursive: true });
    }
  }

  /**
   * Get current git commit hash
   */
  getCommitSha(): string {
    if (process.env.GITHUB_SHA) {
      return process.env.GITHUB_SHA;
    }
    try {
      return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    } catch {
      return "local-" + Date.now();
    }
  }

  /**
   * Get current git branch
   */
  getBranch(): string {
    if (process.env.GITHUB_REF_NAME) {
      return process.env.GITHUB_REF_NAME;
    }
    try {
      return execSync("git rev-parse --abbrev-ref HEAD", {
        encoding: "utf8",
      }).trim();
    } catch {
      return "unknown";
    }
  }

  /**
   * Save benchmark results for current commit
   */
  saveReport(results: PerformanceTestResult[]): CommitBenchmarkReport {
    const commitSha = this.getCommitSha();
    const branch = this.getBranch();

    const newBenchmarks = results.map((r) => ({
      testName: r.testName,
      iterations: r.iterations,
      passed: r.passed,
      statistics: {
        mean: Number(r.statistics.mean.toFixed(2)),
        median: Number(r.statistics.median.toFixed(2)),
        p95: Number(r.statistics.p95.toFixed(2)),
        p99: Number(r.statistics.p99.toFixed(2)),
        min: Number(r.statistics.min.toFixed(2)),
        max: Number(r.statistics.max.toFixed(2)),
        stdDev: Number(r.statistics.stdDev.toFixed(2)),
        cpuTotalMeanMs: Number(r.statistics.cpuTotalMeanMs.toFixed(2)),
        cpuTotalP95Ms: Number(r.statistics.cpuTotalP95Ms.toFixed(2)),
        heapUsedDeltaP95Bytes: Math.round(r.statistics.heapUsedDeltaP95Bytes),
      },
      threshold: r.threshold
        ? {
            mean: r.threshold.mean,
            p95: r.threshold.p95,
            p99: r.threshold.p99,
            maxCpuMs: r.threshold.maxCpuMs,
            maxMemoryDeltaBytes: r.threshold.maxMemoryDeltaBytes,
          }
        : undefined,
      violations: r.violations,
    }));

    const latestFilePath = path.join(this.reportsDir, "latest.json");
    let mergedBenchmarks = [...newBenchmarks];

    if (fs.existsSync(latestFilePath)) {
      try {
        const existingReport: CommitBenchmarkReport = JSON.parse(
          fs.readFileSync(latestFilePath, "utf8")
        );
        if (
          existingReport.commitSha === commitSha &&
          Array.isArray(existingReport.benchmarks)
        ) {
          const map = new Map<string, (typeof newBenchmarks)[0]>();
          for (const b of existingReport.benchmarks) {
            map.set(b.testName, b);
          }
          for (const b of newBenchmarks) {
            map.set(b.testName, b);
          }
          mergedBenchmarks = Array.from(map.values());
        }
      } catch {
        // Ignore read errors
      }
    }

    const report: CommitBenchmarkReport = {
      commitSha,
      branch,
      timestamp: new Date().toISOString(),
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      benchmarks: mergedBenchmarks,
    };

    const commitFilePath = path.join(
      this.reportsDir,
      `benchmark-results-${commitSha.substring(0, 10)}.json`
    );

    fs.writeFileSync(commitFilePath, JSON.stringify(report, null, 2), "utf8");
    fs.writeFileSync(latestFilePath, JSON.stringify(report, null, 2), "utf8");

    return report;
  }

  /**
   * Load previous report
   */
  loadReport(filePathOrName: string): CommitBenchmarkReport | null {
    try {
      const fullPath = path.isAbsolute(filePathOrName)
        ? filePathOrName
        : path.join(this.reportsDir, filePathOrName);

      if (fs.existsSync(fullPath)) {
        return JSON.parse(fs.readFileSync(fullPath, "utf8"));
      }
    } catch {
      // Ignore load errors
    }
    return null;
  }

  /**
   * Generate trend markdown comparing current report to previous baseline
   */
  generateTrendMarkdown(
    currentReport: CommitBenchmarkReport,
    previousReport?: CommitBenchmarkReport | null
  ): string {
    const lines: string[] = [];
    lines.push(`## 🚀 Performance Regression & Budget Report`);
    lines.push(
      `**Commit:** \`${currentReport.commitSha.substring(0, 8)}\` | **Branch:** \`${currentReport.branch}\` | **Date:** ${currentReport.timestamp}`
    );
    lines.push("");
    lines.push(
      "| Benchmark | Status | Mean (ms) | P95 (ms) | P99 (ms) | CPU P95 (ms) | Heap Delta P95 | Trend (Mean) |"
    );
    lines.push(
      "| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |"
    );

    for (const b of currentReport.benchmarks) {
      const prev = previousReport?.benchmarks.find(
        (p) => p.testName === b.testName
      );

      let trend = "—";
      if (prev) {
        const diffPct =
          ((b.statistics.mean - prev.statistics.mean) / prev.statistics.mean) *
          100;
        if (Math.abs(diffPct) < 3) {
          trend = "±0%";
        } else if (diffPct > 0) {
          trend = `🔴 +${diffPct.toFixed(1)}%`;
        } else {
          trend = `🟢 ${diffPct.toFixed(1)}%`;
        }
      }

      const statusIcon = b.passed ? "✅" : "❌";
      const heapKb =
        (b.statistics.heapUsedDeltaP95Bytes / 1024).toFixed(1) + " KB";

      lines.push(
        `| **${b.testName}** | ${statusIcon} | ${b.statistics.mean} | ${b.statistics.p95} | ${b.statistics.p99} | ${b.statistics.cpuTotalP95Ms} | ${heapKb} | ${trend} |`
      );
    }

    const failed = currentReport.benchmarks.filter((b) => !b.passed);
    if (failed.length > 0) {
      lines.push("");
      lines.push("### ⚠️ Regression Budget Violations Detected");
      for (const f of failed) {
        lines.push(`- **${f.testName}**:`);
        f.violations?.forEach((v) => lines.push(`  - ${v}`));
      }
    } else {
      lines.push("");
      lines.push(
        "> ✅ All critical execution paths are within defined regression budgets."
      );
    }

    return lines.join("\n");
  }
}

export const trendRecorder = new TrendRecorder();
