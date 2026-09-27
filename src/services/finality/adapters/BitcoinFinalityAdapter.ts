import {
  ConfidenceLevel,
  ConfidenceTransition,
  FinalityAssessment,
  FinalityStage,
  ProbabilisticFinalityEvidence,
  ReversalRule,
} from "../types";
import { BaseChainFinalityAdapter } from "./ChainFinalityAdapter";

export interface BitcoinAdapterConfig {
  chainId?: string;
  targetConfirmations?: number; // default 6
  economicThresholdConfirmations?: number; // default 3
  provisionalThresholdConfirmations?: number; // default 1
  averageBlockTimeMs?: number; // default 600,000 (10 min)
  assumedAttackerHashrateRatio?: number; // default 0.15 (15% hashrate)
}

/**
 * Bitcoin Finality Adapter (Probabilistic PoW Settlement)
 * Implements Nakamoto consensus finality with depth-dependent reorg probability
 * and explicit reversal rules for all pre-final states.
 */
export class BitcoinFinalityAdapter extends BaseChainFinalityAdapter<ProbabilisticFinalityEvidence> {
  readonly chainId: string;
  readonly category = "probabilistic" as const;

  private readonly targetConfirmations: number;
  private readonly economicThreshold: number;
  private readonly provisionalThreshold: number;
  private readonly averageBlockTimeMs: number;
  private readonly attackerRatio: number;

  constructor(config: BitcoinAdapterConfig = {}) {
    super();
    this.chainId = config.chainId || "bitcoin-mainnet";
    this.targetConfirmations = config.targetConfirmations ?? 6;
    this.economicThreshold = config.economicThresholdConfirmations ?? 3;
    this.provisionalThreshold = config.provisionalThresholdConfirmations ?? 1;
    this.averageBlockTimeMs = config.averageBlockTimeMs ?? 600_000;
    this.attackerRatio = config.assumedAttackerHashrateRatio ?? 0.15;
  }

  declareEvidence(raw: unknown): ProbabilisticFinalityEvidence {
    const data = raw as Partial<ProbabilisticFinalityEvidence>;
    const confirmations = Number(data.confirmations || 0);
    const reorgProb = this.calculateNakamotoReorgProbability(confirmations);

    return {
      category: "probabilistic",
      chainId: this.chainId,
      txHash: String(data.txHash || ""),
      blockHeight: Number(data.blockHeight || 0),
      confirmations,
      blockHash: String(data.blockHash || ""),
      targetConfirmations: this.targetConfirmations,
      reorgProbability: reorgProb,
      cumulativeDifficulty: data.cumulativeDifficulty,
      competingBranchDetected: Boolean(data.competingBranchDetected),
      observedAt: data.observedAt || Date.now(),
      providerId: data.providerId || "bitcoin-core-rpc",
    };
  }

  /**
   * Calculates Nakamoto PoW reorg probability for z confirmations:
   * P(reorg) ~= (q / p)^z where q is attacker ratio, p = 1 - q.
   */
  public calculateNakamotoReorgProbability(confirmations: number): number {
    if (confirmations <= 0) return 1.0;
    const q = this.attackerRatio;
    const p = 1 - q;
    const ratio = q / p;
    return Math.min(1.0, Math.pow(ratio, confirmations));
  }

  getReversalRules(stage?: FinalityStage): ReversalRule[] {
    const rules: ReversalRule[] = [
      {
        ruleId: "BTC_REORG_CONFIRMATION_DROP",
        name: "Bitcoin Block Reorganization (Depth Reduction)",
        triggerType: "reorg",
        applicableStages: ["PRE_FINAL", "OBSERVED"],
        description:
          "Detected a reduction in confirmation depth or eviction from block due to chain reorganization.",
        maxVulnerabilityWindowMs: this.targetConfirmations * this.averageBlockTimeMs,
        reversalProbability: 0.15,
        isReversible: true,
        compensatoryAction: "halt_plan_and_revert_unsettled_legs",
        evaluateTrigger: (current, prev) => {
          if (!prev || prev.category !== "probabilistic") {
            return { triggered: false };
          }
          const currProb = current as ProbabilisticFinalityEvidence;
          const prevProb = prev as ProbabilisticFinalityEvidence;

          // If confirmations dropped (e.g. 2 -> 0 or 3 -> 1)
          if (currProb.confirmations < prevProb.confirmations) {
            return {
              triggered: true,
              reason: `Reorganization detected: confirmation count dropped from ${prevProb.confirmations} to ${currProb.confirmations}`,
              compensatoryAction: "halt_plan_and_revert_unsettled_legs",
            };
          }
          return { triggered: false };
        },
      },
      {
        ruleId: "BTC_REORG_BLOCK_HASH_MISMATCH",
        name: "Bitcoin Alternate Fork Hash Mismatch",
        triggerType: "reorg",
        applicableStages: ["PRE_FINAL"],
        description:
          "The block containing the transaction was reorganized out; block hash at the same height changed.",
        maxVulnerabilityWindowMs: this.targetConfirmations * this.averageBlockTimeMs,
        reversalProbability: 0.1,
        isReversible: true,
        compensatoryAction: "abort_cross_chain_downstream_and_requeue_source",
        evaluateTrigger: (current, prev) => {
          if (!prev || prev.category !== "probabilistic") {
            return { triggered: false };
          }
          const currProb = current as ProbabilisticFinalityEvidence;
          const prevProb = prev as ProbabilisticFinalityEvidence;

          // If block height is the same but block hash has mutated
          if (
            currProb.blockHeight === prevProb.blockHeight &&
            prevProb.blockHash &&
            currProb.blockHash &&
            currProb.blockHash !== prevProb.blockHash
          ) {
            return {
              triggered: true,
              reason: `Fork replacement: block hash at height ${currProb.blockHeight} changed from ${prevProb.blockHash} to ${currProb.blockHash}`,
              compensatoryAction: "abort_cross_chain_downstream_and_requeue_source",
            };
          }
          return { triggered: false };
        },
      },
      {
        ruleId: "BTC_COMPETING_BRANCH_DETECTED",
        name: "Bitcoin Competing Branch Detected",
        triggerType: "reorg",
        applicableStages: ["PRE_FINAL", "OBSERVED"],
        description:
          "An alternative competing branch was detected near tip, elevating reorg risk.",
        maxVulnerabilityWindowMs: this.targetConfirmations * this.averageBlockTimeMs,
        reversalProbability: 0.25,
        isReversible: true,
        compensatoryAction: "freeze_execution_await_chain_reconciliation",
        evaluateTrigger: (current) => {
          const currProb = current as ProbabilisticFinalityEvidence;
          if (currProb.competingBranchDetected) {
            return {
              triggered: true,
              reason: "Competing branch detected near tip; reorg risk elevated.",
              compensatoryAction: "freeze_execution_await_chain_reconciliation",
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
        toStage: "OBSERVED",
        fromConfidence: ConfidenceLevel.NONE,
        toConfidence: ConfidenceLevel.OBSERVED,
        requiredConditionDescription: "Transaction observed in Bitcoin mempool (0 confs)",
        isMet: (ev) => ev.category === "probabilistic" && ev.confirmations === 0,
        activeReversalRules: rules.filter((r) => r.applicableStages.includes("OBSERVED")),
      },
      {
        fromStage: "OBSERVED",
        toStage: "PRE_FINAL",
        fromConfidence: ConfidenceLevel.OBSERVED,
        toConfidence: ConfidenceLevel.PROVISIONAL,
        requiredConditionDescription: `Included in block (>= ${this.provisionalThreshold} conf, < ${this.economicThreshold} confs)`,
        isMet: (ev) =>
          ev.category === "probabilistic" &&
          ev.confirmations >= this.provisionalThreshold &&
          ev.confirmations < this.economicThreshold,
        activeReversalRules: rules.filter((r) => r.applicableStages.includes("PRE_FINAL")),
      },
      {
        fromStage: "PRE_FINAL",
        toStage: "PRE_FINAL",
        fromConfidence: ConfidenceLevel.PROVISIONAL,
        toConfidence: ConfidenceLevel.ECONOMICALLY_SECURE,
        requiredConditionDescription: `Economically secure depth reached (>= ${this.economicThreshold} confs, < ${this.targetConfirmations} confs)`,
        isMet: (ev) =>
          ev.category === "probabilistic" &&
          ev.confirmations >= this.economicThreshold &&
          ev.confirmations < this.targetConfirmations,
        activeReversalRules: rules.filter((r) => r.applicableStages.includes("PRE_FINAL")),
      },
      {
        fromStage: "PRE_FINAL",
        toStage: "FINALIZED",
        fromConfidence: ConfidenceLevel.ECONOMICALLY_SECURE,
        toConfidence: ConfidenceLevel.CANONICAL_IRREVERSIBLE,
        requiredConditionDescription: `Canonical depth reached (>= ${this.targetConfirmations} confs)`,
        isMet: (ev) =>
          ev.category === "probabilistic" &&
          ev.confirmations >= this.targetConfirmations,
        activeReversalRules: [],
      },
    ];
  }

  evaluateFinality(
    evidence: ProbabilisticFinalityEvidence,
    previousEvidence?: ProbabilisticFinalityEvidence
  ): FinalityAssessment {
    // 1. Check reversal rules first against pre-final stages
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

    // 2. Determine confidence level and stage based on confirmations
    let stage: FinalityStage = "PENDING";
    let confidenceLevel = ConfidenceLevel.NONE;

    if (evidence.confirmations >= this.targetConfirmations) {
      stage = "FINALIZED";
      confidenceLevel = ConfidenceLevel.CANONICAL_IRREVERSIBLE;
    } else if (evidence.confirmations >= this.economicThreshold) {
      stage = "PRE_FINAL";
      confidenceLevel = ConfidenceLevel.ECONOMICALLY_SECURE;
    } else if (evidence.confirmations >= this.provisionalThreshold) {
      stage = "PRE_FINAL";
      confidenceLevel = ConfidenceLevel.PROVISIONAL;
    } else if (evidence.confirmations === 0 && evidence.txHash) {
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
      reversalProbability: isFinal ? 0.0 : evidence.reorgProbability,
      reorgProbability: isFinal ? 0.0 : evidence.reorgProbability,
      estimatedTimeToFinalityMs: this.estimateTimeToFinalityMs(evidence),
      evidence,
    };
  }

  estimateTimeToFinalityMs(evidence: ProbabilisticFinalityEvidence): number {
    if (evidence.confirmations >= this.targetConfirmations) {
      return 0;
    }
    const needed = this.targetConfirmations - evidence.confirmations;
    return needed * this.averageBlockTimeMs;
  }
}
