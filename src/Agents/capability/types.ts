// chenpilot/src/Agents/capability/types.ts

export type CapabilityNetwork =
  | "mainnet"
  | "testnet"
  | "futurenet"
  | "standalone"
  | "all";

export interface CapabilityGrant {
  /** Unique identifier for the capability grant */
  grantId: string;
  /** Parent grant ID if this grant was attenuated from an existing grant */
  parentId?: string;
  /** Bound plan ID (required for cross-plan replay prevention) */
  planId: string;
  /** Optional sub-plan ID if delegated to a sub-plan */
  subPlanId?: string;
  /** Optional bound step number (required for cross-step replay prevention) */
  stepNumber?: number;
  /** User ID on whose behalf the operation is authorized */
  userId: string;
  /** Specialist agent name (e.g. 'swap_specialist', 'market_analyst') */
  targetAgent?: string;
  /** Bound network */
  network: CapabilityNetwork;
  /** Explicit array of permitted tool action names */
  allowedActions: string[];
  /** Asset caps mapping asset code to maximum authorized amount */
  assetLimits?: Record<string, number>;
  /** Maximum number of tool invocations allowed (default 1 for single-purpose step grants) */
  maxCalls?: number;
  /** Number of times this grant has been invoked */
  usedCalls: number;
  /** Issuance timestamp (epoch ms) */
  issuedAt: number;
  /** Expiration timestamp (epoch ms) */
  expiresAt: number;
  /** Cryptographic nonce to guarantee uniqueness */
  nonce: string;
  /** Cryptographic HMAC signature verifying authenticity and integrity */
  signature: string;
}

export interface IssueGrantParams {
  planId: string;
  subPlanId?: string;
  stepNumber?: number;
  userId: string;
  targetAgent?: string;
  network?: CapabilityNetwork;
  allowedActions: string[];
  assetLimits?: Record<string, number>;
  maxCalls?: number;
  ttlMs?: number;
}

export interface AttenuateGrantParams {
  parentGrant: CapabilityGrant;
  subPlanId?: string;
  stepNumber?: number;
  targetAgent?: string;
  network?: CapabilityNetwork;
  allowedActions?: string[];
  assetLimits?: Record<string, number>;
  maxCalls?: number;
  ttlMs?: number;
}

export interface CapabilityValidationContext {
  planId?: string;
  subPlanId?: string;
  stepNumber?: number;
  userId: string;
  targetAgent?: string;
  network?: string;
  action: string;
  payload?: Record<string, unknown>;
}

export type CapabilityErrorCode =
  | "GRANT_MISSING"
  | "GRANT_EXPIRED"
  | "GRANT_REVOKED"
  | "GRANT_SIGNATURE_INVALID"
  | "ACTION_NOT_PERMITTED"
  | "USER_MISMATCH"
  | "PLAN_MISMATCH"
  | "STEP_MISMATCH"
  | "NETWORK_MISMATCH"
  | "ASSET_LIMIT_EXCEEDED"
  | "CALL_LIMIT_EXCEEDED"
  | "REPLAY_DETECTED"
  | "CONFUSED_DEPUTY"
  | "AUTHORITY_BROADENING";

export interface CapabilityValidationResult {
  valid: boolean;
  error?: string;
  errorCode?: CapabilityErrorCode;
}
