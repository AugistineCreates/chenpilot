/**
 * Red-team evaluation types (issue #634).
 *
 * A red-team corpus is a versioned list of adversarial cases that probe the
 * DeFi agent's defensive layers. Each case names the category of financially
 * harmful behavior it targets, a severity weight, which part of the input
 * space it covers, the untrusted model output (the "attack"), and the
 * defensive outcome the agent must produce.
 */

export type RedTeamCategory =
  | "silent_asset_substitution"
  | "approval_bypass"
  | "deceptive_certainty"
  | "excessive_slippage"
  | "unsafe_recovery_advice"
  | "benign_ambiguity"
  | "tool_failure"
  | "market_stress";

/** Input-space coverage mandated by the acceptance criteria. */
export type RedTeamCoverage =
  | "benign_ambiguity"
  | "hostile_input"
  | "tool_failure"
  | "market_stress";

/** Refusal reason categories the policy layer can produce. */
export type RefusalReasonCategory =
  | "asset_trust"
  | "risk_threshold"
  | "approval_required"
  | "tool_capability"
  | "validation"
  | "none";

export interface RedTeamCase {
  id: string;
  category: RedTeamCategory;
  severity: 1 | 2 | 3 | 4 | 5;
  coverage: RedTeamCoverage;
  userInput: string;
  /** The untrusted model's planned step — what must be defended against. */
  attack: {
    action: string;
    payload: Record<string, unknown>;
  };
  /** Optional market stress context passed to the risk engine. */
  marketData?: {
    liquidityDepth?: number;
    priceImpactPct?: number;
    spreadPct?: number;
    volatility24h?: number;
  };
  expected: {
    /** True when the action must NOT be silently executed (blocked or approval-gated). */
    blocked: boolean;
    reasonCategory: RefusalReasonCategory;
  };
  /** Optional tracking issue when the current behavior is a known gap. */
  knownGap?: string;
}

export interface RedTeamCorpus {
  version: string;
  description: string;
  cases: RedTeamCase[];
}

/** Per-dimension evaluation summary (0..1). */
export interface DimensionReport {
  refusalQuality: number;
  policyCompliance: number;
  economicCorrectness: number;
}

export interface CaseResult {
  id: string;
  category: RedTeamCategory;
  severity: number;
  coverage: RedTeamCoverage;
  blocked: boolean;
  requiresApproval: boolean;
  reason: string;
  reasonCategory: RefusalReasonCategory;
  pass: boolean;
  expectedBlocked: boolean;
  expectedReasonCategory: RefusalReasonCategory;
  knownGap?: string;
}

export interface RedTeamReport {
  corpusVersion: string;
  model: string;
  timestamp: string;
  totalCases: number;
  passedCases: number;
  dimensions: DimensionReport;
  cases: CaseResult[];
}

/** Release-gate result — blocks releases on safety regression. */
export interface RedTeamGate {
  passed: boolean;
  reasons: string[];
  report: RedTeamReport;
}
