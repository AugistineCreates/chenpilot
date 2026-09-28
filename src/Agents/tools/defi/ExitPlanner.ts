export type ExitStepKind = "repay" | "withdraw_collateral" | "remove_liquidity" | "claim" | "approval";

export interface ProtocolExitPosition {
  id: string;
  protocol: string;
  walletId: string;
  debtAsset?: string;
  debtAmount?: string;
  collateralAsset?: string;
  collateralAmount?: string;
  liquidityAsset?: string;
  liquidityAmount?: string;
  claimableAsset?: string;
  claimableAmount?: string;
  restrictions?: string[];
}

export interface ExitPlanStep {
  id: string;
  kind: ExitStepKind;
  asset: string;
  amount: string;
  requiresApproval: boolean;
  dependsOn: string[];
  unavailableReason?: string;
}

export interface ExitPlan {
  positionId: string;
  protocol: string;
  available: boolean;
  unavailableReasons: string[];
  steps: ExitPlanStep[];
  approvalRequired: boolean;
  partialCompletion: {
    completedStepIds: string[];
    remainingStepIds: string[];
    fullyExited: boolean;
  };
}

const amountPositive = (amount?: string): amount is string =>
  typeof amount === "string" && /^\d+$/.test(amount) && BigInt(amount) > 0n;

export class ProtocolExitPlanner {
  buildPlan(
    position: ProtocolExitPosition,
    availableBalances: Record<string, string>,
    completedStepIds: string[] = [],
  ): ExitPlan {
    const steps: ExitPlanStep[] = [];
    const unavailableReasons = [...(position.restrictions ?? [])];
    let repayStepId: string | undefined;

    if (amountPositive(position.debtAmount) && position.debtAsset) {
      repayStepId = "repay-debt";
      const balance = BigInt(availableBalances[position.debtAsset] ?? "0");
      const needed = BigInt(position.debtAmount);
      steps.push({
        id: repayStepId,
        kind: "repay",
        asset: position.debtAsset,
        amount: position.debtAmount,
        requiresApproval: true,
        dependsOn: [],
        unavailableReason: balance < needed ? "insufficient_balance_for_repayment" : undefined,
      });
      if (balance < needed) unavailableReasons.push("insufficient_balance_for_repayment");
    }

    if (amountPositive(position.collateralAmount) && position.collateralAsset) {
      steps.push({
        id: "withdraw-collateral",
        kind: "withdraw_collateral",
        asset: position.collateralAsset,
        amount: position.collateralAmount,
        requiresApproval: true,
        dependsOn: repayStepId ? [repayStepId] : [],
      });
    }

    if (amountPositive(position.liquidityAmount) && position.liquidityAsset) {
      steps.push({
        id: "remove-liquidity",
        kind: "remove_liquidity",
        asset: position.liquidityAsset,
        amount: position.liquidityAmount,
        requiresApproval: true,
        dependsOn: [],
      });
    }

    if (amountPositive(position.claimableAmount) && position.claimableAsset) {
      steps.push({
        id: "claim-rewards",
        kind: "claim",
        asset: position.claimableAsset,
        amount: position.claimableAmount,
        requiresApproval: false,
        dependsOn: [],
      });
    }

    const completed = new Set(completedStepIds);
    const remainingStepIds = steps
      .filter((step) => !completed.has(step.id))
      .map((step) => step.id);

    return {
      positionId: position.id,
      protocol: position.protocol,
      available: unavailableReasons.length === 0 && steps.every((step) => !step.unavailableReason),
      unavailableReasons: [...new Set(unavailableReasons)],
      steps,
      approvalRequired: steps.some((step) => step.requiresApproval && !completed.has(step.id)),
      partialCompletion: {
        completedStepIds: steps.filter((step) => completed.has(step.id)).map((step) => step.id),
        remainingStepIds,
        fullyExited: remainingStepIds.length === 0 && steps.length > 0,
      },
    };
  }
}

export const protocolExitPlanner = new ProtocolExitPlanner();
