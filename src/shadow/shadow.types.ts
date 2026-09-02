/**
 * shadow.types.ts
 *
 * Shadow Execution (Issue #686):
 *   - Run candidate planners, policies and route policies in a side-effect-free
 *     shadow path alongside the active version.
 *   - Compare candidate decisions against the active version and classify
 *     divergence (policy / route / amount / refusal).
 *   - Drive reviewable promotion gated behind explicit thresholds and reviewed
 *     exceptions.
 */

/** Decision facet a shadow candidate can vary. */
export type ShadowSubject = "planner" | "policy" | "route";

/** Classification of a single divergence between active and candidate. */
export enum DivergenceClass {
  /** Candidate refused (or allowed) an action the active version treated differently. */
  Refusal = "refusal",
  /** Candidate reached a different policy decision (allowed/requiresApproval/reason). */
  Policy = "policy",
  /** Candidate selected a different route than the active version. */
  Route = "route",
  /** Candidate proposed a materially different amount than the active version. */
  Amount = "amount",
}

/** A candidate variant scheduled for shadow evaluation. */
export interface ShadowCandidate {
  id: string;
  subject: ShadowSubject;
  /** Semantic version of the candidate configuration (e.g. "2.1.0"). */
  version: string;
  /** A stable label used in reports. */
  label: string;
  /** Staged (not yet promoted) until elevated to active. */
  status: "staged" | "active" | "retired";
  /** Configuration payload interpreted by the matching executor (planner/policy/route). */
  config: Record<string, unknown>;
  /** Human note describing the intended behaviour change. */
  description?: string;
  /** Optional explicit reviewer approval required before promotion. */
  reviewRequired?: boolean;
}

/**
 * A canonical, comparable snapshot of a single decision made by one variant.
 * Inputs are privacy-filtered before being compared or persisted.
 */
export interface ShadowDecision {
  /** Subject/version identifying the variant that produced this decision. */
  subject: ShadowSubject;
  /** Variant version the decision belongs to. */
  version: string;
  /** The action / operation name the decision concerns (e.g. "swap_tool"). */
  action: string;
  /** Privacy-filtered request payload used to make the decision. */
  redactedInput: Record<string, unknown>;
  /** Whether the variant allowed (true) or refused (false) the operation. */
  allowed: boolean;
  /** Machine reason for a refusal / approval requirement. */
  reason?: string;
  /** Whether explicit approval was flagged. */
  requiresApproval?: boolean;
  /** Deterministic plan hash for planner candidates. */
  planHash?: string;
  /** Selected route (array of asset codes), when subject is "route". */
  route?: string[];
  /** Proposed amount, when subject is "amount"/"policy" and an amount is known. */
  amount?: string | null;
  /** Normalized policy decision signature — set + reason + requiresApproval. */
  decisionSignature?: string;
}

/** Aggregated divergence observed for one candidate decision. */
export interface DivergenceReport {
  candidateId: string;
  subject: ShadowSubject;
  version: string;
  runId: string;
  diverged: boolean;
  classes: DivergenceClass[];
  details: Array<{
    class: DivergenceClass;
    active?: Partial<ShadowDecision>;
    candidate?: Partial<ShadowDecision>;
    message: string;
  }>;
  /** Whether the observed divergence was within an explicit review exception. */
  reviewedException: boolean;
  evaluatedAt: string;
}

/** Eligibility result for promoting a shadow candidate to active. */
export interface PromotionEligibility {
  eligible: boolean;
  subject: ShadowSubject;
  candidateId: string;
  version: string;
  /** Number of shadow evaluations observed for the candidate. */
  evaluations: number;
  /** Ratio of divergent evaluations to total evaluations. */
  divergenceRate: number;
  reason: string;
}

/** Immutable config driving shadow sampling, retention and promotion gates. */
export interface ShadowConfig {
  enabled: boolean;
  /** Percentage (0-100) of production decisions to mirror into shadow. */
  sampleRatePct: number;
  /** Minimum number of shadow evaluations before a candidate can be promoted. */
  promotionMinEvaluations: number;
  /** Maximum tolerated divergence rate (0-1) for promotion eligibility. */
  promotionMaxDivergenceRate: number;
  /** Retention window in days before shadow records are purged. */
  retentionDays: number;
  /** Hard cap on persisted shadow records (defensive retention bound). */
  maxRecords: number;
  /** Required reviewer approvals for promotion exceptions. */
  promotionRequiredApprovals: number;
}
