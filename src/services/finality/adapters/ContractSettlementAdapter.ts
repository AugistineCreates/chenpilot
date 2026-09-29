import {
  ApplicationFinalityEvidence,
  ConfidenceLevel,
  ConfidenceTransition,
  FinalityAssessment,
  FinalityStage,
  ReversalRule,
} from "../types";
import { BaseChainFinalityAdapter } from "./ChainFinalityAdapter";

export interface ContractSettlementAdapterConfig {
  chainId?: string;
  defaultTimelockWindowMs?: number; // e.g. 3600_000 (1 hr)
}

/**
 * Contract Settlement Adapter (Application-Level Settlement)
 * Models Soroban contract escrow, HTLC atomic swaps, and multi-sig settlement.
 * Pre-final states include funds locking and condition staging, subject to
 * explicit timelock expiry, preimage revelation, and multi-sig reversal rules.
 */
export class ContractSettlementAdapter extends BaseChainFinalityAdapter<ApplicationFinalityEvidence> {
  readonly chainId: string;
  readonly category = "application" as const;

  private readonly defaultTimelockWindowMs: number;

  constructor(config: ContractSettlementAdapterConfig = {}) {
    super();
    this.chainId = config.chainId || "soroban-smart-contract";
    this.defaultTimelockWindowMs = config.defaultTimelockWindowMs ?? 3_600_000;
  }

  declareEvidence(raw: unknown): ApplicationFinalityEvidence {
    const data = raw as Partial<ApplicationFinalityEvidence>;
    const now = Date.now();
    return {
      category: "application",
      chainId: this.chainId,
      txHash: data.txHash || "",
      contractAddress: String(data.contractAddress || ""),
      settlementId: String(data.settlementId || ""),
      state: data.state || "INITIALIZED",
      timelockExpiry: Number(data.timelockExpiry || now + this.defaultTimelockWindowMs),
      currentTime: Number(data.currentTime || now),
      secretHash: data.secretHash,
      secretRevealed: Boolean(data.secretRevealed),
      signaturesCollected: Number(data.signaturesCollected || 0),
      requiredSignatures: Number(data.requiredSignatures || 1),
      observedAt: data.observedAt || now,
      providerId: data.providerId || "soroban-rpc",
    };
  }

  getReversalRules(stage?: FinalityStage): ReversalRule[] {
    const rules: ReversalRule[] = [
      {
        ruleId: "CONTRACT_TIMELOCK_EXPIRED",
        name: "Application Timelock Expiry / Refund",
        triggerType: "timelock_expiry",
        applicableStages: ["PRE_FINAL", "OBSERVED"],
        description:
          "The contract settlement timelock expired before required conditions/secrets were satisfied; funds are refundable.",
        maxVulnerabilityWindowMs: this.defaultTimelockWindowMs,
        reversalProbability: 0.08,
        isReversible: true,
        compensatoryAction: "trigger_contract_refund_and_cancel_plan",
        evaluateTrigger: (current) => {
          const app = current as ApplicationFinalityEvidence;
          if (app.state === "REFUNDED") {
            return {
              triggered: true,
              reason: `Contract settlement ${app.settlementId} explicitly refunded.`,
              compensatoryAction: "trigger_contract_refund_and_cancel_plan",
            };
          }
          if (app.currentTime >= app.timelockExpiry && app.state !== "EXECUTED") {
            return {
              triggered: true,
              reason: `Contract timelock expired at ${app.timelockExpiry} (current time: ${app.currentTime}). Settlement reverted.`,
              compensatoryAction: "trigger_contract_refund_and_cancel_plan",
            };
          }
          return { triggered: false };
        },
      },
      {
        ruleId: "CONTRACT_CONDITION_UNMET",
        name: "Missing Signatures or Unrevealed Secret",
        triggerType: "condition_failed",
        applicableStages: ["PRE_FINAL"],
        description:
          "Multi-signature quota not achieved or secret preimage invalid before cutoff.",
        maxVulnerabilityWindowMs: this.defaultTimelockWindowMs,
        reversalProbability: 0.05,
        isReversible: true,
        compensatoryAction: "release_escrow_locks_and_abort",
        evaluateTrigger: (current) => {
          const app = current as ApplicationFinalityEvidence;
          // Only applies to multi-signature settlement where more than 1 signature is required
          if (app.requiredSignatures > 1) {
            const timeToExpiry = app.timelockExpiry - app.currentTime;
            const totalDuration = Math.max(1, app.timelockExpiry - (app.observedAt || app.currentTime));
            if (
              timeToExpiry > 0 &&
              timeToExpiry < 0.1 * totalDuration &&
              app.signaturesCollected < app.requiredSignatures
            ) {
              return {
                triggered: true,
                reason: `Insufficient signatures (${app.signaturesCollected}/${app.requiredSignatures}) near timelock cutoff.`,
                compensatoryAction: "release_escrow_locks_and_abort",
              };
            }
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
        requiredConditionDescription: "Contract settlement agreement initialized",
        isMet: (ev) => ev.category === "application" && ev.state === "INITIALIZED",
        activeReversalRules: rules.filter((r) => r.applicableStages.includes("OBSERVED")),
      },
      {
        fromStage: "OBSERVED",
        toStage: "PRE_FINAL",
        fromConfidence: ConfidenceLevel.OBSERVED,
        toConfidence: ConfidenceLevel.PROVISIONAL,
        requiredConditionDescription: "Escrow funds locked in smart contract",
        isMet: (ev) =>
          ev.category === "application" &&
          ev.state === "LOCKED" &&
          ev.currentTime < ev.timelockExpiry,
        activeReversalRules: rules.filter((r) => r.applicableStages.includes("PRE_FINAL")),
      },
      {
        fromStage: "PRE_FINAL",
        toStage: "PRE_FINAL",
        fromConfidence: ConfidenceLevel.PROVISIONAL,
        toConfidence: ConfidenceLevel.ECONOMICALLY_SECURE,
        requiredConditionDescription:
          "Conditions prepared (signatures collected or secret revealed)",
        isMet: (ev) =>
          ev.category === "application" &&
          (ev.state === "PREPARED" ||
            (ev.state === "LOCKED" &&
              (ev.secretRevealed || ev.signaturesCollected >= ev.requiredSignatures))) &&
          ev.currentTime < ev.timelockExpiry,
        activeReversalRules: rules.filter((r) => r.applicableStages.includes("PRE_FINAL")),
      },
      {
        fromStage: "PRE_FINAL",
        toStage: "FINALIZED",
        fromConfidence: ConfidenceLevel.ECONOMICALLY_SECURE,
        toConfidence: ConfidenceLevel.SETTLED_IRREVOCABLE,
        requiredConditionDescription: "Smart contract execution complete; funds released",
        isMet: (ev) => ev.category === "application" && ev.state === "EXECUTED",
        activeReversalRules: [],
      },
    ];
  }

  evaluateFinality(
    evidence: ApplicationFinalityEvidence,
    previousEvidence?: ApplicationFinalityEvidence
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

    if (evidence.state === "EXECUTED") {
      stage = "FINALIZED";
      confidenceLevel = ConfidenceLevel.SETTLED_IRREVOCABLE;
    } else if (
      evidence.state === "PREPARED" ||
      (evidence.state === "LOCKED" &&
        (evidence.secretRevealed ||
          evidence.signaturesCollected >= evidence.requiredSignatures))
    ) {
      stage = "PRE_FINAL";
      confidenceLevel = ConfidenceLevel.ECONOMICALLY_SECURE;
    } else if (evidence.state === "LOCKED") {
      stage = "PRE_FINAL";
      confidenceLevel = ConfidenceLevel.PROVISIONAL;
    } else if (evidence.state === "INITIALIZED") {
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
      reversalProbability: isFinal ? 0.0 : 0.08,
      estimatedTimeToFinalityMs: this.estimateTimeToFinalityMs(evidence),
      evidence,
    };
  }

  estimateTimeToFinalityMs(evidence: ApplicationFinalityEvidence): number {
    if (evidence.state === "EXECUTED") return 0;
    return Math.max(0, evidence.timelockExpiry - evidence.currentTime);
  }
}
