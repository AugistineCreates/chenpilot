/**
 * Submission state machine for network transactions.
 *
 * A timeout while submitting does not tell us whether the transaction was
 * rejected, accepted or already applied to a ledger. That ambiguity is modelled
 * as an explicit, durable state instead of being collapsed into a failure.
 *
 *   built ─────► submitting ─┬─► accepted ─────► finalized
 *     │                      │        │
 *     │                      ├────────┴──► unknown ──► finalized | rejected | expired
 *     │                      └─► rejected
 *     └─► expired | rejected
 *
 * Only `finalized`, `rejected` and `expired` are terminal. Only `rejected` and
 * `expired` prove that no economic effect was produced, so they are the only
 * states a retry may start from.
 */
export enum SubmissionState {
  /** Envelope built and persisted. Not handed to the network yet. */
  BUILT = "built",
  /** Handed to the provider. Outcome not yet known. */
  SUBMITTING = "submitting",
  /** Outcome is ambiguous. Must be resolved before any retry or compensation. */
  UNKNOWN = "unknown",
  /** Provider acknowledged receipt. Not yet included in a ledger. */
  ACCEPTED = "accepted",
  /** Included in a ledger and applied successfully. */
  FINALIZED = "finalized",
  /** Proven not applied: invalid envelope, failed in ledger, or sequence burnt. */
  REJECTED = "rejected",
  /** Time bounds elapsed with the sequence unconsumed. Safe to rebuild. */
  EXPIRED = "expired",
}

export const VALID_SUBMISSION_TRANSITIONS: Readonly<
  Record<SubmissionState, ReadonlySet<SubmissionState>>
> = {
  [SubmissionState.BUILT]: new Set([
    SubmissionState.SUBMITTING,
    SubmissionState.UNKNOWN,
    SubmissionState.FINALIZED,
    SubmissionState.REJECTED,
    SubmissionState.EXPIRED,
  ]),
  [SubmissionState.SUBMITTING]: new Set([
    SubmissionState.ACCEPTED,
    SubmissionState.UNKNOWN,
    SubmissionState.FINALIZED,
    SubmissionState.REJECTED,
    SubmissionState.EXPIRED,
  ]),
  [SubmissionState.UNKNOWN]: new Set([
    SubmissionState.ACCEPTED,
    SubmissionState.FINALIZED,
    SubmissionState.REJECTED,
    SubmissionState.EXPIRED,
  ]),
  [SubmissionState.ACCEPTED]: new Set([
    SubmissionState.FINALIZED,
    SubmissionState.REJECTED,
    SubmissionState.UNKNOWN,
    SubmissionState.EXPIRED,
  ]),
  [SubmissionState.FINALIZED]: new Set(),
  [SubmissionState.REJECTED]: new Set(),
  [SubmissionState.EXPIRED]: new Set(),
};

export const TERMINAL_SUBMISSION_STATES: ReadonlySet<SubmissionState> = new Set(
  [SubmissionState.FINALIZED, SubmissionState.REJECTED, SubmissionState.EXPIRED]
);

/** States where a duplicate economic effect is still possible. */
export const AMBIGUOUS_SUBMISSION_STATES: ReadonlySet<SubmissionState> =
  new Set([
    SubmissionState.BUILT,
    SubmissionState.SUBMITTING,
    SubmissionState.UNKNOWN,
    SubmissionState.ACCEPTED,
  ]);

/**
 * States the resolver can conclude with. Every resolvable state must be able to
 * transition into all of them, otherwise a resolution pass would throw and the
 * record would be stranded. `SubmissionState.reachability` in the test suite
 * enforces this.
 */
export const RESOLUTION_OUTCOME_STATES: ReadonlySet<SubmissionState> = new Set([
  SubmissionState.FINALIZED,
  SubmissionState.REJECTED,
  SubmissionState.EXPIRED,
  SubmissionState.UNKNOWN,
]);

/** States the resolver keeps working on until they reach a terminal state. */
export const RESOLVABLE_SUBMISSION_STATES: ReadonlySet<SubmissionState> =
  new Set([
    SubmissionState.BUILT,
    SubmissionState.SUBMITTING,
    SubmissionState.UNKNOWN,
    SubmissionState.ACCEPTED,
  ]);

export function isTerminalSubmissionState(state: SubmissionState): boolean {
  return TERMINAL_SUBMISSION_STATES.has(state);
}

export function canTransitionSubmission(
  from: SubmissionState,
  to: SubmissionState
): boolean {
  return VALID_SUBMISSION_TRANSITIONS[from].has(to);
}

export class InvalidSubmissionTransitionError extends Error {
  constructor(
    public readonly submissionId: string,
    public readonly from: SubmissionState,
    public readonly to: SubmissionState
  ) {
    super(
      `Invalid submission transition '${from}' -> '${to}' for submission ${submissionId}`
    );
    this.name = "InvalidSubmissionTransitionError";
  }
}

export function assertSubmissionTransition(
  submissionId: string,
  from: SubmissionState,
  to: SubmissionState
): void {
  if (!canTransitionSubmission(from, to)) {
    throw new InvalidSubmissionTransitionError(submissionId, from, to);
  }
}

/**
 * A retry is only safe once we can prove the previous attempt produced no
 * effect. Everything else — including `built`, because the envelope may have
 * reached the network before the process died — must be resolved first.
 */
export function isRetrySafe(state: SubmissionState): boolean {
  return (
    state === SubmissionState.REJECTED || state === SubmissionState.EXPIRED
  );
}

/**
 * Raised when a caller tries to reuse a submission that already reached a
 * terminal, non-applied state. Those envelopes cannot be sent again — their
 * sequence slot or time bounds are spent — so the caller must build a new one.
 */
export class SubmissionAlreadyResolvedError extends Error {
  constructor(
    public readonly submissionId: string,
    public readonly state: SubmissionState
  ) {
    super(
      `Submission ${submissionId} already resolved as '${state}'; build and register a new submission instead of resubmitting this envelope`
    );
    this.name = "SubmissionAlreadyResolvedError";
  }
}

export class DuplicateEffectRiskError extends Error {
  constructor(
    public readonly submissionId: string,
    public readonly state: SubmissionState
  ) {
    super(
      `Submission ${submissionId} is in state '${state}'; duplicate-effect risk is unresolved and no retry may run`
    );
    this.name = "DuplicateEffectRiskError";
  }
}
