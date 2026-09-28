import { ProtocolExitPlanner } from "../../src/Agents/tools/defi/ExitPlanner";

describe("ProtocolExitPlanner", () => {
  it("orders repayment before collateral withdrawal and requires approval", () => {
    const planner = new ProtocolExitPlanner();
    const plan = planner.buildPlan(
      {
        id: "position-1",
        protocol: "yieldblox",
        walletId: "wallet-1",
        debtAsset: "USDC",
        debtAmount: "50",
        collateralAsset: "XLM",
        collateralAmount: "200",
      },
      { USDC: "100" },
    );

    expect(plan.available).toBe(true);
    expect(plan.approvalRequired).toBe(true);
    expect(plan.steps.map((step) => step.kind)).toEqual(["repay", "withdraw_collateral"]);
    expect(plan.steps[1].dependsOn).toEqual(["repay-debt"]);
  });

  it("identifies unavailable exits and reconciles partial completion", () => {
    const planner = new ProtocolExitPlanner();
    const plan = planner.buildPlan(
      {
        id: "position-1",
        protocol: "yieldblox",
        walletId: "wallet-1",
        debtAsset: "USDC",
        debtAmount: "50",
        collateralAsset: "XLM",
        collateralAmount: "200",
        restrictions: ["withdrawal_window_closed"],
      },
      { USDC: "10" },
      ["repay-debt"],
    );

    expect(plan.available).toBe(false);
    expect(plan.unavailableReasons).toEqual([
      "withdrawal_window_closed",
      "insufficient_balance_for_repayment",
    ]);
    expect(plan.partialCompletion.completedStepIds).toEqual(["repay-debt"]);
    expect(plan.partialCompletion.remainingStepIds).toEqual(["withdraw-collateral"]);
    expect(plan.partialCompletion.fullyExited).toBe(false);
  });
});
