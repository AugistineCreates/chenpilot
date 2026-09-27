/**
 * Fault Scheduler — Core Types
 *
 * Defines the vocabulary for correlated, seeded fault injection across the
 * five services that Chen Pilot depends on at runtime:
 *   database · Redis · Horizon · Soroban RPC · LLM
 *
 * Design goals:
 *   1. Every fault scenario is fully reproducible from one numeric seed.
 *   2. Faults attach to named execution boundaries, not to wall-clock time,
 *      so the scheduler remains deterministic even in CI where timing is
 *      non-deterministic.
 *   3. InvariantViolation is a first-class value so CI can surface the exact
 *      post-recovery assertion that failed and attach the timeline artifact.
 */

// ─── Service identifiers ────────────────────────────────────────────────────

/** The five services that can receive injected faults. */
export type ServiceId =
  | "database"
  | "redis"
  | "horizon"
  | "sorobanRpc"
  | "llm";

// ─── Fault kinds ────────────────────────────────────────────────────────────

/**
 * FaultKind enumerates every class of fault that the scheduler can inject.
 *
 * latency          – artificially delay the response by a configurable amount.
 * partition        – simulate a complete network partition; all calls throw.
 * staleRead        – return a cached / outdated response instead of a live one.
 * crash            – simulate a service process crash; subsequent calls fail
 *                    until recovery is signalled.
 * partialResponse  – return a structurally incomplete response (missing fields,
 *                    truncated body, premature stream close).
 * timeout          – resolve after the full timeout deadline with no data.
 * corruptedData    – return syntactically valid but semantically wrong data
 *                    (wrong amounts, inverted flags, wrong account ID).
 */
export type FaultKind =
  | "latency"
  | "partition"
  | "staleRead"
  | "crash"
  | "partialResponse"
  | "timeout"
  | "corruptedData";

// ─── Fault specification ────────────────────────────────────────────────────

/** Parameters that govern a latency fault. */
export interface LatencyParams {
  /** Minimum additional delay in milliseconds. */
  minMs: number;
  /** Maximum additional delay in milliseconds. */
  maxMs: number;
}

/** Parameters that govern a stale-read fault. */
export interface StaleReadParams {
  /**
   * Age of the stale snapshot in milliseconds; e.g. 30_000 means the
   * response looks like it came from 30 seconds ago.
   */
  staleByMs: number;
  /** Optional fixture payload to return verbatim as the stale response. */
  fixedPayload?: unknown;
}

/** Parameters that govern a partial-response fault. */
export interface PartialResponseParams {
  /**
   * Fraction of the expected payload to include (0 < ratio ≤ 1).
   * E.g. 0.5 means only the first half of the response fields are populated.
   */
  completenessRatio: number;
  /** If true, the response also includes a syntactically invalid JSON suffix. */
  malformed?: boolean;
}

/** Parameters that govern a corrupted-data fault. */
export interface CorruptedDataParams {
  /** Which top-level field(s) in the response should be corrupted. */
  targetFields: string[];
  /** Strategy used to corrupt the selected fields. */
  strategy: "negate" | "zero" | "wrongType" | "swapWithAnother";
}

/** Discriminated union of all fault-kind-specific parameter sets. */
export type FaultParams =
  | ({ kind: "latency" } & LatencyParams)
  | { kind: "partition" }
  | ({ kind: "staleRead" } & StaleReadParams)
  | { kind: "crash" }
  | ({ kind: "partialResponse" } & PartialResponseParams)
  | { kind: "timeout" }
  | ({ kind: "corruptedData" } & CorruptedDataParams);

/**
 * FaultSpec fully describes one fault to be injected at one boundary.
 *
 * Multiple FaultSpecs attached to the same boundary are applied in order,
 * enabling compound scenarios (e.g. database latency + Redis partition).
 */
export interface FaultSpec {
  /** Human-readable identifier used in timeline entries and assertion messages. */
  id: string;
  /** Which service receives the fault. */
  service: ServiceId;
  /** The named boundary at which the fault is activated. */
  boundary: string;
  /** Full fault parameterisation, including the discriminant `kind`. */
  params: FaultParams;
  /**
   * How many calls through the proxy should trigger this fault after the
   * boundary fires (default: every call until the boundary is released).
   */
  callCount?: number;
  /**
   * Optional probability [0, 1] that the fault fires on each call.
   * The scheduler draws from its seeded RNG so this is still deterministic.
   */
  probability?: number;
  /**
   * If set, the fault automatically heals after this many milliseconds from
   * first activation.  Tests use fake timers so this is wall-clock-agnostic.
   */
  healAfterMs?: number;
}

// ─── Execution boundaries ───────────────────────────────────────────────────

/**
 * Boundary represents a labelled checkpoint in an execution trace.
 * The scheduler inspects FaultSpecs keyed by `name` and activates matching
 * faults when `enter()` is called.
 */
export interface Boundary {
  /** Globally unique name within a test run, e.g. "pre-commit" or "post-swap". */
  name: string;
  /** Wall-clock timestamp when the boundary was entered (Date.now()). */
  enteredAt: number;
  /**
   * Optional structured metadata attached when the boundary is crossed.
   * Useful for carry-through values like transaction IDs.
   */
  context?: Record<string, unknown>;
}

// ─── Timeline ───────────────────────────────────────────────────────────────

/** Severity of a timeline event. */
export type EventSeverity = "info" | "warn" | "fault" | "recovery" | "error";

/** A single entry in the recorded timeline for a test run. */
export interface TimelineEvent {
  /** Monotonically increasing index within this timeline. */
  seq: number;
  /** Wall-clock time at which the event occurred. */
  timestamp: number;
  severity: EventSeverity;
  /** Name of the boundary that was active when this event was recorded. */
  boundary: string;
  /** Service affected, if applicable. */
  service?: ServiceId;
  /** Free-form description. */
  message: string;
  /** Structured metadata for offline analysis. */
  data?: Record<string, unknown>;
}

/**
 * Timeline is the complete, immutable record of everything that happened
 * during one seeded scenario run.  It is serialised to JSON and uploaded as
 * a CI artifact whenever a scenario fails.
 */
export interface Timeline {
  /** The seed that produced this timeline — sufficient to replay it. */
  seed: number;
  /** Human-readable label for the scenario. */
  scenario: string;
  /** ISO-8601 wall-clock start time. */
  startedAt: string;
  /** ISO-8601 wall-clock end time. */
  endedAt: string;
  /** Total duration in milliseconds. */
  durationMs: number;
  /** Whether the scenario ended without any invariant violation. */
  passed: boolean;
  /** Ordered list of events. */
  events: TimelineEvent[];
  /** All faults that were activated during the run. */
  faultsActivated: FaultSpec[];
  /** All invariant violations detected during the run. */
  violations: InvariantViolation[];
}

// ─── Invariant violations ───────────────────────────────────────────────────

/** Category of the violated invariant, aligned with the existing InvariantEngine. */
export type ViolationCategory =
  | "availability"
  | "consistency"
  | "idempotency"
  | "ordering"
  | "completeness"
  | "safety";

/**
 * InvariantViolation is raised when a post-recovery assertion fails.
 * It is a first-class value (not a thrown exception) so that a single run
 * can collect *all* violations rather than aborting on the first one.
 */
export interface InvariantViolation {
  /** Stable identifier for this invariant, used to deduplicate across reruns. */
  invariantId: string;
  /** Human-readable name. */
  invariantName: string;
  category: ViolationCategory;
  /** Service that was checked. */
  service: ServiceId;
  /** Name of the boundary at which the check was performed. */
  boundary: string;
  /** What the invariant expected. */
  expected: string;
  /** What was actually observed. */
  actual: string;
  /** Optional structured diff or extra context. */
  detail?: Record<string, unknown>;
}

// ─── Scheduler configuration ────────────────────────────────────────────────

/**
 * FaultSchedulerConfig is passed to SeededFaultScheduler on construction.
 * The seed is the only source of entropy; everything else is deterministic.
 */
export interface FaultSchedulerConfig {
  /** 32-bit unsigned integer seed. Replaying the same seed reproduces the run exactly. */
  seed: number;
  /**
   * Named scenario label.  Used in Timeline.scenario and timeline artifact filenames.
   */
  scenario: string;
  /**
   * Ordered list of fault specifications to inject.
   * The scheduler activates them at their named boundaries.
   */
  faults: FaultSpec[];
  /**
   * If true the scheduler emits additional debug timeline events.
   * Defaults to false to keep CI output terse.
   */
  verbose?: boolean;
}

// ─── Proxy call context ─────────────────────────────────────────────────────

/**
 * CallContext is threaded through every proxied service call so the fault
 * proxy can look up which boundary is currently active.
 */
export interface CallContext {
  /** The boundary that was active when this call was initiated. */
  boundary: string;
  /** Monotonically increasing call index within the test run. */
  callIndex: number;
  /** Optional caller-supplied metadata. */
  meta?: Record<string, unknown>;
}

// ─── Service stubs returned by FaultProxy ───────────────────────────────────

/**
 * Minimal interface that every FaultProxy service stub must satisfy.
 * Concrete stubs are typed as intersection of this and the relevant
 * service interface.
 */
export interface FaultProxyStub {
  /**
   * Forcibly heals all active faults for this service.
   * Called by the scheduler when a boundary is released.
   */
  heal(): void;
  /**
   * Returns all fault events accumulated on this stub since the last reset.
   * Used by InvariantChecker to inspect full call history.
   */
  getFaultLog(): FaultLogEntry[];
  /**
   * Returns only fault log entries recorded AFTER heal() was called.
   * Invariant checks should use this to avoid flagging pre-recovery faults.
   */
  getPostHealLog(): FaultLogEntry[];
  /**
   * Resets all accumulated state (call counts, fault log, stale cache).
   */
  reset(): void;
}

/** A single entry in a stub's fault log. */
export interface FaultLogEntry {
  /** Sequential call number on this stub. */
  callIndex: number;
  /** Name of the boundary that was active. */
  boundary: string;
  /** Kind of fault that was applied (undefined if the call was clean). */
  faultApplied?: FaultKind;
  /** Whether the call ultimately resolved successfully. */
  resolved: boolean;
  /** Latency in ms from call start to resolution/rejection. */
  latencyMs: number;
  /** Timestamp of the call. */
  timestamp: number;
}
