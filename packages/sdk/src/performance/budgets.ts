/**
 * Default performance and memory budgets for the SDK's hot paths.
 *
 * The numbers are deliberately generous — the point of a budget is to catch
 * an order-of-magnitude regression, not to fail on ordinary jitter or on a
 * loaded CI runner. Applications with tighter requirements can override any
 * budget when constructing a {@link PerformanceBudgetMonitor}.
 */

import type { PerformanceBudget } from "./types";

/** Canonical names for the flows the SDK budgets by default. */
export const BudgetName = {
  /** Producing a signature through a provider. */
  SIGNER_SIGN_TRANSACTION: "signer.signTransaction",
  /** Opening or reconnecting a signer session. */
  SIGNER_SESSION_LIFECYCLE: "signer.sessionLifecycle",
  /** Verifying a signature. */
  SIGNER_VERIFY_SIGNATURE: "signer.verifySignature",
  /** Handling a single event from a stream. */
  EVENT_PROCESS: "event.process",
  /** Draining a batch of buffered events. */
  EVENT_BATCH_DRAIN: "event.batchDrain",
  /** Validating and normalizing an advanced operation plan. */
  OPERATION_COMPOSE: "operation.compose",
} as const;

/** Union of the canonical budget names. */
export type BudgetNameValue = (typeof BudgetName)[keyof typeof BudgetName];

/** Budgets applied when a monitor is constructed without overrides. */
export const DEFAULT_PERFORMANCE_BUDGETS: PerformanceBudget[] = [
  {
    name: BudgetName.SIGNER_SIGN_TRANSACTION,
    description:
      "A single signature request, excluding human confirmation on hardware devices.",
    maxDurationMs: 2_000,
    maxP95DurationMs: 1_000,
    maxHeapGrowthBytes: 8 * 1024 * 1024,
  },
  {
    name: BudgetName.SIGNER_SESSION_LIFECYCLE,
    description: "Opening or reconnecting a signer session.",
    maxDurationMs: 5_000,
    maxP95DurationMs: 2_500,
  },
  {
    name: BudgetName.SIGNER_VERIFY_SIGNATURE,
    description: "Verifying one signature against a payload.",
    maxDurationMs: 50,
    maxP95DurationMs: 20,
    minThroughputOpsPerSec: 100,
  },
  {
    name: BudgetName.EVENT_PROCESS,
    description: "Handling a single event from a subscription.",
    maxDurationMs: 25,
    maxP95DurationMs: 10,
    maxHeapGrowthBytes: 4 * 1024 * 1024,
    minThroughputOpsPerSec: 200,
    sampleWindow: 500,
  },
  {
    name: BudgetName.EVENT_BATCH_DRAIN,
    description: "Draining a batch of buffered events.",
    maxDurationMs: 500,
    maxP95DurationMs: 250,
    maxHeapGrowthBytes: 16 * 1024 * 1024,
  },
  {
    name: BudgetName.OPERATION_COMPOSE,
    description: "Validating and normalizing an advanced operation plan.",
    maxDurationMs: 50,
    maxP95DurationMs: 15,
    minThroughputOpsPerSec: 200,
  },
];

/** Look up a default budget by name. */
export function getDefaultBudget(name: string): PerformanceBudget | undefined {
  return DEFAULT_PERFORMANCE_BUDGETS.find((budget) => budget.name === name);
}
