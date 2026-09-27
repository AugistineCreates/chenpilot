/**
 * Transient liquidity manipulation checks for quoted routes.
 *
 * Signals (all recorded with the quote):
 * - `shallow_liquidity`: route input is a large share of a pool's reserve.
 *   Amounts are summed per pool across all hops, so splitting a route into
 *   several small legs through the same pool does not dodge the check.
 * - `historical_deviation`: the pool's spot price is far from its recent average.
 * - `source_divergence`: independent price sources disagree with the pool.
 * - `pre_settlement_drift`: reserves moved between simulation and settlement
 *   (flash liquidity / reserve spoofing).
 *
 * Signals map to a risk level, and the configured circuit breaker turns the
 * level into accept / require-strict-policy / reject.
 */

export interface RouteHop {
  poolId: string;
  amountIn: bigint;
  reserveIn: bigint;
  reserveOut: bigint;
  /** Recent average price (reserveOut / reserveIn) for this pool. */
  historicalPrice: number;
  /** Prices for the same pair from independent sources (oracles, other venues). */
  sourcePrices: number[];
  /** Reserves re-read right before settlement, if available. */
  settlementReserves?: { reserveIn: bigint; reserveOut: bigint };
}

export interface ManipulationConfig {
  /** Max share of reserveIn the route may consume per pool, in bps. */
  maxDepthBps: number;
  maxHistoricalDeviationBps: number;
  maxSourceDivergenceBps: number;
  maxSettlementDriftBps: number;
  /** Signal count at which the route needs a stricter policy / is rejected. */
  strictAt: number;
  rejectAt: number;
}

export const DEFAULT_MANIPULATION_CONFIG: ManipulationConfig = {
  maxDepthBps: 500, // 5% of pool depth
  maxHistoricalDeviationBps: 300,
  maxSourceDivergenceBps: 200,
  maxSettlementDriftBps: 100,
  strictAt: 1,
  rejectAt: 2,
};

export type SignalKind =
  | "shallow_liquidity"
  | "historical_deviation"
  | "source_divergence"
  | "pre_settlement_drift";

export interface ManipulationSignal {
  kind: SignalKind;
  poolId: string;
  observedBps: number;
  limitBps: number;
}

export type RouteDecision = "accept" | "require_strict_policy" | "reject";

export interface ManipulationAssessment {
  signals: ManipulationSignal[];
  decision: RouteDecision;
}

const BPS = 10_000;

function deviationBps(a: number, b: number): number {
  if (!(a > 0) || !(b > 0)) return Number.POSITIVE_INFINITY;
  return Math.round((Math.abs(a - b) / b) * BPS);
}

function spot(reserveIn: bigint, reserveOut: bigint): number {
  return reserveIn > 0n ? Number(reserveOut) / Number(reserveIn) : 0;
}

export function assessRoute(
  hops: RouteHop[],
  config: ManipulationConfig = DEFAULT_MANIPULATION_CONFIG,
): ManipulationAssessment {
  const signals: ManipulationSignal[] = [];
  const add = (kind: SignalKind, poolId: string, observedBps: number, limitBps: number) => {
    if (observedBps > limitBps) signals.push({ kind, poolId, observedBps, limitBps });
  };

  // Depth: aggregate per pool so split routes are judged as a whole.
  const perPool = new Map<string, { amountIn: bigint; reserveIn: bigint }>();
  for (const hop of hops) {
    const prev = perPool.get(hop.poolId);
    perPool.set(hop.poolId, {
      amountIn: (prev?.amountIn ?? 0n) + hop.amountIn,
      reserveIn: prev ? (prev.reserveIn < hop.reserveIn ? prev.reserveIn : hop.reserveIn) : hop.reserveIn,
    });
  }
  for (const [poolId, { amountIn, reserveIn }] of perPool) {
    const depthBps = reserveIn > 0n ? Number((amountIn * BigInt(BPS)) / reserveIn) : Number.POSITIVE_INFINITY;
    add("shallow_liquidity", poolId, depthBps, config.maxDepthBps);
  }

  const seen = new Set<string>();
  for (const hop of hops) {
    if (seen.has(hop.poolId)) continue;
    seen.add(hop.poolId);
    const price = spot(hop.reserveIn, hop.reserveOut);
    add("historical_deviation", hop.poolId, deviationBps(price, hop.historicalPrice), config.maxHistoricalDeviationBps);
    if (hop.sourcePrices.length > 0) {
      const worst = Math.max(...hop.sourcePrices.map((p) => deviationBps(price, p)));
      add("source_divergence", hop.poolId, worst, config.maxSourceDivergenceBps);
    }
    if (hop.settlementReserves) {
      const settled = spot(hop.settlementReserves.reserveIn, hop.settlementReserves.reserveOut);
      add("pre_settlement_drift", hop.poolId, deviationBps(settled, price), config.maxSettlementDriftBps);
    }
  }

  const decision: RouteDecision =
    signals.length >= config.rejectAt
      ? "reject"
      : signals.length >= config.strictAt
        ? "require_strict_policy"
        : "accept";
  return { signals, decision };
}

/** Attaches the assessment to a quote so the signals are recorded with it. */
export function withManipulationSignals<Q extends object>(
  quote: Q,
  hops: RouteHop[],
  config?: ManipulationConfig,
): Q & { manipulation: ManipulationAssessment } {
  return { ...quote, manipulation: assessRoute(hops, config) };
}
