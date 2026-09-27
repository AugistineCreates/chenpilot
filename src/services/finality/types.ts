/**
 * Heterogeneous Chain Finality Model (Issue #751)
 *
 * Provides a typed finality model covering:
 * 1. Probabilistic settlement (e.g. Bitcoin PoW confirmations)
 * 2. Deterministic settlement (e.g. Stellar SCP ledger closure)
 * 3. Challenged settlement (e.g. Optimistic rollups dispute window)
 * 4. Application-level settlement (e.g. Soroban contract conditions / escrow)
 */

export type FinalityCategory =
  | "probabilistic"
  | "deterministic"
  | "challenged"
  | "application";

/**
 * Standardized ordinal ranking of confidence for cross-chain comparisons.
 * Allows comparing finality strength across heterogeneous chains.
 */
export enum ConfidenceLevel {
  /** Not yet seen or submitted */
  NONE = 0,
  /** Observed in mempool or broadcast */
  OBSERVED = 10,
  /** Preconfirmed or included with low depth / within dispute period */
  PROVISIONAL = 20,
  /** Economically secure for standard value operations */
  ECONOMICALLY_SECURE = 30,
  /** Canonical and irreversible according to consensus rules */
  CANONICAL_IRREVERSIBLE = 40,
  /** Contract / application conditions fulfilled and settlement finalized */
  SETTLED_IRREVOCABLE = 50,
}

export type FinalityStage =
  | "PENDING"
  | "OBSERVED"
  | "PRE_FINAL"
  | "FINALIZED"
  | "REVERSED";

export type ReversalTriggerType =
  | "reorg"
  | "fraud_proof"
  | "timelock_expiry"
  | "condition_failed"
  | "double_spend"
  | "consensus_halt";

/**
 * Reversal rule definition for a pre-final state.
 * Specifies explicit trigger conditions, vulnerability windows, and compensation actions.
 */
export interface ReversalRule {
  ruleId: string;
  name: string;
  triggerType: ReversalTriggerType;
  description: string;
  applicableStages: FinalityStage[];
  /** Maximum duration (ms) during which this reversal can occur */
  maxVulnerabilityWindowMs?: number;
  /** Estimated probability of reversal in this pre-final state (0.0 to 1.0) */
  reversalProbability: number;
  /** Whether the state can be reversed */
  isReversible: boolean;
  /** Evaluates whether incoming evidence triggers this reversal */
  evaluateTrigger: (
    current: FinalityEvidence,
    previous?: FinalityEvidence
  ) => {
    triggered: boolean;
    reason?: string;
    compensatoryAction?: string;
  };
  /** Explicit compensatory action to take when this reversal is triggered */
  compensatoryAction: string;
}

/**
 * Transition specification between confidence levels / stages.
 */
export interface ConfidenceTransition {
  fromStage: FinalityStage;
  toStage: FinalityStage;
  fromConfidence: ConfidenceLevel;
  toConfidence: ConfidenceLevel;
  requiredConditionDescription: string;
  isMet: (evidence: FinalityEvidence) => boolean;
  activeReversalRules: ReversalRule[];
}

/**
 * Base finality evidence observed from a chain provider.
 */
export interface BaseFinalityEvidence {
  category: FinalityCategory;
  chainId: string;
  txHash: string;
  observedAt: number;
  providerId: string;
}

/**
 * Probabilistic Finality Evidence (e.g. Bitcoin PoW).
 */
export interface ProbabilisticFinalityEvidence extends BaseFinalityEvidence {
  category: "probabilistic";
  blockHeight: number;
  confirmations: number;
  blockHash: string;
  targetConfirmations: number;
  /** Calculated probability of chain reorg replacing this transaction */
  reorgProbability: number;
  cumulativeDifficulty?: string;
  competingBranchDetected?: boolean;
}

/**
 * Deterministic Finality Evidence (e.g. Stellar SCP, Tendermint, Casper).
 */
export interface DeterministicFinalityEvidence extends BaseFinalityEvidence {
  category: "deterministic";
  ledgerSequence: number;
  ledgerHash: string;
  confirmationDepth: number;
  targetDepth: number;
  quorumReached: boolean;
  validatorSignaturesCount?: number;
  parentHashValid: boolean;
  isOrphaned?: boolean;
}

/**
 * Challenged Finality Evidence (e.g. Optimistic rollups, dispute windows).
 */
export interface ChallengedFinalityEvidence extends BaseFinalityEvidence {
  category: "challenged";
  stateRoot: string;
  disputeWindowStart: number;
  disputeWindowEnd: number;
  disputeWindowRemainingMs: number;
  challengeStatus: "UNOPPOSED" | "CHALLENGED" | "DEFENDED" | "FRAUD_PROVED";
  challengerAddress?: string;
  fraudProofHash?: string;
}

/**
 * Application-Level Finality Evidence (e.g. Soroban contract conditions, HTLC, Escrow).
 */
export interface ApplicationFinalityEvidence extends BaseFinalityEvidence {
  category: "application";
  contractAddress: string;
  settlementId: string;
  state: "INITIALIZED" | "LOCKED" | "PREPARED" | "EXECUTED" | "REFUNDED";
  timelockExpiry: number;
  currentTime: number;
  secretHash?: string;
  secretRevealed?: boolean;
  signaturesCollected: number;
  requiredSignatures: number;
}

/**
 * Discriminated union of all finality evidence types.
 */
export type FinalityEvidence =
  | ProbabilisticFinalityEvidence
  | DeterministicFinalityEvidence
  | ChallengedFinalityEvidence
  | ApplicationFinalityEvidence;

/**
 * Evaluated finality assessment for a specific transaction / settlement.
 */
export interface FinalityAssessment {
  chainId: string;
  category: FinalityCategory;
  stage: FinalityStage;
  confidenceLevel: ConfidenceLevel;
  isPreFinal: boolean;
  isFinal: boolean;
  isReversed: boolean;
  reversalReason?: string;
  triggeredReversalRule?: ReversalRule;
  activeReversalRules: ReversalRule[];
  reversalProbability: number;
  reorgProbability?: number;
  estimatedTimeToFinalityMs: number;
  evidence: FinalityEvidence;
}
