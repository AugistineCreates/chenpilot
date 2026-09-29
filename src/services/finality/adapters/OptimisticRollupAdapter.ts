import {
  ChallengedFinalityEvidence,
  ConfidenceLevel,
  ConfidenceTransition,
  FinalityAssessment,
  FinalityStage,
  ReversalRule,
} from "../types";
import { BaseChainFinalityAdapter } from "./ChainFinalityAdapter";

export interface ChallengedAdapterConfig {
  chainId?: string;
  disputeWindowMs?: number; // e.g. 7 days or configurable for tests
}

/**
 * Optimistic Rollup Finality Adapter (Challenged Settlement)
 * Settlement is optimistic and provisional during the dispute window.
 * Becomes final only after the dispute window lapses without valid challenge,
 * or reverts if a fraud proof is upheld.
 */
export class OptimisticRollupAdapter extends BaseChainFinalityAdapter<ChallengedFinalityEvidence> {
  readonly chainId: string;
  readonly category = "challenged" as const;

  private readonly defaultDisputeWindowMs: number;

  constructor(config: ChallengedAdapterConfig = {}) {
    super();
    this.chainId = config.chainId || "optimistic-rollup-1";
    this.defaultDisputeWindowMs = config.disputeWindowMs ?? 604_800_000; // 7 days default
  }

  declareEvidence(raw: unknown): ChallengedFinalityEvidence {
    const data = raw as Partial<ChallengedFinalityEvidence>;
    const now = Date.now();
    const disputeWindowStart = Number(data.disputeWindowStart || now);
    const disputeWindowEnd =
      Number(data.disputeWindowEnd) || disputeWindowStart + this.defaultDisputeWindowMs;
    const disputeWindowRemainingMs = Math.max(0, disputeWindowEnd - now);

    return {
      category: "challenged",
      chainId: this.chainId,
      txHash: String(data.txHash || ""),
      stateRoot: String(data.stateRoot || ""),
      disputeWindowStart,
      disputeWindowEnd,
      disputeWindowRemainingMs:
        data.disputeWindowRemainingMs !== undefined
          ? data.disputeWindowRemainingMs
          : disputeWindowRemainingMs,
      challengeStatus: data.challengeStatus || "UNOPPOSED",
      challengerAddress: data.challengerAddress,
      fraudProofHash: data.fraudProofHash,
      observedAt: data.observedAt || now,
      providerId: data.providerId || "optimism-node",
    };
  }

  getReversalRules(stage?: FinalityStage): ReversalRule[] {
    const rules: ReversalRule[] = [
      {
        ruleId: "ROLLUP_FRAUD_PROVED",
        name: "Optimistic State Invalidation (Fraud Proof Upheld)",
        triggerType: "fraud_proof",
        applicableStages: ["PRE_FINAL", "OBSERVED"],
        description:
          "A valid fraud proof was submitted and verified, invalidating the optimistic state root.",
        maxVulnerabilityWindowMs: this.defaultDisputeWindowMs,
        reversalProbability: 0.05,
        isReversible: true,
        compensatoryAction: "invalidate_state_root_and_revert_downstream",
        evaluateTrigger: (current) => {
          const ch = current as ChallengedFinalityEvidence;
          if (ch.challengeStatus === "FRAUD_PROVED") {
            return {
              triggered: true,
              reason: `Fraud proof verified (${ch.fraudProofHash || "confirmed"}); state root invalidated.`,
              compensatoryAction: "invalidate_state_root_and_revert_downstream",
            };
          }
          return { triggered: false };
        },
      },
      {
        ruleId: "ROLLUP_CHALLENGE_FILED",
        name: "Dispute Game Initiated (State Challenged)",
        triggerType: "fraud_proof",
        applicableStages: ["PRE_FINAL"],
        description:
          "A challenge has been filed against the state assertion; settlement is frozen pending resolution.",
        maxVulnerabilityWindowMs: this.defaultDisputeWindowMs,
        reversalProbability: 0.1,
        isReversible: true,
        compensatoryAction: "freeze_settlement_and_await_dispute_resolution",
        evaluateTrigger: (current) => {
          const ch = current as ChallengedFinalityEvidence;
          if (ch.challengeStatus === "CHALLENGED") {
            return {
              triggered: true,
              reason: `Assertion challenged by ${ch.challengerAddress || "challenger"}; state disputed.`,
              compensatoryAction: "freeze_settlement_and_await_dispute_resolution",
            };
          }
          return { triggered: false };
        },
      },
    ];

    if (!stage) return rules;
    return rules.filter((r) => r.applicableStages.includes(stage));
  }

  getTransitions(): ConfidenceTransition[] {
    const rules = this.getReversalRules();
    return [
      {
        fromStage: "PENDING",
        toStage: "PRE_FINAL",
        fromConfidence: ConfidenceLevel.NONE,
        toConfidence: ConfidenceLevel.PROVISIONAL,
        requiredConditionDescription: "State assertion submitted; dispute window opened",
        isMet: (ev) =>
          ev.category === "challenged" &&
          ev.disputeWindowRemainingMs > 0 &&
          ev.challengeStatus === "UNOPPOSED",
        activeReversalRules: rules.filter((r) => r.applicableStages.includes("PRE_FINAL")),
      },
      {
        fromStage: "PRE_FINAL",
        toStage: "PRE_FINAL",
        fromConfidence: ConfidenceLevel.PROVISIONAL,
        toConfidence: ConfidenceLevel.ECONOMICALLY_SECURE,
        requiredConditionDescription: "Dispute window half expired with no challenges",
        isMet: (ev) => {
          if (ev.category !== "challenged") return false;
          const totalWindow = ev.disputeWindowEnd - ev.disputeWindowStart;
          return (
            ev.challengeStatus === "UNOPPOSED" &&
            ev.disputeWindowRemainingMs > 0 &&
            ev.disputeWindowRemainingMs <= totalWindow / 2
          );
        },
        activeReversalRules: rules.filter((r) => r.applicableStages.includes("PRE_FINAL")),
      },
      {
        fromStage: "PRE_FINAL",
        toStage: "FINALIZED",
        fromConfidence: ConfidenceLevel.ECONOMICALLY_SECURE,
        toConfidence: ConfidenceLevel.CANONICAL_IRREVERSIBLE,
        requiredConditionDescription: "Dispute window lapsed with assertion unopposed or defended",
        isMet: (ev) =>
          ev.category === "challenged" &&
          ev.disputeWindowRemainingMs <= 0 &&
          (ev.challengeStatus === "UNOPPOSED" || ev.challengeStatus === "DEFENDED"),
        activeReversalRules: [],
      },
    ];
  }

  evaluateFinality(
    evidence: ChallengedFinalityEvidence,
    previousEvidence?: ChallengedFinalityEvidence
  ): FinalityAssessment {
    // 1. Evaluate reversal rules
    const reversalRules = this.getReversalRules();
    for (const rule of reversalRules) {
      const result = rule.evaluateTrigger(evidence, previousEvidence);
      if (result.triggered) {
        return {
          chainId: this.chainId,
          category: this.category,
          stage: "REVERSED",
          confidenceLevel: ConfidenceLevel.NONE,
          isPreFinal: false,
          isFinal: false,
          isReversed: true,
          reversalReason: result.reason,
          triggeredReversalRule: rule,
          activeReversalRules: [],
          reversalProbability: 1.0,
          estimatedTimeToFinalityMs: -1,
          evidence,
        };
      }
    }

    // 2. Stage determination
    let stage: FinalityStage = "PENDING";
    let confidenceLevel = ConfidenceLevel.NONE;

    const totalWindow = Math.max(1, evidence.disputeWindowEnd - evidence.disputeWindowStart);
    const windowElapsed = evidence.disputeWindowRemainingMs <= 0;

    if (
      windowElapsed &&
      (evidence.challengeStatus === "UNOPPOSED" || evidence.challengeStatus === "DEFENDED")
    ) {
      stage = "FINALIZED";
      confidenceLevel = ConfidenceLevel.CANONICAL_IRREVERSIBLE;
    } else if (
      evidence.challengeStatus === "UNOPPOSED" &&
      evidence.disputeWindowRemainingMs <= totalWindow / 2
    ) {
      stage = "PRE_FINAL";
      confidenceLevel = ConfidenceLevel.ECONOMICALLY_SECURE;
    } else if (evidence.challengeStatus === "UNOPPOSED" && evidence.stateRoot) {
      stage = "PRE_FINAL";
      confidenceLevel = ConfidenceLevel.PROVISIONAL;
    } else if (evidence.stateRoot) {
      stage = "OBSERVED";
      confidenceLevel = ConfidenceLevel.OBSERVED;
    }

    const isFinal = stage === "FINALIZED";
    const isPreFinal = stage === "PRE_FINAL";
    const activeRules = isPreFinal ? this.getReversalRules("PRE_FINAL") : [];

    return {
      chainId: this.chainId,
      category: this.category,
      stage,
      confidenceLevel,
      isPreFinal,
      isFinal,
      isReversed: false,
      activeReversalRules: activeRules,
      reversalProbability: isFinal ? 0.0 : 0.05,
      estimatedTimeToFinalityMs: this.estimateTimeToFinalityMs(evidence),
      evidence,
    };
  }

  estimateTimeToFinalityMs(evidence: ChallengedFinalityEvidence): number {
    return Math.max(0, evidence.disputeWindowRemainingMs);
  }
}
