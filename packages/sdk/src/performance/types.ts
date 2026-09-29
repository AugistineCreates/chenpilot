/**
 * Types for performance and memory budgets.
 *
 * High-throughput signer and event flows degrade quietly: a change adds an
 * allocation per event, throughput halves, and nothing fails until
 * production. These types let a flow declare the envelope it must stay
 * inside so regressions surface as explicit, machine-readable violations.
 */

/** A declared performance envelope for one named flow. */
export interface PerformanceBudget {
  /** Flow identifier, e.g. `signer.signTransaction`. */
  name: string;
  /** Human-readable purpose of the budget. */
  description?: string;
  /** Ceiling for any single observation, in milliseconds. */
  maxDurationMs?: number;
  /** Ceiling for the 95th percentile across the sample window. */
  maxP95DurationMs?: number;
  /** Ceiling for total heap growth attributed to the flow, in bytes. */
  maxHeapGrowthBytes?: number;
  /** Floor for sustained throughput, in operations per second. */
  minThroughputOpsPerSec?: number;
  /** Observations retained for percentile maths. Defaults to 200. */
  sampleWindow?: number;
}

/** A single observation of a flow. */
export interface PerformanceSample {
  name: string;
  durationMs: number;
  /** Heap delta measured across the observation, when available. */
  heapUsedDeltaBytes?: number;
  at: number;
  metadata?: Record<string, unknown>;
}

/** The dimension a budget was breached on. */
export enum BudgetViolationKind {
  DURATION = "duration",
  P95_DURATION = "p95_duration",
  HEAP_GROWTH = "heap_growth",
  THROUGHPUT = "throughput",
}

/** A recorded breach of a declared budget. */
export interface BudgetViolation {
  budget: string;
  kind: BudgetViolationKind;
  /** Value that breached the limit. */
  observed: number;
  /** Limit that was breached. */
  limit: number;
  message: string;
  at: number;
  metadata?: Record<string, unknown>;
}

/** Distribution of observed durations. */
export interface DurationStatistics {
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

/** Aggregated view of one flow against its budget. */
export interface BudgetReport {
  name: string;
  sampleCount: number;
  duration: DurationStatistics;
  /** Sum of per-sample heap deltas, in bytes. */
  heapGrowthBytes: number;
  /** Observations per second, derived from the sample window's span. */
  throughputOpsPerSec: number;
  violations: BudgetViolation[];
  withinBudget: boolean;
  /** The budget the report was evaluated against, when one is registered. */
  budget?: PerformanceBudget;
}

/** How the monitor reacts to a violation. */
export enum BudgetEnforcement {
  /** Collect violations silently for later inspection. */
  COLLECT = "collect",
  /** Collect and emit a `console.warn`. */
  WARN = "warn",
  /** Throw a {@link BudgetExceededError} as soon as a budget is breached. */
  THROW = "throw",
}

/** Raised when enforcement is {@link BudgetEnforcement.THROW}. */
export class BudgetExceededError extends Error {
  public readonly violation: BudgetViolation;

  constructor(violation: BudgetViolation) {
    super(violation.message);
    this.name = "BudgetExceededError";
    this.violation = violation;
  }
}
