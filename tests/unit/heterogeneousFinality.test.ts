import {
  ConfidenceLevel,
  FinalityCategory,
  FinalityStage,
} from "../../src/services/finality/types";
import { BitcoinFinalityAdapter } from "../../src/services/finality/adapters/BitcoinFinalityAdapter";
import { StellarFinalityAdapter } from "../../src/services/finality/adapters/StellarFinalityAdapter";
import { OptimisticRollupAdapter } from "../../src/services/finality/adapters/OptimisticRollupAdapter";
import { ContractSettlementAdapter } from "../../src/services/finality/adapters/ContractSettlementAdapter";
import { ChainFinalityRegistry } from "../../src/services/finality/ChainFinalityRegistry";
import {
  CrossChainFinalityCoordinator,
  CrossChainPlan,
} from "../../src/services/finality/CrossChainFinalityCoordinator";

describe("Generic Finality Model for Heterogeneous Networks (Issue #751)", () => {
  let registry: ChainFinalityRegistry;
  let coordinator: CrossChainFinalityCoordinator;

  beforeEach(() => {
    registry = new ChainFinalityRegistry();
    coordinator = new CrossChainFinalityCoordinator(registry);
  });

  describe("Acceptance Criterion 1: Adapter Evidence & Confidence Transitions", () => {
    test("BitcoinFinalityAdapter declares probabilistic evidence, Nakamoto reorg probability, and transitions", () => {
      const btc = new BitcoinFinalityAdapter({ targetConfirmations: 6, economicThresholdConfirmations: 3 });
      expect(btc.category).toBe("probabilistic");
      expect(btc.chainId).toBe("bitcoin-mainnet");

      // Declares evidence
      const ev0 = btc.declareEvidence({ txHash: "btc_tx_1", blockHeight: 800000, confirmations: 0, blockHash: "h0" });
      expect(ev0.category).toBe("probabilistic");
      expect(ev0.confirmations).toBe(0);
      expect(ev0.reorgProbability).toBe(1.0);

      // 0 confs -> OBSERVED
      const assess0 = btc.evaluateFinality(ev0);
      expect(assess0.stage).toBe("OBSERVED");
      expect(assess0.confidenceLevel).toBe(ConfidenceLevel.OBSERVED);
      expect(assess0.isFinal).toBe(false);

      // 1 conf -> PRE_FINAL (PROVISIONAL)
      const ev1 = btc.declareEvidence({ txHash: "btc_tx_1", blockHeight: 800000, confirmations: 1, blockHash: "h1" });
      const assess1 = btc.evaluateFinality(ev1);
      expect(assess1.stage).toBe("PRE_FINAL");
      expect(assess1.confidenceLevel).toBe(ConfidenceLevel.PROVISIONAL);
      expect(assess1.isPreFinal).toBe(true);
      expect(assess1.reorgProbability).toBeGreaterThan(0);
      expect(assess1.reorgProbability).toBeLessThan(0.2); // ~0.17 for 15% attacker

      // 3 confs -> PRE_FINAL (ECONOMICALLY_SECURE)
      const ev3 = btc.declareEvidence({ txHash: "btc_tx_1", blockHeight: 800002, confirmations: 3, blockHash: "h3" });
      const assess3 = btc.evaluateFinality(ev3);
      expect(assess3.stage).toBe("PRE_FINAL");
      expect(assess3.confidenceLevel).toBe(ConfidenceLevel.ECONOMICALLY_SECURE);
      expect(assess3.isPreFinal).toBe(true);

      // 6 confs -> FINALIZED (CANONICAL_IRREVERSIBLE)
      const ev6 = btc.declareEvidence({ txHash: "btc_tx_1", blockHeight: 800005, confirmations: 6, blockHash: "h6" });
      const assess6 = btc.evaluateFinality(ev6);
      expect(assess6.stage).toBe("FINALIZED");
      expect(assess6.confidenceLevel).toBe(ConfidenceLevel.CANONICAL_IRREVERSIBLE);
      expect(assess6.isFinal).toBe(true);
      expect(assess6.reorgProbability).toBe(0.0);

      // Check declared transitions
      const transitions = btc.getTransitions();
      expect(transitions.length).toBeGreaterThanOrEqual(3);
      expect(transitions.some((t) => t.toConfidence === ConfidenceLevel.CANONICAL_IRREVERSIBLE)).toBe(true);
    });

    test("StellarFinalityAdapter declares deterministic evidence and SCP ledger closure transitions", () => {
      const stellar = new StellarFinalityAdapter({ targetConfirmationDepth: 3 });
      expect(stellar.category).toBe("deterministic");

      // Depth 0 -> OBSERVED
      const evObs = stellar.declareEvidence({ txHash: "xlm_tx_1", ledgerSequence: 500000, confirmationDepth: 0 });
      const assessObs = stellar.evaluateFinality(evObs);
      expect(assessObs.stage).toBe("OBSERVED");
      expect(assessObs.confidenceLevel).toBe(ConfidenceLevel.OBSERVED);

      // Depth 1 (Ledger closed with SCP quorum) -> PRE_FINAL (ECONOMICALLY_SECURE)
      const evClosed = stellar.declareEvidence({
        txHash: "xlm_tx_1",
        ledgerSequence: 500000,
        confirmationDepth: 1,
        quorumReached: true,
      });
      const assessClosed = stellar.evaluateFinality(evClosed);
      expect(assessClosed.stage).toBe("PRE_FINAL");
      expect(assessClosed.confidenceLevel).toBe(ConfidenceLevel.ECONOMICALLY_SECURE);

      // Depth 3 (Target depth reached + ancestry verified) -> FINALIZED
      const evFinal = stellar.declareEvidence({
        txHash: "xlm_tx_1",
        ledgerSequence: 500000,
        confirmationDepth: 3,
        parentHashValid: true,
        quorumReached: true,
      });
      const assessFinal = stellar.evaluateFinality(evFinal);
      expect(assessFinal.stage).toBe("FINALIZED");
      expect(assessFinal.confidenceLevel).toBe(ConfidenceLevel.CANONICAL_IRREVERSIBLE);
      expect(assessFinal.isFinal).toBe(true);
    });

    test("OptimisticRollupAdapter declares challenged evidence and dispute window transitions", () => {
      const rollup = new OptimisticRollupAdapter({ disputeWindowMs: 100_000 });
      expect(rollup.category).toBe("challenged");

      // Assertion published, full dispute window open -> PRE_FINAL (PROVISIONAL)
      const evOpen = rollup.declareEvidence({
        txHash: "rollup_tx_1",
        stateRoot: "0xroot123",
        disputeWindowStart: 1000,
        disputeWindowEnd: 101000,
        disputeWindowRemainingMs: 90000,
        challengeStatus: "UNOPPOSED",
      });
      const assessOpen = rollup.evaluateFinality(evOpen);
      expect(assessOpen.stage).toBe("PRE_FINAL");
      expect(assessOpen.confidenceLevel).toBe(ConfidenceLevel.PROVISIONAL);

      // Dispute window > 50% elapsed -> PRE_FINAL (ECONOMICALLY_SECURE)
      const evHalf = rollup.declareEvidence({
        txHash: "rollup_tx_1",
        stateRoot: "0xroot123",
        disputeWindowStart: 1000,
        disputeWindowEnd: 101000,
        disputeWindowRemainingMs: 30000,
        challengeStatus: "UNOPPOSED",
      });
      const assessHalf = rollup.evaluateFinality(evHalf);
      expect(assessHalf.stage).toBe("PRE_FINAL");
      expect(assessHalf.confidenceLevel).toBe(ConfidenceLevel.ECONOMICALLY_SECURE);

      // Dispute window expired unopposed -> FINALIZED
      const evExpired = rollup.declareEvidence({
        txHash: "rollup_tx_1",
        stateRoot: "0xroot123",
        disputeWindowStart: 1000,
        disputeWindowEnd: 101000,
        disputeWindowRemainingMs: 0,
        challengeStatus: "UNOPPOSED",
      });
      const assessExpired = rollup.evaluateFinality(evExpired);
      expect(assessExpired.stage).toBe("FINALIZED");
      expect(assessExpired.confidenceLevel).toBe(ConfidenceLevel.CANONICAL_IRREVERSIBLE);
      expect(assessExpired.isFinal).toBe(true);
    });

    test("ContractSettlementAdapter declares application evidence, locks, and condition transitions", () => {
      const contract = new ContractSettlementAdapter({ defaultTimelockWindowMs: 3600_000 });
      expect(contract.category).toBe("application");

      // LOCKED in escrow -> PRE_FINAL (PROVISIONAL)
      const evLocked = contract.declareEvidence({
        contractAddress: "C_ESCROW_1",
        settlementId: "settle_001",
        state: "LOCKED",
        timelockExpiry: 10000,
        currentTime: 5000,
      });
      const assessLocked = contract.evaluateFinality(evLocked);
      expect(assessLocked.stage).toBe("PRE_FINAL");
      expect(assessLocked.confidenceLevel).toBe(ConfidenceLevel.PROVISIONAL);

      // Secret revealed / conditions prepared -> PRE_FINAL (ECONOMICALLY_SECURE)
      const evPrepared = contract.declareEvidence({
        contractAddress: "C_ESCROW_1",
        settlementId: "settle_001",
        state: "PREPARED",
        secretRevealed: true,
        timelockExpiry: 10000,
        currentTime: 6000,
      });
      const assessPrepared = contract.evaluateFinality(evPrepared);
      expect(assessPrepared.stage).toBe("PRE_FINAL");
      expect(assessPrepared.confidenceLevel).toBe(ConfidenceLevel.ECONOMICALLY_SECURE);

      // Contract executed -> FINALIZED (SETTLED_IRREVOCABLE)
      const evExecuted = contract.declareEvidence({
        contractAddress: "C_ESCROW_1",
        settlementId: "settle_001",
        state: "EXECUTED",
        timelockExpiry: 10000,
        currentTime: 7000,
      });
      const assessExecuted = contract.evaluateFinality(evExecuted);
      expect(assessExecuted.stage).toBe("FINALIZED");
      expect(assessExecuted.confidenceLevel).toBe(ConfidenceLevel.SETTLED_IRREVOCABLE);
      expect(assessExecuted.isFinal).toBe(true);
    });
  });

  describe("Acceptance Criterion 2: Cross-Chain Plans Wait for Strongest Required State", () => {
    test("Dependent step is blocked until predecessor reaches strongest required confidence", () => {
      const plan: CrossChainPlan = {
        planId: "btc-stellar-swap",
        name: "BTC to Stellar Atomic Swap",
        minConfidencePolicy: ConfidenceLevel.CANONICAL_IRREVERSIBLE,
        steps: [
          {
            stepId: "step-btc",
            chainId: "bitcoin-mainnet",
            description: "Wait for 6 BTC confirmations",
            requiredConfidenceLevel: ConfidenceLevel.CANONICAL_IRREVERSIBLE,
          },
          {
            stepId: "step-stellar",
            chainId: "stellar-mainnet",
            description: "Release funds on Stellar",
            dependsOn: ["step-btc"],
            requiredConfidenceLevel: ConfidenceLevel.CANONICAL_IRREVERSIBLE,
          },
        ],
      };

      const planState = coordinator.initializePlanState(plan);

      // Step-stellar is initially waiting for dependency
      expect(planState.stepStates["step-stellar"].status).toBe("WAITING_DEPENDENCY");
      let eligibility = coordinator.isStepEligibleToExecute(plan, planState, "step-stellar");
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.blockedBy).toBe("step-btc");

      // Bitcoin reaches 1 confirmation (PROVISIONAL) -> Stellar step MUST STILL BE BLOCKED
      coordinator.recordStepEvidence(plan, planState, "step-btc", {
        txHash: "btc_tx",
        blockHeight: 800000,
        confirmations: 1,
        blockHash: "b1",
      });
      expect(planState.stepStates["step-btc"].status).toBe("PRE_FINAL_WAITING");
      eligibility = coordinator.isStepEligibleToExecute(plan, planState, "step-stellar");
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.reason).toContain("blocked");

      // Bitcoin reaches 3 confirmations (ECONOMICALLY_SECURE) -> Still blocked because strongest required state is CANONICAL_IRREVERSIBLE
      coordinator.recordStepEvidence(plan, planState, "step-btc", {
        txHash: "btc_tx",
        blockHeight: 800002,
        confirmations: 3,
        blockHash: "b3",
      });
      expect(planState.stepStates["step-btc"].status).toBe("PRE_FINAL_WAITING");
      eligibility = coordinator.isStepEligibleToExecute(plan, planState, "step-stellar");
      expect(eligibility.eligible).toBe(false);

      // Bitcoin reaches 6 confirmations (CANONICAL_IRREVERSIBLE) -> SATISFIED! Stellar step becomes eligible
      coordinator.recordStepEvidence(plan, planState, "step-btc", {
        txHash: "btc_tx",
        blockHeight: 800005,
        confirmations: 6,
        blockHash: "b6",
      });
      expect(planState.stepStates["step-btc"].status).toBe("SATISFIED");
      eligibility = coordinator.isStepEligibleToExecute(plan, planState, "step-stellar");
      expect(eligibility.eligible).toBe(true);
      expect(planState.stepStates["step-stellar"].status).toBe("IN_PROGRESS");
    });

    test("Plan-level minConfidencePolicy enforces strongest required state even if step specifies weaker level", () => {
      const plan: CrossChainPlan = {
        planId: "high-value-policy-plan",
        name: "Enforce High Security Policy",
        // Plan requires CANONICAL_IRREVERSIBLE regardless of step claims
        minConfidencePolicy: ConfidenceLevel.CANONICAL_IRREVERSIBLE,
        steps: [
          {
            stepId: "lax-step",
            chainId: "bitcoin-mainnet",
            description: "Step declaring weak requirement (PROVISIONAL)",
            requiredConfidenceLevel: ConfidenceLevel.PROVISIONAL,
          },
        ],
      };

      const resolved = coordinator.computeStrongestRequiredConfidence(plan.steps[0], plan);
      expect(resolved).toBe(ConfidenceLevel.CANONICAL_IRREVERSIBLE);

      const planState = coordinator.initializePlanState(plan);
      // 1 conf satisfies PROVISIONAL, but NOT CANONICAL_IRREVERSIBLE
      coordinator.recordStepEvidence(plan, planState, "lax-step", {
        txHash: "btc_1",
        confirmations: 1,
        blockHeight: 100,
        blockHash: "h1",
      });
      expect(planState.stepStates["lax-step"].status).toBe("PRE_FINAL_WAITING");

      // Only at 6 confs is the plan satisfied
      coordinator.recordStepEvidence(plan, planState, "lax-step", {
        txHash: "btc_1",
        confirmations: 6,
        blockHeight: 105,
        blockHash: "h6",
      });
      expect(planState.stepStates["lax-step"].status).toBe("SATISFIED");
    });
  });

  describe("Acceptance Criterion 3: Explicit Reversal Rules for Every Pre-Final State", () => {
    test("Bitcoin reorg drops confirmations in pre-final state, triggering reversal and compensatory rollback", () => {
      const btc = new BitcoinFinalityAdapter();
      const rules = btc.getReversalRules("PRE_FINAL");
      expect(rules.length).toBeGreaterThanOrEqual(2);

      const plan: CrossChainPlan = {
        planId: "reorg-test-plan",
        name: "Test Reorg Safety",
        steps: [
          {
            stepId: "btc-deposit",
            chainId: "bitcoin-mainnet",
            description: "Deposit BTC",
            compensatoryAction: "refund_btc_deposit",
          },
          {
            stepId: "stellar-release",
            chainId: "stellar-mainnet",
            description: "Release XLM",
            dependsOn: ["btc-deposit"],
            compensatoryAction: "cancel_stellar_reservation",
          },
        ],
      };

      const planState = coordinator.initializePlanState(plan);

      // Observation 1: 2 confirmations (PRE_FINAL)
      coordinator.recordStepEvidence(plan, planState, "btc-deposit", {
        txHash: "btc_tx",
        blockHeight: 800000,
        confirmations: 2,
        blockHash: "original_block_hash",
      });
      expect(planState.stepStates["btc-deposit"].status).toBe("PRE_FINAL_WAITING");

      // Observation 2: Reorg occurs! Confirmations drop from 2 to 0
      const assessment = coordinator.recordStepEvidence(plan, planState, "btc-deposit", {
        txHash: "btc_tx",
        blockHeight: 800000,
        confirmations: 0,
        blockHash: "reorged_fork_hash",
      });

      expect(assessment.isReversed).toBe(true);
      expect(assessment.stage).toBe("REVERSED");
      expect(assessment.reversalReason).toContain("Reorganization detected");
      expect(planState.status).toBe("REVERSED");
      expect(planState.stepStates["btc-deposit"].status).toBe("REVERSED");

      // Check compensatory actions were triggered
      expect(planState.stepStates["btc-deposit"].executedCompensatoryActions).toContain("refund_btc_deposit");
      expect(planState.reversalDetails?.rule.ruleId).toBe("BTC_REORG_CONFIRMATION_DROP");

      // Stellar release step must NEVER be eligible
      const eligibility = coordinator.isStepEligibleToExecute(plan, planState, "stellar-release");
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.reason).toContain("Plan is reversed");
    });

    test("Optimistic Rollup fraud proof triggers reversal rule and aborts plan", () => {
      const plan: CrossChainPlan = {
        planId: "fraud-test-plan",
        name: "Test Fraud Proof Safety",
        steps: [
          {
            stepId: "rollup-assertion",
            chainId: "optimism-mainnet",
            description: "Rollup state assertion",
            compensatoryAction: "slash_fraudulent_assertor",
          },
        ],
      };

      const planState = coordinator.initializePlanState(plan);

      // In dispute window (PRE_FINAL)
      coordinator.recordStepEvidence(plan, planState, "rollup-assertion", {
        txHash: "rollup_tx",
        stateRoot: "0xroot_initial",
        disputeWindowStart: 1000,
        disputeWindowEnd: 50000,
        disputeWindowRemainingMs: 30000,
        challengeStatus: "UNOPPOSED",
      });
      expect(planState.stepStates["rollup-assertion"].status).toBe("PRE_FINAL_WAITING");

      // Fraud proof submitted and upheld
      const assessment = coordinator.recordStepEvidence(plan, planState, "rollup-assertion", {
        txHash: "rollup_tx",
        stateRoot: "0xroot_initial",
        disputeWindowStart: 1000,
        disputeWindowEnd: 50000,
        disputeWindowRemainingMs: 25000,
        challengeStatus: "FRAUD_PROVED",
        fraudProofHash: "0xvalid_fraud_proof",
      });

      expect(assessment.isReversed).toBe(true);
      expect(planState.status).toBe("REVERSED");
      expect(assessment.reversalReason).toContain("Fraud proof verified");
      expect(planState.stepStates["rollup-assertion"].executedCompensatoryActions).toContain("slash_fraudulent_assertor");
    });

    test("Contract Settlement timelock expiry triggers reversal rule and refunds escrow", () => {
      const plan: CrossChainPlan = {
        planId: "escrow-timelock-plan",
        name: "Test Timelock Safety",
        steps: [
          {
            stepId: "escrow-lock",
            chainId: "soroban-smart-contract",
            description: "Escrow funds in Soroban contract",
            compensatoryAction: "claim_timelock_escrow_refund",
          },
        ],
      };

      const planState = coordinator.initializePlanState(plan);

      // Funds locked (PRE_FINAL)
      coordinator.recordStepEvidence(plan, planState, "escrow-lock", {
        contractAddress: "C_ESCROW",
        settlementId: "s1",
        state: "LOCKED",
        timelockExpiry: 10000,
        currentTime: 8000,
      });
      expect(planState.stepStates["escrow-lock"].status).toBe("PRE_FINAL_WAITING");

      // Timelock expired (currentTime > timelockExpiry) without execution
      const assessment = coordinator.recordStepEvidence(plan, planState, "escrow-lock", {
        contractAddress: "C_ESCROW",
        settlementId: "s1",
        state: "LOCKED",
        timelockExpiry: 10000,
        currentTime: 10001,
      });

      expect(assessment.isReversed).toBe(true);
      expect(planState.status).toBe("REVERSED");
      expect(assessment.reversalReason).toContain("Contract timelock expired");
      expect(planState.stepStates["escrow-lock"].executedCompensatoryActions).toContain("claim_timelock_escrow_refund");
    });
  });
});
