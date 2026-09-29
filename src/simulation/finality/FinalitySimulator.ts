import {
  ConfidenceLevel,
  FinalityAssessment,
  FinalityStage,
} from "../../services/finality/types";
import {
  CrossChainFinalityCoordinator,
  CrossChainPlan,
  PlanExecutionStatus,
} from "../../services/finality/CrossChainFinalityCoordinator";
import { ChainFinalityRegistry } from "../../services/finality/ChainFinalityRegistry";

export interface SimulationTickResult {
  tick: number;
  simulatedTimeMs: number;
  planStatus: PlanExecutionStatus["status"];
  stepAssessments: Record<string, FinalityAssessment | undefined>;
  eligibleSteps: string[];
  reversalTriggered?: boolean;
  timeoutTriggered?: boolean;
}

export interface AsymmetricSimulationScenario {
  name: string;
  plan: CrossChainPlan;
  /** Schedule of observations per tick: tickNumber -> { stepId: rawEvidence } */
  timeline: Record<number, Record<string, unknown>>;
  totalTicks: number;
  tickDurationMs: number;
}

export interface SimulationSummary {
  scenarioName: string;
  completedTicks: number;
  finalPlanStatus: PlanExecutionStatus["status"];
  stepFinalStatuses: Record<string, string>;
  timelineResults: SimulationTickResult[];
  asymmetricSafetyMaintained: boolean;
  reversalHandledGracefully: boolean;
  timeoutHandledCorrectly: boolean;
}

/**
 * Simulator for heterogeneous chain finality, asymmetric confirmation speeds,
 * delayed settlement, and pre-final reorgs/challenges.
 */
export class FinalitySimulator {
  private coordinator: CrossChainFinalityCoordinator;

  constructor(coordinator?: CrossChainFinalityCoordinator) {
    this.coordinator = coordinator || new CrossChainFinalityCoordinator();
  }

  /**
   * Runs a complete discrete-time simulation of a cross-chain scenario.
   */
  async runScenario(scenario: AsymmetricSimulationScenario): Promise<SimulationSummary> {
    const planState = this.coordinator.initializePlanState(scenario.plan);
    const timelineResults: SimulationTickResult[] = [];
    let asymmetricSafetyMaintained = true;
    let reversalHandledGracefully = false;
    let timeoutHandledCorrectly = false;

    let currentTimeMs = 0;

    for (let tick = 0; tick < scenario.totalTicks; tick++) {
      currentTimeMs = tick * scenario.tickDurationMs;
      const tickObservations = scenario.timeline[tick] || {};
      const stepAssessments: Record<string, FinalityAssessment | undefined> = {};

      // 1. Process observations scheduled for this tick
      for (const [stepId, rawEvidence] of Object.entries(tickObservations)) {
        if (planState.status !== "REVERSED" && planState.status !== "TIMED_OUT") {
          const assessment = this.coordinator.recordStepEvidence(
            scenario.plan,
            planState,
            stepId,
            rawEvidence
          );
          stepAssessments[stepId] = assessment;

          if (assessment.isReversed) {
            reversalHandledGracefully = true;
          }
        }
      }

      // 2. Check timeouts for delayed settlement
      for (const step of scenario.plan.steps) {
        if (
          planState.status === "IN_PROGRESS" &&
          planState.stepStates[step.stepId].status !== "SATISFIED"
        ) {
          const timedOut = this.coordinator.checkDelayedSettlementTimeout(
            scenario.plan,
            planState,
            step.stepId,
            currentTimeMs
          );
          if (timedOut) {
            timeoutHandledCorrectly = true;
          }
        }
      }

      // 3. Evaluate eligibility for all steps
      const eligibleSteps: string[] = [];
      for (const step of scenario.plan.steps) {
        const check = this.coordinator.isStepEligibleToExecute(
          scenario.plan,
          planState,
          step.stepId
        );
        if (check.eligible) {
          eligibleSteps.push(step.stepId);
        } else {
          // If a dependent step was marked SATISFIED or tried to execute before dependency is satisfied,
          // asymmetric safety has been violated!
          const state = planState.stepStates[step.stepId];
          if (state.status === "SATISFIED" && !check.eligible) {
            asymmetricSafetyMaintained = false;
          }
        }
      }

      timelineResults.push({
        tick,
        simulatedTimeMs: currentTimeMs,
        planStatus: planState.status,
        stepAssessments,
        eligibleSteps,
        reversalTriggered: planState.status === "REVERSED",
        timeoutTriggered: planState.status === "TIMED_OUT",
      });

      // If plan reached terminal state, check if subsequent ticks attempt illegal actions
      if (planState.status === "REVERSED" || planState.status === "TIMED_OUT") {
        // Keep iterating or break after recording terminal state
        if (tick >= Object.keys(scenario.timeline).length + 2) {
          break;
        }
      }
    }

    const stepFinalStatuses: Record<string, string> = {};
    for (const [stepId, state] of Object.entries(planState.stepStates)) {
      stepFinalStatuses[stepId] = state.status;
    }

    return {
      scenarioName: scenario.name,
      completedTicks: timelineResults.length,
      finalPlanStatus: planState.status,
      stepFinalStatuses,
      timelineResults,
      asymmetricSafetyMaintained,
      reversalHandledGracefully: reversalHandledGracefully || planState.status !== "REVERSED",
      timeoutHandledCorrectly: timeoutHandledCorrectly || planState.status !== "TIMED_OUT",
    };
  }

  /**
   * Helper to construct a standard Asymmetric Finality Scenario:
   * Bitcoin (slow probabilistic: 6 confs, ~60m) -> Stellar (fast deterministic: 1 ledger close, ~5s).
   * Validates that Stellar release waits until Bitcoin 6 confs is reached.
   */
  static createBitcoinToStellarScenario(options: {
    btcConfirmationsPerTick?: number[];
    simulateReorgAtTick?: number;
    delayBitcoinSettlementPastTimeout?: boolean;
    timeoutMs?: number;
  } = {}): AsymmetricSimulationScenario {
    const timeout = options.timeoutMs ?? 7_200_000;
    const plan: CrossChainPlan = {
      planId: "btc-to-xlm-swap",
      name: "Bitcoin to Stellar Cross-Chain Atomic Swap",
      minConfidencePolicy: ConfidenceLevel.CANONICAL_IRREVERSIBLE,
      maxWaitTimeoutMs: timeout,
      steps: [
        {
          stepId: "step-1-btc-deposit",
          chainId: "bitcoin-mainnet",
          description: "Deposit and wait for canonical Bitcoin confirmations (6 confs)",
          requiredConfidenceLevel: ConfidenceLevel.CANONICAL_IRREVERSIBLE,
          compensatoryAction: "request_bitcoin_mempool_rbf_cancel",
          timeoutMs: timeout,
        },
        {
          stepId: "step-2-stellar-release",
          chainId: "stellar-mainnet",
          description: "Release funds on Stellar ledger after Bitcoin deposit is irreversible",
          dependsOn: ["step-1-btc-deposit"],
          requiredConfidenceLevel: ConfidenceLevel.CANONICAL_IRREVERSIBLE,
          compensatoryAction: "refund_stellar_escrow_to_market_maker",
          timeoutMs: timeout,
        },
      ],
    };

    const timeline: Record<number, Record<string, unknown>> = {};
    const confPattern = options.btcConfirmationsPerTick || [0, 1, 2, 3, 4, 5, 6];

    confPattern.forEach((confs, tick) => {
      // If reorg simulated at this tick, inject dropped confirmations or hash change
      if (options.simulateReorgAtTick !== undefined && tick === options.simulateReorgAtTick) {
        timeline[tick] = {
          "step-1-btc-deposit": {
            txHash: "btc_tx_001",
            blockHeight: 800000,
            confirmations: 0, // Dropped to 0 due to reorg!
            blockHash: "reorg_hash_alt_fork",
            competingBranchDetected: true,
          },
        };
      } else {
        timeline[tick] = {
          "step-1-btc-deposit": {
            txHash: "btc_tx_001",
            blockHeight: 800000 + confs,
            confirmations: confs,
            blockHash: `hash_btc_${800000 + confs}`,
          },
        };
      }
    });

    // If no reorg and Bitcoin reached 6 confs, schedule downstream Stellar release
    if (options.simulateReorgAtTick === undefined && confPattern.includes(6)) {
      const releaseTick = confPattern.indexOf(6) + 1;
      timeline[releaseTick] = {
        "step-2-stellar-release": {
          txHash: "xlm_release_tx",
          ledgerSequence: 500000,
          ledgerHash: "hash_500000",
          confirmationDepth: 3,
          parentHashValid: true,
          quorumReached: true,
        },
      };
    }

    return {
      name: "Bitcoin to Stellar Asymmetric Finality Scenario",
      plan,
      timeline,
      totalTicks: confPattern.length + 2,
      tickDurationMs: 600_000, // 10 minutes per tick (Bitcoin block time)
    };
  }

  /**
   * Helper to construct an Optimistic Rollup (7-day challenged) to Stellar scenario.
   */
  static createRollupToStellarScenario(options: {
    injectFraudProofAtTick?: number;
    challengePeriodTicks?: number;
  } = {}): AsymmetricSimulationScenario {
    const plan: CrossChainPlan = {
      planId: "rollup-to-stellar-bridge",
      name: "Optimistic Rollup to Stellar Bridge",
      minConfidencePolicy: ConfidenceLevel.CANONICAL_IRREVERSIBLE,
      maxWaitTimeoutMs: 1_000_000,
      steps: [
        {
          stepId: "step-1-rollup-assertion",
          chainId: "optimism-mainnet",
          description: "Wait for Optimistic Rollup dispute window to lapse",
          requiredConfidenceLevel: ConfidenceLevel.CANONICAL_IRREVERSIBLE,
          compensatoryAction: "cancel_bridge_assertion_and_refund",
          timeoutMs: 1_000_000,
        },
        {
          stepId: "step-2-stellar-mint",
          chainId: "stellar-mainnet",
          description: "Mint wrapped asset on Stellar after rollup dispute window safely closes",
          dependsOn: ["step-1-rollup-assertion"],
          requiredConfidenceLevel: ConfidenceLevel.CANONICAL_IRREVERSIBLE,
          compensatoryAction: "burn_unbacked_stellar_tokens",
          timeoutMs: 1_000_000,
        },
      ],
    };

    const timeline: Record<number, Record<string, unknown>> = {};
    const totalTicks = options.challengePeriodTicks ?? 5;

    for (let tick = 0; tick < totalTicks; tick++) {
      const remainingMs = Math.max(0, (totalTicks - 1 - tick) * 100_000);
      const isFraudTick = options.injectFraudProofAtTick === tick;

      timeline[tick] = {
        "step-1-rollup-assertion": {
          txHash: "rollup_tx_001",
          stateRoot: "0xroot_abc",
          disputeWindowStart: 1000,
          disputeWindowEnd: 1000 + (totalTicks - 1) * 100_000,
          disputeWindowRemainingMs: remainingMs,
          challengeStatus: isFraudTick ? "FRAUD_PROVED" : "UNOPPOSED",
          fraudProofHash: isFraudTick ? "0xfraudproof123" : undefined,
        },
      };

      // If dispute window has elapsed and no fraud, schedule Stellar mint observation
      if (remainingMs === 0 && !options.injectFraudProofAtTick) {
        timeline[tick]["step-2-stellar-mint"] = {
          txHash: "xlm_mint_tx",
          ledgerSequence: 600000,
          ledgerHash: "hash_600000",
          confirmationDepth: 3,
          parentHashValid: true,
          quorumReached: true,
        };
      }
    }

    return {
      name: "Optimistic Rollup Challenged Settlement Simulation",
      plan,
      timeline,
      totalTicks: totalTicks + 1,
      tickDurationMs: 100_000,
    };
  }
}
