/**
 * Performance and memory budgets for high-throughput signer and event flows.
 *
 * Declare the envelope a hot path must stay inside, measure it, and turn
 * regressions into explicit violations that a benchmark or CI job can fail
 * on rather than silent slowdowns.
 *
 * @example
 * ```ts
 * import {
 *   BudgetEnforcement,
 *   BudgetName,
 *   PerformanceBudgetMonitor,
 * } from "@chen-pilot/sdk-core";
 *
 * const monitor = new PerformanceBudgetMonitor({
 *   enforcement: BudgetEnforcement.WARN,
 * });
 *
 * for (const event of events) {
 *   monitor.measure(BudgetName.EVENT_PROCESS, () => handle(event));
 * }
 *
 * monitor.assertWithinBudget(BudgetName.EVENT_PROCESS);
 * ```
 */

export * from "./types";
export {
  BudgetName,
  DEFAULT_PERFORMANCE_BUDGETS,
  getDefaultBudget,
  type BudgetNameValue,
} from "./budgets";
export {
  DEFAULT_SAMPLE_WINDOW,
  PerformanceBudgetMonitor,
  percentile,
  summarizeDurations,
  type PerformanceBudgetMonitorOptions,
} from "./budgetMonitor";
