/**
 * Tests for performance and memory budgets — Issue #575
 */

import {
  BudgetEnforcement,
  BudgetExceededError,
  BudgetName,
  BudgetViolationKind,
  DEFAULT_PERFORMANCE_BUDGETS,
  DEFAULT_SAMPLE_WINDOW,
  PerformanceBudgetMonitor,
  getDefaultBudget,
  percentile,
  summarizeDurations,
  type BudgetViolation,
  type PerformanceBudget,
} from "../performance";

const FLOW = "test.flow";

/**
 * Deterministic clock. Every read advances by `step`, so a measured function
 * always appears to take exactly `step` milliseconds.
 */
class Clock {
  private value = 0;

  constructor(private step = 0) {}

  now = (): number => {
    const current = this.value;
    this.value += this.step;
    return current;
  };

  setStep(step: number): void {
    this.step = step;
  }

  advance(by: number): void {
    this.value += by;
  }
}

function monitorWith(
  budget: Partial<PerformanceBudget> = {},
  options: ConstructorParameters<typeof PerformanceBudgetMonitor>[0] = {}
): PerformanceBudgetMonitor {
  return new PerformanceBudgetMonitor({
    budgets: [{ name: FLOW, ...budget }],
    now: () => 0,
    heapUsed: () => undefined,
    ...options,
  });
}

describe("percentile", () => {
  it("returns 0 for an empty set rather than NaN", () => {
    expect(percentile([], 0.95)).toBe(0);
  });

  it("uses nearest-rank so the result is always a real observation", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(values).toContain(percentile(values, 0.95));
    expect(percentile(values, 0.95)).toBe(100);
    expect(percentile(values, 0.5)).toBe(50);
  });

  it("does not depend on input order", () => {
    expect(percentile([30, 10, 20], 0.5)).toBe(percentile([10, 20, 30], 0.5));
  });

  it("does not mutate the caller's array", () => {
    const values = [3, 1, 2];
    percentile(values, 0.5);
    expect(values).toEqual([3, 1, 2]);
  });

  it("clamps to the extremes", () => {
    expect(percentile([1, 2, 3], 0)).toBe(1);
    expect(percentile([1, 2, 3], 1)).toBe(3);
  });
});

describe("summarizeDurations", () => {
  it("returns zeroes for an empty set", () => {
    expect(summarizeDurations([])).toEqual({
      min: 0,
      max: 0,
      mean: 0,
      p50: 0,
      p95: 0,
      p99: 0,
    });
  });

  it("computes min, max and mean", () => {
    const stats = summarizeDurations([2, 4, 6]);
    expect(stats.min).toBe(2);
    expect(stats.max).toBe(6);
    expect(stats.mean).toBe(4);
  });

  it("handles a single observation", () => {
    const stats = summarizeDurations([7]);
    expect(stats).toEqual({ min: 7, max: 7, mean: 7, p50: 7, p95: 7, p99: 7 });
  });
});

describe("default budgets", () => {
  it("looks up a default budget by name", () => {
    expect(getDefaultBudget(BudgetName.EVENT_PROCESS)?.maxDurationMs).toBe(25);
  });

  it("returns undefined for an unknown name", () => {
    expect(getDefaultBudget("nope")).toBeUndefined();
  });

  it("declares a unique name per budget", () => {
    const names = DEFAULT_PERFORMANCE_BUDGETS.map((budget) => budget.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps every p95 budget at or below its hard ceiling", () => {
    DEFAULT_PERFORMANCE_BUDGETS.forEach((budget) => {
      if (budget.maxP95DurationMs !== undefined && budget.maxDurationMs !== undefined) {
        expect(budget.maxP95DurationMs).toBeLessThanOrEqual(budget.maxDurationMs);
      }
    });
  });

  it("is applied automatically when no budgets are supplied", () => {
    const monitor = new PerformanceBudgetMonitor();
    expect(monitor.getBudget(BudgetName.EVENT_PROCESS)).toBeDefined();
  });

  it("is replaced when explicit budgets are supplied", () => {
    const monitor = monitorWith();
    expect(monitor.getBudget(BudgetName.EVENT_PROCESS)).toBeUndefined();
    expect(monitor.getBudget(FLOW)).toBeDefined();
  });

  it("is merged when extendDefaults is set", () => {
    const monitor = monitorWith({}, { extendDefaults: true });
    expect(monitor.getBudget(BudgetName.EVENT_PROCESS)).toBeDefined();
    expect(monitor.getBudget(FLOW)).toBeDefined();
  });

  it("lets an explicit budget override a default of the same name", () => {
    const monitor = new PerformanceBudgetMonitor({
      budgets: [{ name: BudgetName.EVENT_PROCESS, maxDurationMs: 1 }],
      extendDefaults: true,
    });
    expect(monitor.getBudget(BudgetName.EVENT_PROCESS)?.maxDurationMs).toBe(1);
  });
});

describe("recording samples", () => {
  it("tracks a flow once it has a sample", () => {
    const monitor = monitorWith();
    expect(monitor.trackedFlows()).toEqual([]);
    monitor.record(FLOW, 5);
    expect(monitor.trackedFlows()).toEqual([FLOW]);
  });

  it("records flows that have no budget at all", () => {
    const monitor = monitorWith();
    monitor.record("unbudgeted", 5);
    expect(monitor.report("unbudgeted").sampleCount).toBe(1);
    expect(monitor.report("unbudgeted").withinBudget).toBe(true);
  });

  it("stamps the sample using the injected clock", () => {
    const clock = new Clock(1);
    const monitor = monitorWith({}, { now: clock.now });
    expect(monitor.record(FLOW, 5).at).toBe(0);
    expect(monitor.record(FLOW, 5).at).toBe(1);
  });

  it("honours an explicit timestamp", () => {
    expect(monitorWith().record(FLOW, 5, { at: 999 }).at).toBe(999);
  });

  it("trims to the configured sample window, keeping the newest", () => {
    const monitor = monitorWith({ sampleWindow: 3 });
    [1, 2, 3, 4, 5].forEach((value) => monitor.record(FLOW, value));

    const report = monitor.report(FLOW);
    expect(report.sampleCount).toBe(3);
    expect(report.duration.min).toBe(3);
    expect(report.duration.max).toBe(5);
  });

  it("falls back to the default sample window", () => {
    const monitor = monitorWith();
    for (let i = 0; i < DEFAULT_SAMPLE_WINDOW + 10; i += 1) monitor.record(FLOW, 1);
    expect(monitor.report(FLOW).sampleCount).toBe(DEFAULT_SAMPLE_WINDOW);
  });

  it("carries metadata through onto the sample", () => {
    const sample = monitorWith().record(FLOW, 5, { metadata: { attempt: 2 } });
    expect(sample.metadata).toEqual({ attempt: 2 });
  });
});

describe("measure", () => {
  it("times a synchronous function and returns its value", () => {
    const clock = new Clock(12);
    const monitor = monitorWith({}, { now: clock.now });

    expect(monitor.measure(FLOW, () => "value")).toBe("value");
    expect(monitor.report(FLOW).duration.max).toBe(12);
  });

  it("still records the timing when the function throws", () => {
    const clock = new Clock(9);
    const monitor = monitorWith({}, { now: clock.now });

    expect(() =>
      monitor.measure(FLOW, () => {
        throw new Error("boom");
      })
    ).toThrow("boom");

    expect(monitor.report(FLOW).sampleCount).toBe(1);
    expect(monitor.report(FLOW).duration.max).toBe(9);
  });

  it("times an asynchronous function and returns its value", async () => {
    const clock = new Clock(20);
    const monitor = monitorWith({}, { now: clock.now });

    await expect(monitor.measureAsync(FLOW, async () => "async")).resolves.toBe("async");
    expect(monitor.report(FLOW).duration.max).toBe(20);
  });

  it("still records the timing when the promise rejects", async () => {
    const clock = new Clock(20);
    const monitor = monitorWith({}, { now: clock.now });

    await expect(
      monitor.measureAsync(FLOW, async () => {
        throw new Error("async boom");
      })
    ).rejects.toThrow("async boom");

    expect(monitor.report(FLOW).sampleCount).toBe(1);
  });

  it("captures the heap delta across the call", () => {
    const heap = [1_000, 3_000];
    const monitor = monitorWith({}, { heapUsed: () => heap.shift() });

    monitor.measure(FLOW, () => undefined);
    expect(monitor.report(FLOW).heapGrowthBytes).toBe(2_000);
  });

  it("skips heap accounting when the probe returns undefined", () => {
    const monitor = monitorWith({}, { heapUsed: () => undefined });
    monitor.measure(FLOW, () => undefined);
    expect(monitor.report(FLOW).heapGrowthBytes).toBe(0);
  });
});

describe("enforcement", () => {
  it("collects violations without throwing by default", () => {
    const monitor = monitorWith({ maxDurationMs: 10 });
    expect(() => monitor.record(FLOW, 50)).not.toThrow();

    const violations = monitor.getViolations();
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe(BudgetViolationKind.DURATION);
    expect(violations[0].observed).toBe(50);
    expect(violations[0].limit).toBe(10);
  });

  it("does not flag a sample exactly on the limit", () => {
    const monitor = monitorWith({ maxDurationMs: 10 });
    monitor.record(FLOW, 10);
    expect(monitor.getViolations()).toHaveLength(0);
  });

  it("warns without throwing in WARN mode", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const monitor = monitorWith(
      { maxDurationMs: 10 },
      { enforcement: BudgetEnforcement.WARN }
    );

    expect(() => monitor.record(FLOW, 50)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("exceeds budget"));
    warn.mockRestore();
  });

  it("throws in THROW mode", () => {
    const monitor = monitorWith(
      { maxDurationMs: 10 },
      { enforcement: BudgetEnforcement.THROW }
    );

    expect(() => monitor.record(FLOW, 50)).toThrow(BudgetExceededError);
  });

  it("exposes the violation on the thrown error", () => {
    const monitor = monitorWith(
      { maxDurationMs: 10 },
      { enforcement: BudgetEnforcement.THROW }
    );

    try {
      monitor.record(FLOW, 50);
      throw new Error("expected a BudgetExceededError");
    } catch (error) {
      expect(error).toBeInstanceOf(BudgetExceededError);
      expect((error as BudgetExceededError).violation.budget).toBe(FLOW);
      expect((error as BudgetExceededError).name).toBe("BudgetExceededError");
    }
  });

  it("invokes onViolation regardless of enforcement mode", () => {
    const seen: BudgetViolation[] = [];
    const monitor = monitorWith(
      { maxDurationMs: 10 },
      { onViolation: (violation) => seen.push(violation) }
    );

    monitor.record(FLOW, 50);
    expect(seen).toHaveLength(1);
    expect(seen[0].budget).toBe(FLOW);
  });

  it("never lets a throwing onViolation mask the measured flow", () => {
    const monitor = monitorWith(
      { maxDurationMs: 10 },
      {
        onViolation: () => {
          throw new Error("reporter is broken");
        },
      }
    );

    expect(() => monitor.record(FLOW, 50)).not.toThrow();
    expect(monitor.getViolations()).toHaveLength(1);
  });

  it("returns a copy of the violation list", () => {
    const monitor = monitorWith({ maxDurationMs: 10 });
    monitor.record(FLOW, 50);
    monitor.getViolations().push({} as BudgetViolation);
    expect(monitor.getViolations()).toHaveLength(1);
  });
});

describe("report", () => {
  it("reports an empty flow as within budget", () => {
    const report = monitorWith({ maxDurationMs: 1 }).report(FLOW);
    expect(report.sampleCount).toBe(0);
    expect(report.withinBudget).toBe(true);
  });

  it("flags a p95 breach even when no single sample breached the hard limit", () => {
    const monitor = monitorWith({ maxDurationMs: 1_000, maxP95DurationMs: 10 });
    // 10% of the window is slow, so nearest-rank p95 lands on a slow sample,
    // while every individual sample stays under the hard ceiling.
    for (let i = 0; i < 18; i += 1) monitor.record(FLOW, 5);
    monitor.record(FLOW, 500);
    monitor.record(FLOW, 500);

    const report = monitor.report(FLOW);
    expect(monitor.getViolations()).toHaveLength(0);
    expect(report.duration.p95).toBe(500);
    expect(report.withinBudget).toBe(false);
    expect(report.violations[0].kind).toBe(BudgetViolationKind.P95_DURATION);
  });

  it("does not flag a p95 breach for a lone outlier in a full window", () => {
    const monitor = monitorWith({ maxDurationMs: 1_000, maxP95DurationMs: 10 });
    for (let i = 0; i < 19; i += 1) monitor.record(FLOW, 5);
    monitor.record(FLOW, 500);

    expect(monitor.report(FLOW).withinBudget).toBe(true);
  });

  it("flags cumulative heap growth across the window", () => {
    const monitor = monitorWith({ maxHeapGrowthBytes: 1_000 });
    monitor.record(FLOW, 1, { heapUsedDeltaBytes: 600 });
    monitor.record(FLOW, 1, { heapUsedDeltaBytes: 600 });

    const report = monitor.report(FLOW);
    expect(report.heapGrowthBytes).toBe(1_200);
    expect(report.violations[0].kind).toBe(BudgetViolationKind.HEAP_GROWTH);
  });

  it("flags throughput below the floor", () => {
    const monitor = monitorWith({ minThroughputOpsPerSec: 100 });
    // Two samples one second apart is 2 ops/s.
    monitor.record(FLOW, 1, { at: 0 });
    monitor.record(FLOW, 1, { at: 1_000 });

    const report = monitor.report(FLOW);
    expect(report.throughputOpsPerSec).toBeCloseTo(2);
    expect(report.violations[0].kind).toBe(BudgetViolationKind.THROUGHPUT);
  });

  it("does not judge throughput from a single sample", () => {
    const monitor = monitorWith({ minThroughputOpsPerSec: 100 });
    monitor.record(FLOW, 1, { at: 0 });

    const report = monitor.report(FLOW);
    expect(report.throughputOpsPerSec).toBe(0);
    expect(report.withinBudget).toBe(true);
  });

  it("includes immediate duration violations alongside window violations", () => {
    const monitor = monitorWith({ maxDurationMs: 10, maxP95DurationMs: 5 });
    monitor.record(FLOW, 50);

    const kinds = monitor.report(FLOW).violations.map((violation) => violation.kind);
    expect(kinds).toContain(BudgetViolationKind.DURATION);
    expect(kinds).toContain(BudgetViolationKind.P95_DURATION);
  });

  it("attaches the budget it evaluated against", () => {
    const monitor = monitorWith({ maxDurationMs: 10 });
    monitor.record(FLOW, 1);
    expect(monitor.report(FLOW).budget?.name).toBe(FLOW);
  });

  it("reports every tracked flow", () => {
    const monitor = monitorWith();
    monitor.record(FLOW, 1);
    monitor.record("other", 1);
    expect(monitor.reportAll().map((report) => report.name)).toEqual([FLOW, "other"]);
  });
});

describe("assertions", () => {
  it("returns the report when the flow is within budget", () => {
    const monitor = monitorWith({ maxDurationMs: 100 });
    monitor.record(FLOW, 1);
    expect(monitor.assertWithinBudget(FLOW).withinBudget).toBe(true);
  });

  it("throws when the flow is over budget", () => {
    const monitor = monitorWith({ maxDurationMs: 10 });
    monitor.record(FLOW, 50);
    expect(() => monitor.assertWithinBudget(FLOW)).toThrow(BudgetExceededError);
  });

  it("throws when any tracked flow is over budget", () => {
    const monitor = new PerformanceBudgetMonitor({
      budgets: [
        { name: FLOW, maxDurationMs: 100 },
        { name: "slow", maxDurationMs: 1 },
      ],
      now: () => 0,
      heapUsed: () => undefined,
    });

    monitor.record(FLOW, 1);
    monitor.record("slow", 50);

    expect(() => monitor.assertAllWithinBudget()).toThrow(/slow/);
  });

  it("passes when every tracked flow is within budget", () => {
    const monitor = monitorWith({ maxDurationMs: 100 });
    monitor.record(FLOW, 1);
    expect(monitor.assertAllWithinBudget()).toHaveLength(1);
  });
});

describe("lifecycle", () => {
  it("clears samples and violations on reset", () => {
    const monitor = monitorWith({ maxDurationMs: 10 });
    monitor.record(FLOW, 50);

    monitor.reset();

    expect(monitor.trackedFlows()).toEqual([]);
    expect(monitor.getViolations()).toEqual([]);
    expect(monitor.report(FLOW).withinBudget).toBe(true);
  });

  it("keeps registered budgets across a reset", () => {
    const monitor = monitorWith({ maxDurationMs: 10 });
    monitor.record(FLOW, 50);
    monitor.reset();
    expect(monitor.getBudget(FLOW)?.maxDurationMs).toBe(10);
  });

  it("allows a budget to be registered after construction", () => {
    const monitor = new PerformanceBudgetMonitor({ budgets: [], now: () => 0 });
    monitor.setBudget({ name: FLOW, maxDurationMs: 10 });
    monitor.record(FLOW, 50);
    expect(monitor.getViolations()).toHaveLength(1);
  });

  it("returns itself from chainable methods", () => {
    const monitor = monitorWith();
    expect(monitor.setBudget({ name: FLOW })).toBe(monitor);
    expect(monitor.reset()).toBe(monitor);
  });
});
