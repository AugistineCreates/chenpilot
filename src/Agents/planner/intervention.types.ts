/**
 * intervention.types.ts
 *
 * Signed operator intervention commands for stuck/failed durable executions.
 *
 * Five command types are defined, each with strict preconditions that must be
 * satisfied before an intervention can be applied.  High-risk commands require
 * multi-party approval via the existing AdminWorkflowService before they can
 * be executed.  All commands carry a dry-run mode that explains the resulting
 * state changes without committing them.
 *
 * Design invariants
 * ─────────────────
 * 1. Interventions are immutable once recorded — no UPDATE after INSERT.
 * 2. Every intervention is linked to the execution transcript so the full
 *    chain of events is auditable.
 * 3. Interventions cannot invent completed side-effects: SKIP requires an
 *    explicit operator-provided evidence payload; COMPENSATE requires a
 *    compensating-transaction receipt.
 * 4. COMPENSATE and QUARANTINE are high-risk: they require multi-party
 *    approval via AdminWorkflowService.
 */

// ─── Command Types ────────────────────────────────────────────────────────────

/**
 * The five operator intervention commands.
 *
 * RETRY        — Re-run a failed step from scratch, resetting its retry counter.
 *                Preconditions: step is FAILED; execution is FAILED or PAUSED.
 *
 * SKIP         — Mark a failed step as completed without running it again.
 *                Requires an evidence payload explaining why the skip is safe.
 *                Preconditions: step is FAILED; execution is FAILED or PAUSED.
 *
 * COMPENSATE   — Trigger a compensating action to undo a completed step's
 *                side-effects.  Requires a compensationTxId proving the
 *                compensating transaction was submitted on-chain.
 *                HIGH-RISK — requires multi-party approval.
 *                Preconditions: step is COMPLETED; execution is FAILED or PAUSED.
 *
 * QUARANTINE   — Freeze an execution permanently so it can be investigated
 *                without automated retries touching it.
 *                HIGH-RISK — requires multi-party approval.
 *                Preconditions: execution is FAILED, RUNNING, or PAUSED.
 *
 * RESOLVE      — Close a QUARANTINED execution as investigated/resolved.
 *                Preconditions: execution is QUARANTINED.
 */
export enum InterventionCommand {
  RETRY = "retry",
  SKIP = "skip",
  COMPENSATE = "compensate",
  QUARANTINE = "quarantine",
  RESOLVE = "resolve",
}

// ─── Status ───────────────────────────────────────────────────────────────────

export enum InterventionStatus {
  /** Submitted, pending multi-party approval (high-risk commands only) */
  PENDING_APPROVAL = "pending_approval",
  /** Approved (or single-operator command that needed no approval) */
  APPROVED = "approved",
  /** Rejected by an approver */
  REJECTED = "rejected",
  /** Dry-run executed, preview generated, nothing committed */
  DRY_RUN = "dry_run",
  /** Applied to the execution successfully */
  APPLIED = "applied",
  /** Application failed after approval */
  FAILED = "failed",
}

// ─── Risk classification ──────────────────────────────────────────────────────

/**
 * Commands classified as HIGH_RISK require multi-party approval.
 */
export const HIGH_RISK_COMMANDS = new Set<InterventionCommand>([
  InterventionCommand.COMPENSATE,
  InterventionCommand.QUARANTINE,
]);

export function isHighRiskCommand(cmd: InterventionCommand): boolean {
  return HIGH_RISK_COMMANDS.has(cmd);
}

// ─── Precondition results ─────────────────────────────────────────────────────

export interface PreconditionResult {
  satisfied: boolean;
  violations: string[];
}

// ─── Dry-run output ───────────────────────────────────────────────────────────

export interface DryRunStateChange {
  entity: "DurableExecution" | "DurableStep" | "InterventionRecord";
  id: string;
  field: string;
  from: unknown;
  to: unknown;
}

export interface DryRunOutput {
  command: InterventionCommand;
  executionId: string;
  stepNumber?: number;
  changes: DryRunStateChange[];
  /** Human-readable explanation of what would happen */
  summary: string;
  /** Precondition violations, if any */
  violations: string[];
  /** True when all preconditions passed and the intervention would apply cleanly */
  wouldSucceed: boolean;
}

// ─── Command payloads ─────────────────────────────────────────────────────────

export interface RetryPayload {
  /** Optionally override the step payload (e.g. corrected parameters) */
  payloadOverride?: Record<string, unknown>;
  /** Justification recorded in the intervention record */
  reason: string;
}

export interface SkipPayload {
  /**
   * Evidence explaining why the skip is safe.
   * Must not be empty — interventions cannot invent completed side-effects.
   * Examples: off-chain tx hash, external system confirmation ID, manual proof.
   */
  evidence: string;
  /** Override result stored on the skipped step */
  resultOverride?: Record<string, unknown>;
  /** Justification */
  reason: string;
}

export interface CompensatePayload {
  /**
   * On-chain transaction ID of the compensating transaction.
   * Required to prevent inventions of completed side-effects.
   */
  compensationTxId: string;
  /** Step number to compensate */
  targetStepNumber: number;
  /** Justification */
  reason: string;
}

export interface QuarantinePayload {
  /** Why the execution is being quarantined */
  reason: string;
  /** Optional metadata for the investigation queue */
  metadata?: Record<string, unknown>;
}

export interface ResolvePayload {
  /** Resolution outcome summary */
  resolution: string;
  /** Optional post-mortem notes */
  notes?: string;
}

export type InterventionPayload =
  | RetryPayload
  | SkipPayload
  | CompensatePayload
  | QuarantinePayload
  | ResolvePayload;

// ─── Signature envelope ───────────────────────────────────────────────────────

/**
 * An intervention command signed by the initiating operator.
 *
 * The signature binds {command, executionId, stepNumber, payload, nonce, issuedAt}
 * so that a replayed or tampered request is detectable.
 */
export interface SignedInterventionCommand {
  command: InterventionCommand;
  executionId: string;
  /** Required for RETRY, SKIP, COMPENSATE */
  stepNumber?: number;
  payload: InterventionPayload;
  /** If true, compute state changes and return DryRunOutput without committing */
  dryRun: boolean;
  /** Operator's user ID */
  operatorId: string;
  /**
   * HMAC-SHA256 hex digest of the canonical JSON of
   * {command, executionId, stepNumber, payload, nonce, issuedAt}
   * keyed with INTERVENTION_SIGNING_SECRET.
   */
  signature: string;
  /** Random nonce preventing replay attacks */
  nonce: string;
  /** ISO-8601 timestamp; commands older than SIGNATURE_TTL_SECONDS are rejected */
  issuedAt: string;
}

// ─── Service result types ─────────────────────────────────────────────────────

export interface InterventionApplyResult {
  interventionId: string;
  status: InterventionStatus;
  dryRunOutput?: DryRunOutput;
  workflowInstanceId?: string; // set when high-risk command routes to approval
  message: string;
}

// ─── Policy entry ─────────────────────────────────────────────────────────────

export interface InterventionPolicy {
  command: InterventionCommand;
  requiresApproval: boolean;
  requiredApprovals: number;
  approvalTimeoutMinutes: number;
}

export const DEFAULT_INTERVENTION_POLICIES: Record<
  InterventionCommand,
  InterventionPolicy
> = {
  [InterventionCommand.RETRY]: {
    command: InterventionCommand.RETRY,
    requiresApproval: false,
    requiredApprovals: 1,
    approvalTimeoutMinutes: 60,
  },
  [InterventionCommand.SKIP]: {
    command: InterventionCommand.SKIP,
    requiresApproval: false,
    requiredApprovals: 1,
    approvalTimeoutMinutes: 60,
  },
  [InterventionCommand.COMPENSATE]: {
    command: InterventionCommand.COMPENSATE,
    requiresApproval: true,
    requiredApprovals: 2,
    approvalTimeoutMinutes: 120,
  },
  [InterventionCommand.QUARANTINE]: {
    command: InterventionCommand.QUARANTINE,
    requiresApproval: true,
    requiredApprovals: 2,
    approvalTimeoutMinutes: 120,
  },
  [InterventionCommand.RESOLVE]: {
    command: InterventionCommand.RESOLVE,
    requiresApproval: false,
    requiredApprovals: 1,
    approvalTimeoutMinutes: 60,
  },
};
