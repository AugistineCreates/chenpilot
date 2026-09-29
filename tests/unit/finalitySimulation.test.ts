import { FinalitySimulator } from "../../src/simulation/finality/FinalitySimulator";
import { ConfidenceLevel } from "../../src/services/finality/types";

describe("Finality Simulation Engine (Issue #751)", () => {
  let simulator: FinalitySimulator;

  beforeEach(() => {
    simulator = new FinalitySimulator();
  });

  describe("Acceptance Criterion 4: Simulations cover asymmetric finality and delayed settlement", () => {
    test("Simulates asymmetric finality: Fast Stellar release correctly blocked until slow Bitcoin achieves 6 confs", async () => {
      // Bitcoin increments: 0, 1, 2, 3, 4, 5, 6
      const scenario = FinalitySimulator.createBitcoinToStellarScenario({
        btcConfirmationsPerTick: [0, 1, 2, 3, 4, 5, 6],
      });

      const result = await simulator.runScenario(scenario);

      expect(result.asymmetricSafetyMaintained).toBe(true);
      expect(result.finalPlanStatus).toBe("SATISFIED");

      // Verify each tick of the simulation:
      // Ticks 0 to 5: Bitcoin has 0-5 confirmations. Stellar release MUST NOT be eligible!
      for (let tick = 0; tick < 6; tick++) {
        const tickResult = result.timelineResults[tick];
        expect(tickResult.eligibleSteps).toContain("step-1-btc-deposit");
        expect(tickResult.eligibleSteps).not.toContain("step-2-stellar-release");
      }

      // Tick 6: Bitcoin reaches 6 confirmations. Stellar release MUST become eligible!
      const tick6 = result.timelineResults[6];
      expect(tick6.stepAssessments["step-1-btc-deposit"]?.confidenceLevel).toBe(
        ConfidenceLevel.CANONICAL_IRREVERSIBLE
      );
      expect(tick6.eligibleSteps).toContain("step-2-stellar-release");
    });

    test("Simulates delayed settlement: Network delay exceeding timeout threshold triggers graceful abort & refund", async () => {
      // Bitcoin stuck at 2 confirmations, ticks advance past timeout (timeout = 1,800,000ms = 3 ticks @ 600,000ms/tick)
      const scenario = FinalitySimulator.createBitcoinToStellarScenario({
        btcConfirmationsPerTick: [0, 1, 2, 2, 2], // stalled at 2 confs
        timeoutMs: 1_800_000, // 30 minutes
      });

      const result = await simulator.runScenario(scenario);

      expect(result.finalPlanStatus).toBe("TIMED_OUT");
      expect(result.stepFinalStatuses["step-1-btc-deposit"]).toBe("TIMED_OUT");
      expect(result.stepFinalStatuses["step-2-stellar-release"]).toBe("WAITING_DEPENDENCY");

      // Stellar release was NEVER made eligible during the delay
      for (const tickResult of result.timelineResults) {
        expect(tickResult.eligibleSteps).not.toContain("step-2-stellar-release");
      }
      expect(result.timeoutHandledCorrectly).toBe(true);
    });

    test("Simulates pre-final reorg during asymmetric execution: Downstream leg safely aborted", async () => {
      // Reorg injected at tick 3 (confirmations drop to 0 with competing branch)
      const scenario = FinalitySimulator.createBitcoinToStellarScenario({
        btcConfirmationsPerTick: [0, 1, 2, 0, 0],
        simulateReorgAtTick: 3,
      });

      const result = await simulator.runScenario(scenario);

      expect(result.finalPlanStatus).toBe("REVERSED");
      expect(result.stepFinalStatuses["step-1-btc-deposit"]).toBe("REVERSED");
      expect(result.reversalHandledGracefully).toBe(true);

      // Verify that after reorg, no steps are eligible
      const afterReorgTick = result.timelineResults[3];
      expect(afterReorgTick.reversalTriggered).toBe(true);
      expect(afterReorgTick.eligibleSteps).toHaveLength(0);
    });

    test("Simulates challenged optimistic rollup settlement with and without fraud proof", async () => {
      // 1. Happy path: dispute window lapses unopposed
      const unopposedScenario = FinalitySimulator.createRollupToStellarScenario({
        challengePeriodTicks: 4,
      });
      const unopposedResult = await simulator.runScenario(unopposedScenario);
      expect(unopposedResult.finalPlanStatus).toBe("SATISFIED");
      expect(unopposedResult.stepFinalStatuses["step-1-rollup-assertion"]).toBe("SATISFIED");

      // 2. Fraudulent path: fraud proof injected at tick 2
      const fraudScenario = FinalitySimulator.createRollupToStellarScenario({
        challengePeriodTicks: 4,
        injectFraudProofAtTick: 2,
      });
      const fraudResult = await simulator.runScenario(fraudScenario);
      expect(fraudResult.finalPlanStatus).toBe("REVERSED");
      expect(fraudResult.stepFinalStatuses["step-1-rollup-assertion"]).toBe("REVERSED");
      expect(fraudResult.reversalHandledGracefully).toBe(true);

      // Stellar mint leg was never executed
      expect(fraudResult.stepFinalStatuses["step-2-stellar-mint"]).toBe("WAITING_DEPENDENCY");
    });
  });
});
