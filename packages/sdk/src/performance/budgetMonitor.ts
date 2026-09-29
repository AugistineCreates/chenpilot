/**
 * Performance and memory budget monitor.
 *
 * Wraps hot paths, records how long they took and how much heap they grew,
 * and reports any breach of a declared {@link PerformanceBudget}. Clock and
 * memory probes are injectable so budgets can be tested deterministically
 * instead of depending on the speed of the machine running the suite.
 */

import { DEFAULT_PERFORMANCE_BUDGETS } from "./budgets";
import {
  BudgetEnforcement,
  BudgetExceededError,
  BudgetViolationKind,
  type BudgetReport,
  type BudgetViolation,
  type DurationStatistics,
  type PerformanceBudget,
  type PerformanceSample,
} from "./types";

/** Observations retained per flow when a budget does not say otherwise. */
export const DEFAULT_SAMPLE_WINDOW = 200;

const EMPTY_STATISTICS: DurationStatistics = {
  min: 0,
  max: 0,
  mean: 0,
  p50: 0,
  p95: 0,
  p99: 0,
};

/**
 * Nearest-rank percentile over an unsorted array.
 *
 * Nearest-rank is used rather than interpolation so a percentile is always an
 * observation that actually occurred, which makes violation messages
 * defensible.
 */
export function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index];
}

/** Summarize a set of durations. */
export function summarizeDurations(values: number[]): DurationStatistics {
  if (values.length === 0) return { ...EMPTY_STATISTICS };
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: total / values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
  };
}

function defaultNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function defaultHeapUsed(): number | undefined {
  return typeof process !== "undefined" && typeof process.memoryUsage === "function"
    ? process.memoryUsage().heapUsed
    : undefined;
}

/** Construction options for {@link PerformanceBudgetMonitor}. */
export interface PerformanceBudgetMonitorOptions {
  /** Budgets to enforce. Defaults to {@link DEFAULT_PERFORMANCE_BUDGETS}. */
  budgets?: PerformanceBudget[];
  /** Merge `budgets` onto the defaults instead of replacing them. */
  extendDefaults?: boolean;
  /** How to react to a violation. Defaults to `COLLECT`. */
  enforcement?: BudgetEnforcement;
  /** Injectable high-resolution clock, in milliseconds. */
  now?: () => number;
  /** Injectable heap probe, in bytes. Return `undefined` to skip heap checks. */
  heapUsed?: () => number | undefined;
  /** Invoked for every violation, regardless of enforcement mode. */
  onViolation?: (violation: BudgetViolation) => void;
}

/**
 * Records timings and heap deltas for named flows and enforces budgets.
 *
 * @example
 * ```ts
 * const monitor = new PerformanceBudgetMonitor({
 *   enforcement: BudgetEnforcement.THROW,
 * });
 *
 * await monitor.measureAsync(BudgetName.EVENT_PROCESS, () => handle(event));
 * const report = monitor.report(BudgetName.EVENT_PROCESS);
 * ```
 */
export class PerformanceBudgetMonitor {
  private readonly budgets = new Map<string, PerformanceBudget>();
  private readonly samples = new Map<string, PerformanceSample[]>();
  private readonly violations: BudgetViolation[] = [];
  private readonly enforcement: BudgetEnforcement;
  private readonly now: () => number;
  private readonly heapUsed: () => number | undefined;
  private readonly onViolation?: (violation: BudgetViolation) => void;

  constructor(options: PerformanceBudgetMonitorOptions = {}) {
    const extend = options.extendDefaults ?? options.budgets === undefined;
    if (extend) {
      DEFAULT_PERFORMANCE_BUDGETS.forEach((budget) =>
        this.budgets.set(budget.name, budget)
      );
    }
    (options.budgets ?? []).forEach((budget) => this.budgets.set(budget.name, budget));

    this.enforcement = options.enforcement ?? BudgetEnforcement.COLLECT;
    this.now = options.now ?? defaultNow;
    this.heapUsed = options.heapUsed ?? defaultHeapUsed;
    this.onViolation = options.onViolation;
  }

  /** Register or replace a budget. */
  setBudget(budget: PerformanceBudget): this {
    this.budgets.set(budget.name, budget);
    return this;
  }

  /** Look up a registered budget. */
  getBudget(name: string): PerformanceBudget | undefined {
    return this.budgets.get(name);
  }

  /** Names that have at least one recorded sample. */
  trackedFlows(): string[] {
    return [...this.samples.keys()];
  }

  /** Every violation recorded so far, oldest first. */
  getViolations(): BudgetViolation[] {
    return [...this.violations];
  }

  /** Discard all samples and violations. */
  reset(): this {
    this.samples.clear();
    this.violations.length = 0;
    return this;
  }

  /**
   * Record an observation directly.
   *
   * Use this when the caller already measured the flow, for example when
   * timings come from an external profiler.
   */
  record(
    name: string,
    durationMs: number,
    options: {
      heapUsedDeltaBytes?: number;
      metadata?: Record<string, unknown>;
      at?: number;
    } = {}
  ): PerformanceSample {
    const sample: PerformanceSample = {
      name,
      durationMs,
      at: options.at ?? this.now(),
      ...(options.heapUsedDeltaBytes !== undefined
        ? { heapUsedDeltaBytes: options.heapUsedDeltaBytes }
        : {}),
      ...(options.metadata ? { metadata: options.metadata } : {}),
    };

    const window = this.budgets.get(name)?.sampleWindow ?? DEFAULT_SAMPLE_WINDOW;
    const bucket = this.samples.get(name) ?? [];
    bucket.push(sample);
    while (bucket.length > window) bucket.shift();
    this.samples.set(name, bucket);

    this.checkImmediate(name, sample);
    return sample;
  }

  /** Time a synchronous function and record the observation. */
  measure<T>(
    name: string,
    fn: () => T,
    metadata?: Record<string, unknown>
  ): T {
    const startHeap = this.heapUsed();
    const start = this.now();
    try {
      return fn();
    } finally {
      this.finish(name, start, startHeap, metadata);
    }
  }

  /** Time an asynchronous function and record the observation. */
  async measureAsync<T>(
    name: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const startHeap = this.heapUsed();
    const start = this.now();
    try {
      return await fn();
    } finally {
      this.finish(name, start, startHeap, metadata);
    }
  }

  /**
   * Aggregate the samples for a flow and evaluate them against its budget.
   *
   * Window-level dimensions (p95, cumulative heap growth, throughput) are
   * evaluated here rather than per sample, because they are only meaningful
   * across a population.
   */
  report(name: string): BudgetReport {
    const samples = this.samples.get(name) ?? [];
    const budget = this.budgets.get(name);
    const durations = samples.map((sample) => sample.durationMs);
    const duration = summarizeDurations(durations);

    const heapGrowthBytes = samples.reduce(
      (sum, sample) => sum + (sample.heapUsedDeltaBytes ?? 0),
      0
    );

    const first = samples[0];
    const last = samples[samples.length - 1];
    const spanMs = first && last ? last.at - first.at : 0;
    const throughputOpsPerSec =
      samples.length > 1 && spanMs > 0 ? (samples.length / spanMs) * 1000 : 0;

    const violations: BudgetViolation[] = [];
    const at = last?.at ?? this.now();

    if (budget && samples.length > 0) {
      if (budget.maxP95DurationMs !== undefined && duration.p95 > budget.maxP95DurationMs) {
        violations.push({
          budget: name,
          kind: BudgetViolationKind.P95_DURATION,
          observed: duration.p95,
          limit: budget.maxP95DurationMs,
          message: `${name}: p95 duration ${duration.p95.toFixed(2)}ms exceeds budget of ${budget.maxP95DurationMs}ms`,
          at,
        });
      }

      if (
        budget.maxHeapGrowthBytes !== undefined &&
        heapGrowthBytes > budget.maxHeapGrowthBytes
      ) {
        violations.push({
          budget: name,
          kind: BudgetViolationKind.HEAP_GROWTH,
          observed: heapGrowthBytes,
          limit: budget.maxHeapGrowthBytes,
          message: `${name}: heap growth ${heapGrowthBytes} bytes exceeds budget of ${budget.maxHeapGrowthBytes} bytes`,
          at,
        });
      }

      if (
        budget.minThroughputOpsPerSec !== undefined &&
        samples.length > 1 &&
        throughputOpsPerSec < budget.minThroughputOpsPerSec
      ) {
        violations.push({
          budget: name,
          kind: BudgetViolationKind.THROUGHPUT,
          observed: throughputOpsPerSec,
          limit: budget.minThroughputOpsPerSec,
          message: `${name}: throughput ${throughputOpsPerSec.toFixed(2)} ops/s is below budget of ${budget.minThroughputOpsPerSec} ops/s`,
          at,
        });
      }
    }

    const immediate = this.violations.filter(
      (violation) =>
        violation.budget === name && violation.kind === BudgetViolationKind.DURATION
    );

    return {
      name,
      sampleCount: samples.length,
      duration,
      heapGrowthBytes,
      throughputOpsPerSec,
      violations: [...immediate, ...violations],
      withinBudget: immediate.length === 0 && violations.length === 0,
      ...(budget ? { budget } : {}),
    };
  }

  /** Reports for every flow that has samples. */
  reportAll(): BudgetReport[] {
    return this.trackedFlows().map((name) => this.report(name));
  }

  /**
   * Evaluate a flow and throw when it is over budget.
   *
   * Intended for use as a CI guardrail at the end of a benchmark run.
   *
   * @throws {BudgetExceededError} on the first violation found.
   */
  assertWithinBudget(name: string): BudgetReport {
    const report = this.report(name);
    if (!report.withinBudget) throw new BudgetExceededError(report.violations[0]);
    return report;
  }

  /**
   * Evaluate every tracked flow and throw when any is over budget.
   *
   * @throws {BudgetExceededError} on the first violation found.
   */
  assertAllWithinBudget(): BudgetReport[] {
    const reports = this.reportAll();
    const breached = reports.find((report) => !report.withinBudget);
    if (breached) throw new BudgetExceededError(breached.violations[0]);
    return reports;
  }

  private finish(
    name: string,
    start: number,
    startHeap: number | undefined,
    metadata?: Record<string, unknown>
  ): void {
    const durationMs = this.now() - start;
    const endHeap = this.heapUsed();
    const heapUsedDeltaBytes =
      startHeap !== undefined && endHeap !== undefined ? endHeap - startHeap : undefined;

    this.record(name, durationMs, {
      ...(heapUsedDeltaBytes !== undefined ? { heapUsedDeltaBytes } : {}),
      ...(metadata ? { metadata } : {}),
    });
  }

  /** Per-sample dimensions are checked as soon as the sample lands. */
  private checkImmediate(name: string, sample: PerformanceSample): void {
    const budget = this.budgets.get(name);
    if (!budget?.maxDurationMs) return;
    if (sample.durationMs <= budget.maxDurationMs) return;

    this.raise({
      budget: name,
      kind: BudgetViolationKind.DURATION,
      observed: sample.durationMs,
      limit: budget.maxDurationMs,
      message: `${name}: duration ${sample.durationMs.toFixed(2)}ms exceeds budget of ${budget.maxDurationMs}ms`,
      at: sample.at,
      ...(sample.metadata ? { metadata: sample.metadata } : {}),
    });
  }

  private raise(violation: BudgetViolation): void {
    this.violations.push(violation);

    try {
      this.onViolation?.(violation);
    } catch {
      // Reporting a violation must never mask the flow being measured.
    }

    if (this.enforcement === BudgetEnforcement.WARN) {
      console.warn(`[performance-budget] ${violation.message}`);
    } else if (this.enforcement === BudgetEnforcement.THROW) {
      throw new BudgetExceededError(violation);
    }
  }
}
