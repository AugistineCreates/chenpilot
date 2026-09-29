import {
  FinalityCategory,
  ConfidenceLevel,
  FinalityStage,
  FinalityEvidence,
  FinalityAssessment,
  ConfidenceTransition,
  ReversalRule,
} from "../types";

/**
 * Abstract interface for a chain-specific finality adapter.
 * Each adapter declares its finality evidence format, confidence transitions,
 * and explicit reversal rules for all pre-final states.
 */
export interface ChainFinalityAdapter<TEvidence extends FinalityEvidence = FinalityEvidence> {
  readonly chainId: string;
  readonly category: FinalityCategory;

  /**
   * Declares and parses structured finality evidence from raw provider observation.
   */
  declareEvidence(rawObservation: unknown): TEvidence;

  /**
   * Evaluates the current finality assessment and transitions based on incoming evidence.
   */
  evaluateFinality(
    evidence: TEvidence,
    previousEvidence?: TEvidence
  ): FinalityAssessment;

  /**
   * Returns all declared confidence transitions for this adapter.
   */
  getTransitions(): ConfidenceTransition[];

  /**
   * Returns all declared reversal rules, optionally filtered by stage.
   */
  getReversalRules(stage?: FinalityStage): ReversalRule[];

  /**
   * Checks if current confidence satisfies or exceeds the required confidence level.
   */
  isStrongerOrEqualTo(
    currentConfidence: ConfidenceLevel,
    requiredConfidence: ConfidenceLevel
  ): boolean;

  /**
   * Estimates remaining time to finality in milliseconds.
   */
  estimateTimeToFinalityMs(evidence: TEvidence): number;
}

/**
 * Base adapter class implementing common confidence comparison logic.
 */
export abstract class BaseChainFinalityAdapter<TEvidence extends FinalityEvidence>
  implements ChainFinalityAdapter<TEvidence>
{
  abstract readonly chainId: string;
  abstract readonly category: FinalityCategory;

  abstract declareEvidence(rawObservation: unknown): TEvidence;
  abstract evaluateFinality(
    evidence: TEvidence,
    previousEvidence?: TEvidence
  ): FinalityAssessment;
  abstract getTransitions(): ConfidenceTransition[];
  abstract getReversalRules(stage?: FinalityStage): ReversalRule[];
  abstract estimateTimeToFinalityMs(evidence: TEvidence): number;

  isStrongerOrEqualTo(
    currentConfidence: ConfidenceLevel,
    requiredConfidence: ConfidenceLevel
  ): boolean {
    return currentConfidence >= requiredConfidence;
  }
}
