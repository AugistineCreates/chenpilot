import { RouteHop, assessRoute, withManipulationSignals } from "../liquidityManipulation";

function healthyHop(overrides: Partial<RouteHop> = {}): RouteHop {
  return {
    poolId: "XLM/USDC",
    amountIn: 1_000n,
    reserveIn: 1_000_000n,
    reserveOut: 100_000n, // price 0.1
    historicalPrice: 0.1,
    sourcePrices: [0.1, 0.1005],
    ...overrides,
  };
}

describe("liquidity manipulation checks", () => {
  it("accepts a deep, consistent route", () => {
    expect(assessRoute([healthyHop()])).toEqual({ signals: [], decision: "accept" });
  });

  it("flags a shallow pool and requires a stricter policy", () => {
    const result = assessRoute([healthyHop({ amountIn: 100_000n })]); // 10% of depth
    expect(result.signals.map((s) => s.kind)).toEqual(["shallow_liquidity"]);
    expect(result.decision).toBe("require_strict_policy");
  });

  it("cannot be bypassed by splitting a route through the same pool", () => {
    const legs = Array.from({ length: 10 }, () => healthyHop({ amountIn: 10_000n })); // 1% each, 10% total
    expect(assessRoute([legs[0]]).signals).toEqual([]);
    expect(assessRoute(legs).signals.map((s) => s.kind)).toEqual(["shallow_liquidity"]);
  });

  it("rejects flash liquidity that inflates reserves during simulation", () => {
    // Attacker adds liquidity and skews price for the simulation; it is gone at settlement.
    const result = assessRoute([
      healthyHop({
        reserveIn: 1_000_000n,
        reserveOut: 130_000n, // spot 0.13 vs history 0.1
        settlementReserves: { reserveIn: 1_000_000n, reserveOut: 100_000n },
      }),
    ]);
    expect(result.signals.map((s) => s.kind).sort()).toEqual(
      ["historical_deviation", "pre_settlement_drift", "source_divergence"].sort(),
    );
    expect(result.decision).toBe("reject");
  });

  it("detects reserve spoofing against independent sources", () => {
    const result = assessRoute([healthyHop({ reserveOut: 102_500n, historicalPrice: 0.1025, sourcePrices: [0.1] })]);
    expect(result.signals.map((s) => s.kind)).toEqual(["source_divergence"]);
  });

  it("treats an empty pool as maximally risky", () => {
    const result = assessRoute([healthyHop({ reserveIn: 0n })]);
    expect(result.decision).toBe("reject");
  });

  it("uses configurable circuit breakers", () => {
    const hop = healthyHop({ amountIn: 100_000n });
    const lenient = { maxDepthBps: 2_000, maxHistoricalDeviationBps: 300, maxSourceDivergenceBps: 200, maxSettlementDriftBps: 100, strictAt: 1, rejectAt: 2 };
    expect(assessRoute([hop], lenient).decision).toBe("accept");
    expect(assessRoute([hop], { ...lenient, maxDepthBps: 500, rejectAt: 1 }).decision).toBe("reject");
  });

  it("records signals with the quote", () => {
    const quote = withManipulationSignals({ id: "q1", amountOut: "95" }, [healthyHop({ amountIn: 100_000n })]);
    expect(quote.id).toBe("q1");
    expect(quote.manipulation.signals[0]).toMatchObject({ kind: "shallow_liquidity", poolId: "XLM/USDC", limitBps: 500 });
  });
});
