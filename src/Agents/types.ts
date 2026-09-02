// Legacy types - kept for backward compatibility
export type SwapPayload = {
  from: string;
  to: string;
  amount: number;
};

export type TransferPayload = {
  to: string;
  amount: number;
};

export type supportedTokens = "STRK" | "ETH" | "DAI";

export type BalancePayload = {
  token: supportedTokens;
};

// ── Compensation types ────────────────────────────────────────────────────────

/**
 * Describes whether a step can be automatically rolled back
 */
export enum CompensationType {
  /** Step can be automatically reversed via a compensation action */
  REVERSIBLE = "reversible",
  /** Step cannot be reversed (e.g. on-chain swap already confirmed) */
  IRREVERSIBLE = "irreversible",
  /** Step may be reversible but requires operator judgment */
  REQUIRES_MANUAL_REVIEW = "requires_manual_review",
}

/**
 * Outcome of a compensation attempt
 */
export enum CompensationOutcome {
  /** Compensation executed successfully */
  COMPENSATED = "compensated",
  /** Compensation could not be completed; funds/approvals are stranded */
  STRANDED = "stranded",
  /** Requires manual operator intervention */
  MANUAL_REVIEW = "manual_review",
}

/**
 * Describes how to compensate for a single workflow step
 */
export interface CompensationPlan {
  /** The compensation type for this step */
  type: CompensationType;
  /** The action to execute for rollback (null if irreversible) */
  rollbackAction: string | null;
  /** Payload to pass to the rollback action */
  rollbackPayload: Record<string, unknown> | null;
  /** Human-readable description of the compensation */
  description: string;
  /** Maximum number of compensation retry attempts */
  maxRetries?: number;
}

/**
 * Result of executing a compensation for a step
 */
export interface CompensationResult {
  /** Step number that was compensated */
  stepNumber: number;
  /** Outcome of the compensation attempt */
  outcome: CompensationOutcome;
  /** The compensation plan that was executed */
  compensationPlan: CompensationPlan;
  /** Error message if compensation failed */
  error?: string;
  /** Number of retry attempts made */
  retryCount: number;
  /** Timestamp of the compensation attempt */
  timestamp: string;
}

/**
 * Failure classification for workflow execution reports
 */
export enum FailureState {
  /** All failed steps were successfully compensated */
  RECOVERED = "recovered",
  /** Some steps could not be compensated; funds/approvals may be stranded */
  STRANDED = "stranded",
  /** Requires manual operator review */
  MANUAL_REVIEW = "manual_review",
}

export type WorkflowStep = {
  action: string;
  payload: Record<string, unknown>;
};

export type WorkflowPlan = {
  workflow: WorkflowStep[];
};

// Legacy ToolResult interface - now superseded by registry types
export interface ToolResult {
  action: string;
  status: "success" | "error";
  message?: string;
  data?: Record<string, unknown>;
  error?: string;
}

// Legacy Tool interface - now superseded by registry types
export interface Tool {
  name: string;
  description: string;
  execute: (
    payload: Record<string, unknown>,
    userId: string
  ) => Promise<ToolResult>;
}
