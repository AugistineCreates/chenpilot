import {
  ConfidenceLevel,
  ConfidenceTransition,
  DeterministicFinalityEvidence,
  FinalityAssessment,
  FinalityStage,
  ReversalRule,
} from "../types";
import { BaseChainFinalityAdapter } from "./ChainFinalityAdapter";

export interface StellarAdapterConfig {
  chainId?: string;
  targetConfirmationDepth?: number; // default 3 ledgers
  ledgerCloseTimeMs?: number; // default 5000 ms (5 sec)
}

/**
 * Stellar Finality Adapter (Deterministic SCP Consensus Settlement)
 * Ledger closure provides deterministic finality under Byzantine agreement.
 * Depth accumulation and ancestry verification guard against network partitions
 * and provider divergence.
 */
export class StellarFinalityAdapter extends BaseChainFinalityAdapter<DeterministicFinalityEvidence> {
  readonly chainId: string;
  readonly category = "deterministic" as const;

  private readonly targetDepth: number;
  private readonly ledgerCloseTimeMs: number;

  constructor(config: StellarAdapterConfig = {}) {
    super();
    this.chainId = config.chainId || "stellar-mainnet";
    this.targetDepth = config.targetConfirmationDepth ?? 3;
    this.ledgerCloseTimeMs = config.ledgerCloseTimeMs ?? 5000;
  }

  declareEvidence(raw: unknown): DeterministicFinalityEvidence {
    const data = raw as Partial<DeterministicFinalityEvidence>;
    return {
      category: "deterministic",
      chainId: this.chainId,
      txHash: String(data.txHash || ""),
      ledgerSequence: Number(data.ledgerSequence || 0),
      ledgerHash: String(data.ledgerHash || ""),
      confirmationDepth: Number(data.confirmationDepth || 0),
      targetDepth: this.targetDepth,
      quorumReached: data.quorumReached ?? true,
      validatorSignaturesCount: data.validatorSignaturesCount,
      parentHashValid: data.parentHashValid ?? true,
      isOrphaned: Boolean(data.isOrphaned),
      observedAt: data.observedAt || Date.now(),
      providerId: data.providerId || "horizon-primary",
    };
  }

  getReversalRules(stage?: FinalityStage): ReversalRule[] {
    const rules: ReversalRule[] = [
      {
        ruleId: "STELLAR_FORK_ORPHAN",
        name: "Stellar Ledger Orphan / Ancestry Discontinuity",
        triggerType: "reorg",
        applicableStages: ["PRE_FINAL", "OBSERVED"],
        description:
          "The observed ledger was orphaned or failed ancestry chain verification against the canonical ledger.",
        maxVulnerabilityWindowMs: this.targetDepth * this.ledgerCloseTimeMs,
        reversalProbability: 0.001,
        isReversible: true,
        compensatoryAction: "trigger_reconciliation_and_halt_downstream",
        evaluateTrigger: (current) => {
          const det = current as DeterministicFinalityEvidence;
          if (det.isOrphaned) {
            return {
              triggered: true,
              reason: `Stellar ledger ${det.ledgerSequence} (${det.ledgerHash}) was marked orphaned.`,
              compensatoryAction: "trigger_reconciliation_and_halt_downstream",
            };
          }
          if (det.parentHashValid === false) {
            return {
              triggered: true,
              reason: `Stellar ledger ${det.ledgerSequence} failed parent hash ancestry verification.`,
              compensatoryAction: "trigger_reconciliation_and_halt_downstream",
            };
          }
          return { triggered: false };
        },
      },
      {
        ruleId: "STELLAR_CONSENSUS_HALTED",
        name: "Stellar Consensus Quorum Failure",
        triggerType: "consensus_halt",
        applicableStages: ["PRE_FINAL", "OBSERVED"],
        description:
          "Stellar validator quorum not reached or SCP consensus stalled.",
        maxVulnerabilityWindowMs: 60_000,
        reversalProbability: 0.0005,
        isReversible: true,
        compensatoryAction: "failover_to_reconciliation_provider",
        evaluateTrigger: (current) => {
          const det = current as DeterministicFinalityEvidence;
          if (det.quorumReached === false) {
            return {
              triggered: true,
              reason: "SCP quorum not reached for observed ledger close.",
              compensatoryAction: "failover_to_reconciliation_provider",
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
        requiredConditionDescription: "Transaction submitted to Horizon and pending inclusion",
        isMet: (ev) =>
          ev.category === "deterministic" &&
          ev.ledgerSequence > 0 &&
          ev.confirmationDepth === 0,
        activeReversalRules: rules.filter((r) => r.applicableStages.includes("OBSERVED")),
      },
      {
        fromStage: "OBSERVED",
        toStage: "PRE_FINAL",
        fromConfidence: ConfidenceLevel.OBSERVED,
        toConfidence: ConfidenceLevel.ECONOMICALLY_SECURE,
        requiredConditionDescription: "Ledger closed with SCP quorum (deterministic confirmation)",
        isMet: (ev) =>
          ev.category === "deterministic" &&
          ev.confirmationDepth >= 1 &&
          ev.confirmationDepth < this.targetDepth &&
          ev.quorumReached &&
          !ev.isOrphaned,
        activeReversalRules: rules.filter((r) => r.applicableStages.includes("PRE_FINAL")),
      },
      {
        fromStage: "PRE_FINAL",
        toStage: "FINALIZED",
        fromConfidence: ConfidenceLevel.ECONOMICALLY_SECURE,
        toConfidence: ConfidenceLevel.CANONICAL_IRREVERSIBLE,
        requiredConditionDescription: `Confirmation depth reached (>= ${this.targetDepth} ledgers) with valid ancestry`,
        isMet: (ev) =>
          ev.category === "deterministic" &&
          ev.confirmationDepth >= this.targetDepth &&
          ev.parentHashValid &&
          !ev.isOrphaned,
        activeReversalRules: [],
      },
    ];
  }

  evaluateFinality(
    evidence: DeterministicFinalityEvidence,
    previousEvidence?: DeterministicFinalityEvidence
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

    // 2. Stage progression
    let stage: FinalityStage = "PENDING";
    let confidenceLevel = ConfidenceLevel.NONE;

    if (
      evidence.confirmationDepth >= this.targetDepth &&
      evidence.parentHashValid &&
      !evidence.isOrphaned
    ) {
      stage = "FINALIZED";
      confidenceLevel = ConfidenceLevel.CANONICAL_IRREVERSIBLE;
    } else if (evidence.confirmationDepth >= 1 && !evidence.isOrphaned) {
      stage = "PRE_FINAL";
      confidenceLevel = ConfidenceLevel.ECONOMICALLY_SECURE;
    } else if (evidence.ledgerSequence > 0) {
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
      reversalProbability: isFinal ? 0.0 : 0.001,
      estimatedTimeToFinalityMs: this.estimateTimeToFinalityMs(evidence),
      evidence,
    };
  }

  estimateTimeToFinalityMs(evidence: DeterministicFinalityEvidence): number {
    if (evidence.confirmationDepth >= this.targetDepth) {
      return 0;
    }
    const remainingDepth = Math.max(0, this.targetDepth - evidence.confirmationDepth);
    return remainingDepth * this.ledgerCloseTimeMs;
  }
}
