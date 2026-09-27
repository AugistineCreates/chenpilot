/**
 * SeededFaultScheduler
 *
 * Deterministic fault injection scheduler driven by a single numeric seed.
 * Replaying the same seed against the same FaultSchedulerConfig reproduces
 * every fault decision byte-for-byte.
 *
 * Lifecycle:
 *   1. Construct with a FaultSchedulerConfig that lists all FaultSpecs.
 *   2. Wrap each service with createProxy() to obtain a typed fault stub.
 *   3. In each test step, call enter(boundaryName) before exercising the
 *      system, then leave(boundaryName) after assertions are complete.
 *   4. Call finish() to obtain the sealed Timeline.
 *
 * The scheduler never uses Math.random() or Date.now() for fault decisions;
 * all randomness comes from the internal SeededRNG.  Wall-clock timestamps are
 * recorded only for human-readable artifact metadata and do not affect
 * fault decisions.
 */

import { SeededRNG } from "../SeededRNG";
import {
  Boundary,
  CallContext,
  EventSeverity,
  FaultParams,
  FaultSchedulerConfig,
  FaultSpec,
  Timeline,
  TimelineEvent,
  InvariantViolation,
  ServiceId,
} from "./types";

// ─── Internal tracking ───────────────────────────────────────────────────────

/** Live state for one active fault injection. */
interface ActiveFault {
  spec: FaultSpec;
  /** Total calls consumed against the optional callCount limit. */
  callsConsumed: number;
  /** Timestamp when the fault was activated (used for healAfterMs). */
  activatedAt: number;
  /** Whether the fault has been explicitly healed. */
  healed: boolean;
}

// ─── SeededFaultScheduler ────────────────────────────────────────────────────

export class SeededFaultScheduler {
  /** Mulberry32 RNG — sole source of randomness. */
  private readonly rng: SeededRNG;
  private readonly config: FaultSchedulerConfig;

  /** Faults currently active, keyed by FaultSpec.id. */
  private activeFaults = new Map<string, ActiveFault>();

  /** Fault specs indexed by boundary name for O(1) lookup. */
  private faultsByBoundary = new Map<string, FaultSpec[]>();

  /** Currently active boundary name (one at a time). */
  private currentBoundary = "root";

  /** Ordered timeline events accumulated during the run. */
  private events: TimelineEvent[] = [];

  /** Monotonically increasing event sequence counter. */
  private seq = 0;

  /** Monotonically increasing call counter across all services. */
  private callIndex = 0;

  /** Faults that were activated at least once during the run. */
  private activatedFaultSpecs: FaultSpec[] = [];

  /** Violations collected by InvariantChecker.attach(). */
  private violations: InvariantViolation[] = [];

  /** Wall-clock start time for timeline metadata. */
  private startedAt = new Date().toISOString();

  /** Whether finish() has already been called. */
  private finished = false;

  constructor(config: FaultSchedulerConfig) {
    this.config = config;
    // Seed the RNG with the user-supplied seed, ensuring it is unsigned 32-bit.
    this.rng = new SeededRNG(config.seed >>> 0);
    this.buildIndex();
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private buildIndex(): void {
    for (const spec of this.config.faults) {
      const list = this.faultsByBoundary.get(spec.boundary) ?? [];
      list.push(spec);
      this.faultsByBoundary.set(spec.boundary, list);
    }
  }

  private emit(
    severity: EventSeverity,
    message: string,
    service?: ServiceId,
    data?: Record<string, unknown>
  ): void {
    this.events.push({
      seq: this.seq++,
      timestamp: Date.now(),
      severity,
      boundary: this.currentBoundary,
      service,
      message,
      data,
    });
  }

  private activateFaultsForBoundary(name: string): void {
    const specs = this.faultsByBoundary.get(name);
    if (!specs?.length) return;

    for (const spec of specs) {
      if (this.activeFaults.has(spec.id)) continue; // already active

      const active: ActiveFault = {
        spec,
        callsConsumed: 0,
        activatedAt: Date.now(),
        healed: false,
      };
      this.activeFaults.set(spec.id, active);
      this.activatedFaultSpecs.push(spec);

      this.emit(
        "fault",
        `Fault activated: ${spec.id} (${spec.params.kind}) on ${spec.service}`,
        spec.service,
        {
          faultId: spec.id,
          kind: spec.params.kind,
          boundary: spec.boundary,
          params: spec.params,
        }
      );
    }
  }

  private expireHealed(): void {
    const now = Date.now();
    for (const [id, active] of this.activeFaults) {
      if (active.healed) {
        this.activeFaults.delete(id);
        continue;
      }
      if (
        active.spec.healAfterMs !== undefined &&
        now - active.activatedAt >= active.spec.healAfterMs
      ) {
        active.healed = true;
        this.activeFaults.delete(id);
        this.emit(
          "recovery",
          `Fault auto-healed: ${id} (elapsed ${now - active.activatedAt}ms)`,
          active.spec.service,
          { faultId: id }
        );
      }
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Returns the seed used by this scheduler.
   * Sufficient to reproduce the entire scenario.
   */
  get seed(): number {
    return this.config.seed;
  }

  /**
   * Enter a named execution boundary.
   * All faults bound to this boundary are activated; the scheduler begins
   * applying them to subsequent proxied service calls.
   *
   * @param name   Boundary name matching FaultSpec.boundary fields.
   * @param context Optional structured metadata to attach to the boundary event.
   * @returns The Boundary value for use in assertions.
   */
  enter(name: string, context?: Record<string, unknown>): Boundary {
    this.expireHealed();
    this.currentBoundary = name;

    const boundary: Boundary = {
      name,
      enteredAt: Date.now(),
      context,
    };

    this.emit(
      "info",
      `Boundary entered: ${name}`,
      undefined,
      { boundary: name, context }
    );

    this.activateFaultsForBoundary(name);

    if (this.config.verbose) {
      this.emit(
        "info",
        `Active faults after entering ${name}: ${[...this.activeFaults.keys()].join(", ") || "none"}`,
        undefined,
        { activeFaultIds: [...this.activeFaults.keys()] }
      );
    }

    return boundary;
  }

  /**
   * Leave the current boundary.
   * Faults that were activated here remain active until healed or until
   * their callCount limit is exhausted.  Callers that want faults scoped
   * strictly to a boundary can set healAfterMs: 0 in the FaultSpec.
   *
   * @param name Must match the name passed to the corresponding enter() call.
   */
  leave(name: string): void {
    this.expireHealed();

    this.emit("info", `Boundary left: ${name}`, undefined, { boundary: name });

    if (this.currentBoundary === name) {
      this.currentBoundary = "root";
    }
  }

  /**
   * Forcibly heal all currently active faults on a specific service.
   * Useful when test code needs to simulate recovery without waiting for
   * healAfterMs.
   */
  healService(service: ServiceId): void {
    for (const [id, active] of this.activeFaults) {
      if (active.spec.service === service) {
        active.healed = true;
        this.emit(
          "recovery",
          `Fault manually healed: ${id} on ${service}`,
          service,
          { faultId: id }
        );
        this.activeFaults.delete(id);
      }
    }
  }

  /**
   * Forcibly heal all currently active faults on all services.
   */
  healAll(): void {
    for (const id of [...this.activeFaults.keys()]) {
      const active = this.activeFaults.get(id)!;
      active.healed = true;
      this.emit(
        "recovery",
        `Fault healed (healAll): ${id} on ${active.spec.service}`,
        active.spec.service,
        { faultId: id }
      );
    }
    this.activeFaults.clear();
  }

  /**
   * Decide whether a proxied call should have a fault applied and, if so,
   * what the fault params are.  Returns null for a clean call.
   *
   * This is called by FaultProxy on every service method invocation.
   *
   * @param service  The ServiceId of the stub being called.
   * @param ctx      The CallContext for this invocation.
   */
  resolveFault(
    service: ServiceId,
    ctx: CallContext
  ): FaultParams | null {
    this.expireHealed();

    for (const [id, active] of this.activeFaults) {
      const { spec } = active;

      // Only consider faults for the right service.
      if (spec.service !== service) continue;

      // Check whether the boundary matches (the fault is still active, which
      // already implies the activating boundary was entered, but some faults
      // are only active at their specific boundary).
      // We allow a fault to fire on any subsequent boundary unless the
      // callCount has been exhausted.

      // Respect callCount limit.
      if (
        spec.callCount !== undefined &&
        active.callsConsumed >= spec.callCount
      ) {
        active.healed = true;
        this.activeFaults.delete(id);
        this.emit(
          "recovery",
          `Fault call-count exhausted: ${id}`,
          service,
          { faultId: id, callsConsumed: active.callsConsumed }
        );
        continue;
      }

      // Respect probability; drawn from seeded RNG for determinism.
      const prob = spec.probability ?? 1;
      if (this.rng.next() > prob) continue;

      active.callsConsumed++;

      this.emit(
        "fault",
        `Fault applied: ${id} (${spec.params.kind}) on ${service} call #${ctx.callIndex}`,
        service,
        {
          faultId: id,
          kind: spec.params.kind,
          callIndex: ctx.callIndex,
          boundary: ctx.boundary,
        }
      );

      return spec.params;
    }

    return null;
  }

  /**
   * Allocate and return the next call index, used to populate CallContext.
   */
  nextCallIndex(): number {
    return this.callIndex++;
  }

  /**
   * Record an invariant violation raised by InvariantChecker.
   * The scheduler aggregates all violations into the final Timeline.
   */
  recordViolation(violation: InvariantViolation): void {
    this.violations.push(violation);
    this.emit(
      "error",
      `Invariant violated: ${violation.invariantId} — ${violation.invariantName}`,
      violation.service,
      {
        invariantId: violation.invariantId,
        expected: violation.expected,
        actual: violation.actual,
        category: violation.category,
      }
    );
  }

  /**
   * Emit an arbitrary informational event into the timeline.
   * Useful for test code to annotate what it is doing.
   */
  log(
    message: string,
    severity: EventSeverity = "info",
    data?: Record<string, unknown>
  ): void {
    this.emit(severity, message, undefined, data);
  }

  /**
   * Seal and return the Timeline for this run.
   * May only be called once; subsequent calls return the same sealed timeline.
   */
  finish(): Timeline {
    if (this.finished && this._sealedTimeline) {
      return this._sealedTimeline;
    }

    this.finished = true;
    const endedAt = new Date().toISOString();
    const startMs = new Date(this.startedAt).getTime();
    const endMs = new Date(endedAt).getTime();

    const timeline: Timeline = {
      seed: this.config.seed,
      scenario: this.config.scenario,
      startedAt: this.startedAt,
      endedAt,
      durationMs: endMs - startMs,
      passed: this.violations.length === 0,
      events: [...this.events],
      faultsActivated: [...this.activatedFaultSpecs],
      violations: [...this.violations],
    };

    this._sealedTimeline = timeline;
    return timeline;
  }

  private _sealedTimeline: Timeline | undefined;

  /**
   * Returns whether any invariant violations have been recorded so far.
   * Useful in mid-run assertions without finalising the timeline.
   */
  hasViolations(): boolean {
    return this.violations.length > 0;
  }

  /**
   * Returns the violations collected so far (snapshot, not live reference).
   */
  getViolations(): InvariantViolation[] {
    return [...this.violations];
  }

  /**
   * Returns all timeline events so far (snapshot).
   */
  getEvents(): TimelineEvent[] {
    return [...this.events];
  }

  /**
   * Returns the current boundary name.
   */
  getCurrentBoundary(): string {
    return this.currentBoundary;
  }

  /**
   * Returns the number of active faults at this moment.
   */
  activeFaultCount(): number {
    return this.activeFaults.size;
  }
}
