/**
 * TimelineRecorder
 *
 * Serialises and persists failing timelines as CI artifacts.
 *
 * Responsibilities:
 *   1. Accept Timeline objects from SeededFaultScheduler.finish().
 *   2. Decide which timelines are "interesting" (passed=false OR has violations).
 *   3. Serialise them to a canonical JSON format.
 *   4. Write them to a configurable output directory so CI can upload them.
 *   5. Produce a human-readable summary for the test runner console.
 *
 * The output directory defaults to `fault-timelines/` in the working
 * directory.  Callers can override it or supply a custom writer to avoid
 * filesystem access in unit tests.
 *
 * File-naming convention:
 *   {outputDir}/{seed}-{scenario-slug}-{timestamp}.json
 *
 * In CI (GitHub Actions), the workflow uploads `fault-timelines/*.json` as
 * a job artifact so engineers can download and replay any failing scenario
 * by passing its seed back to the scheduler.
 */

import * as fs from "fs";
import * as path from "path";
import { Timeline, InvariantViolation, TimelineEvent } from "./types";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Optional dependency-injected writer (defaults to real `fs.writeFileSync`). */
export type TimelineWriter = (filePath: string, content: string) => void;

/** Optional dependency-injected directory creator. */
export type DirectoryCreator = (dir: string) => void;

export interface TimelineRecorderOptions {
  /** Directory where timeline JSON files are written. Default: `fault-timelines`. */
  outputDir?: string;
  /**
   * If true, timelines for passing scenarios are also written to disk.
   * Useful for debugging.  Defaults to false.
   */
  persistPassing?: boolean;
  /** Injected writer function; defaults to `fs.writeFileSync`. */
  writer?: TimelineWriter;
  /** Injected directory creator; defaults to `fs.mkdirSync`. */
  mkdir?: DirectoryCreator;
}

/** Summary of a single recorded timeline. */
export interface TimelineRecord {
  filePath: string;
  seed: number;
  scenario: string;
  passed: boolean;
  durationMs: number;
  violationCount: number;
  faultCount: number;
  /** Whether the timeline was actually written to disk. */
  written: boolean;
}

/** Aggregated report of all timelines recorded in a test session. */
export interface SessionReport {
  totalScenarios: number;
  passed: number;
  failed: number;
  /** Total violations across all scenarios. */
  totalViolations: number;
  /** All records including passing (if persistPassing is true). */
  records: TimelineRecord[];
  /** Seeds for all failing scenarios — sufficient to replay them. */
  failingSeeds: number[];
}

// ─── Canonical serialisation format ─────────────────────────────────────────

/** What is stored in the JSON artifact file. */
interface ArtifactPayload {
  /** Schema version for forward compatibility. */
  schemaVersion: "1.0";
  seed: number;
  scenario: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  passed: boolean;
  summary: {
    faultsActivated: number;
    totalEvents: number;
    violations: number;
    violationsByService: Record<string, number>;
    faultKindsSeen: string[];
  };
  violations: InvariantViolation[];
  events: TimelineEvent[];
  faultsActivated: Array<{
    id: string;
    service: string;
    boundary: string;
    kind: string;
  }>;
  /** Human-readable replay instruction. */
  replayHint: string;
}

// ─── TimelineRecorder ────────────────────────────────────────────────────────

export class TimelineRecorder {
  private readonly outputDir: string;
  private readonly persistPassing: boolean;
  private readonly writer: TimelineWriter;
  private readonly mkdir: DirectoryCreator;

  /** All records accumulated during this session (passing or failing). */
  private records: TimelineRecord[] = [];

  constructor(options: TimelineRecorderOptions = {}) {
    this.outputDir = options.outputDir ?? "fault-timelines";
    this.persistPassing = options.persistPassing ?? false;
    this.writer =
      options.writer ??
      ((filePath: string, content: string) =>
        fs.writeFileSync(filePath, content, "utf8"));
    this.mkdir =
      options.mkdir ??
      ((dir: string) => fs.mkdirSync(dir, { recursive: true }));
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Record a timeline from a completed scenario run.
   *
   * If the timeline represents a failure (passed=false or has violations),
   * it is written to disk as a JSON artifact.
   *
   * @returns A TimelineRecord summarising what was done.
   */
  record(timeline: Timeline): TimelineRecord {
    const shouldWrite = !timeline.passed || this.persistPassing;
    const filePath = this.buildFilePath(timeline);

    let written = false;
    if (shouldWrite) {
      const payload = this.buildPayload(timeline);
      const json = JSON.stringify(payload, null, 2);
      this.ensureOutputDir();
      this.writer(filePath, json);
      written = true;
    }

    const record: TimelineRecord = {
      filePath,
      seed: timeline.seed,
      scenario: timeline.scenario,
      passed: timeline.passed,
      durationMs: timeline.durationMs,
      violationCount: timeline.violations.length,
      faultCount: timeline.faultsActivated.length,
      written,
    };

    this.records.push(record);
    return record;
  }

  /**
   * Record multiple timelines at once (e.g. after all scenarios in a suite
   * have run).
   */
  recordAll(timelines: Timeline[]): TimelineRecord[] {
    return timelines.map((t) => this.record(t));
  }

  /**
   * Build and return the SessionReport for all timelines recorded in this
   * session.
   */
  buildSessionReport(): SessionReport {
    const failed = this.records.filter((r) => !r.passed);
    const passed = this.records.filter((r) => r.passed);
    const totalViolations = this.records.reduce(
      (acc, r) => acc + r.violationCount,
      0
    );

    return {
      totalScenarios: this.records.length,
      passed: passed.length,
      failed: failed.length,
      totalViolations,
      records: [...this.records],
      failingSeeds: failed.map((r) => r.seed),
    };
  }

  /**
   * Render a concise, human-readable summary of the session suitable for
   * printing to the CI console / test runner.
   */
  renderSummary(report: SessionReport): string {
    const lines: string[] = [];
    lines.push("╔══════════════════════════════════════════════════╗");
    lines.push("║        Fault Scheduler — Session Summary         ║");
    lines.push("╚══════════════════════════════════════════════════╝");
    lines.push(
      `  Scenarios : ${report.totalScenarios}  ` +
        `✓ ${report.passed}  ✗ ${report.failed}`
    );
    lines.push(`  Violations: ${report.totalViolations}`);

    if (report.failed > 0) {
      lines.push("");
      lines.push("  Failing scenarios (replay by passing seed to scheduler):");
      for (const rec of report.records.filter((r) => !r.passed)) {
        lines.push(`    seed=${rec.seed}  "${rec.scenario}"`);
        lines.push(
          `      violations=${rec.violationCount}  faults=${rec.faultCount}`
        );
        if (rec.written) {
          lines.push(`      artifact: ${rec.filePath}`);
        }
      }
    }

    if (report.totalScenarios > 0 && report.failed === 0) {
      lines.push("  All scenarios passed.");
    }

    lines.push("──────────────────────────────────────────────────");
    return lines.join("\n");
  }

  /**
   * Serialise a Timeline to the canonical JSON artifact string without
   * writing it to disk.  Useful in tests that want to inspect the JSON.
   */
  serialise(timeline: Timeline): string {
    return JSON.stringify(this.buildPayload(timeline), null, 2);
  }

  /**
   * Deserialise an artifact JSON string back to a partial Timeline suitable
   * for replaying.  Only the seed and scenario are needed to fully replay.
   */
  static deserialise(json: string): Pick<Timeline, "seed" | "scenario"> & {
    summary: ArtifactPayload["summary"];
    violations: InvariantViolation[];
  } {
    const payload = JSON.parse(json) as ArtifactPayload;
    if (payload.schemaVersion !== "1.0") {
      throw new Error(
        `Unsupported timeline artifact schema version: ${payload.schemaVersion}`
      );
    }
    return {
      seed: payload.seed,
      scenario: payload.scenario,
      summary: payload.summary,
      violations: payload.violations,
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private buildFilePath(timeline: Timeline): string {
    const slug = slugify(timeline.scenario);
    const ts = new Date(timeline.startedAt)
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const filename = `${timeline.seed}-${slug}-${ts}.json`;
    return path.join(this.outputDir, filename);
  }

  private ensureOutputDir(): void {
    this.mkdir(this.outputDir);
  }

  private buildPayload(timeline: Timeline): ArtifactPayload {
    // Build violation-by-service count.
    const violationsByService: Record<string, number> = {};
    for (const v of timeline.violations) {
      violationsByService[v.service] =
        (violationsByService[v.service] ?? 0) + 1;
    }

    // Unique fault kinds seen.
    const faultKindsSeen = [
      ...new Set(timeline.faultsActivated.map((f) => f.params.kind)),
    ];

    return {
      schemaVersion: "1.0",
      seed: timeline.seed,
      scenario: timeline.scenario,
      startedAt: timeline.startedAt,
      endedAt: timeline.endedAt,
      durationMs: timeline.durationMs,
      passed: timeline.passed,
      summary: {
        faultsActivated: timeline.faultsActivated.length,
        totalEvents: timeline.events.length,
        violations: timeline.violations.length,
        violationsByService,
        faultKindsSeen,
      },
      violations: timeline.violations,
      events: timeline.events,
      faultsActivated: timeline.faultsActivated.map((f) => ({
        id: f.id,
        service: f.service,
        boundary: f.boundary,
        kind: f.params.kind,
      })),
      replayHint: [
        `To replay this scenario deterministically:`,
        `  const scheduler = new SeededFaultScheduler({`,
        `    seed: ${timeline.seed},`,
        `    scenario: "${timeline.scenario}",`,
        `    faults: [ /* same FaultSpec array as original */ ],`,
        `  });`,
      ].join("\n"),
    };
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/** Convert a scenario name to a safe filename slug. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
