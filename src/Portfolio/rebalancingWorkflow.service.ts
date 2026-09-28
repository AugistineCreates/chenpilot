import crypto from "crypto";

export type RebalanceSide = "buy" | "sell";
export type RebalanceStatus = "planned" | "executed" | "incomplete";

export interface AllocationTarget {
  asset: string;
  targetBps: number;
  toleranceBps: number;
  minTradeValue: number;
}

export interface PortfolioHolding {
  asset: string;
  value: number;
}

export interface ProposedTrade {
  id: string;
  asset: string;
  side: RebalanceSide;
  value: number;
  limitValue: number;
  feeEstimate: number;
  status: RebalanceStatus;
  reason?: string;
}

export interface RebalanceApproval {
  approvedBy: string;
  planHash: string;
  maxFeeValue: number;
  approvedAt: string;
}

export interface RebalancePlan {
  id: string;
  planHash: string;
  totalValue: number;
  targets: AllocationTarget[];
  trades: ProposedTrade[];
  residualValue: number;
  achievedAllocations: Record<string, number>;
  incompleteActions: string[];
}

export interface TradeExecutor {
  execute(trade: ProposedTrade, approval: RebalanceApproval): Promise<{ executedValue: number; feeValue: number }>;
}

export class PortfolioRebalancingWorkflow {
  constructor(
    private readonly supportedAssets = new Set(["XLM", "USDC", "USDT"]),
    private readonly feeRate = 0.001,
  ) {}

  propose(holdings: PortfolioHolding[], targets: AllocationTarget[]): RebalancePlan {
    const totalTarget = targets.reduce((sum, target) => sum + target.targetBps, 0);
    if (totalTarget !== 10_000) {
      throw new Error(`Allocation targets must total 10000 bps; received ${totalTarget}`);
    }

    const totalValue = holdings.reduce((sum, holding) => sum + holding.value, 0);
    if (totalValue <= 0) {
      throw new Error("Portfolio value must be positive before rebalancing");
    }

    const balances = new Map(holdings.map((holding) => [holding.asset.toUpperCase(), holding.value]));
    const trades: ProposedTrade[] = [];
    const incompleteActions: string[] = [];

    for (const target of targets) {
      const asset = target.asset.toUpperCase();
      if (!this.supportedAssets.has(asset)) {
        incompleteActions.push(`${asset}: unsupported asset`);
        continue;
      }

      const currentValue = balances.get(asset) ?? 0;
      const desiredValue = (totalValue * target.targetBps) / 10_000;
      const toleranceValue = (totalValue * target.toleranceBps) / 10_000;
      const delta = desiredValue - currentValue;

      if (Math.abs(delta) <= toleranceValue) {
        continue;
      }
      if (Math.abs(delta) < target.minTradeValue) {
        incompleteActions.push(`${asset}: drift ${Math.abs(delta).toFixed(2)} below minimum trade ${target.minTradeValue}`);
        continue;
      }

      const feeEstimate = Math.abs(delta) * this.feeRate;
      trades.push({
        id: `${asset}:${delta > 0 ? "buy" : "sell"}`,
        asset,
        side: delta > 0 ? "buy" : "sell",
        value: Math.abs(delta),
        limitValue: Math.abs(delta) + feeEstimate,
        feeEstimate,
        status: "planned",
      });
    }

    const planCore = { totalValue, targets, trades: trades.map(({ status, reason, ...trade }) => trade) };
    const planHash = this.hash(planCore);
    return {
      id: `rebalance_${planHash.slice(0, 12)}`,
      planHash,
      totalValue,
      targets,
      trades,
      residualValue: this.residual(totalValue, trades),
      achievedAllocations: this.allocations(totalValue, balances),
      incompleteActions,
    };
  }

  approve(plan: RebalancePlan, approvedBy: string, maxFeeValue: number, now = new Date()): RebalanceApproval {
    const fees = plan.trades.reduce((sum, trade) => sum + trade.feeEstimate, 0);
    if (fees > maxFeeValue) {
      throw new Error(`Estimated fees ${fees.toFixed(2)} exceed approved fee limit ${maxFeeValue}`);
    }
    return { approvedBy, planHash: plan.planHash, maxFeeValue, approvedAt: now.toISOString() };
  }

  async execute(plan: RebalancePlan, approval: RebalanceApproval, executor: TradeExecutor): Promise<RebalancePlan> {
    if (approval.planHash !== plan.planHash) {
      throw new Error("Approval does not match proposed rebalance plan");
    }

    let feeTotal = 0;
    const trades: ProposedTrade[] = [];
    const achieved = new Map(plan.targets.map((target) => [target.asset.toUpperCase(), 0]));
    const incompleteActions = [...plan.incompleteActions];

    for (const trade of plan.trades) {
      try {
        const result = await executor.execute(trade, approval);
        feeTotal += result.feeValue;
        if (feeTotal > approval.maxFeeValue || result.executedValue > trade.limitValue) {
          throw new Error("execution exceeded approved trade or fee limit");
        }
        achieved.set(trade.asset, (achieved.get(trade.asset) ?? 0) + (trade.side === "buy" ? result.executedValue : -result.executedValue));
        trades.push({ ...trade, status: "executed", feeEstimate: result.feeValue });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown execution failure";
        trades.push({ ...trade, status: "incomplete", reason });
        incompleteActions.push(`${trade.asset}: ${reason}`);
      }
    }

    return {
      ...plan,
      trades,
      residualValue: Math.max(0, plan.residualValue - feeTotal),
      achievedAllocations: this.entriesToAllocations([...achieved.entries()], plan.totalValue),
      incompleteActions,
    };
  }

  private residual(totalValue: number, trades: ProposedTrade[]): number {
    return Math.max(0, totalValue - trades.reduce((sum, trade) => sum + trade.value + trade.feeEstimate, 0));
  }

  private allocations(totalValue: number, balances: Map<string, number>): Record<string, number> {
    return this.entriesToAllocations([...balances.entries()], totalValue);
  }

  private entriesToAllocations(entries: Array<[string, number]>, totalValue: number): Record<string, number> {
    return entries.reduce<Record<string, number>>((allocations, [asset, value]) => {
      allocations[asset] = totalValue > 0 ? value / totalValue : 0;
      return allocations;
    }, {});
  }

  private hash(value: unknown): string {
    return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }
}
