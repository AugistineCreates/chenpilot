/**
 * Decomposed Execution Cost Components & Bound Enforcement
 *
 * Implements Issue #756:
 * Separates aggregate tolerances into independent cost components:
 * - Price impact (market / pool depth effect)
 * - Slippage (execution-time price drift)
 * - Protocol fee
 * - Network fee (base + bump)
 * - Solver spread (solver margin / routing spread)
 *
 * Ensures each component is verified against its own discrete bound in
 * simulation, approval, and execution phases.
 */

import BigNumber from 'bignumber.js';

export interface CostComponentLimits {
  /** Maximum price impact in basis points (1 bps = 0.01%) */
  maxPriceImpactBps: number;
  /** Maximum allowable execution slippage in basis points */
  maxSlippageBps: number;
  /** Maximum protocol fee in stroops/canonical decimal string */
  maxProtocolFee: string;
  /** Maximum network fee in stroops/canonical decimal string */
  maxNetworkFee: string;
  /** Maximum solver spread in basis points */
  maxSolverSpreadBps: number;
}

export interface CostComponentValues {
  /** Price impact in basis points */
  priceImpactBps: number;
  /** Absolute price impact in source asset units */
  priceImpactAbsolute: string;
  /** Expected slippage tolerance in basis points */
  slippageBps: number;
  /** Absolute slippage allowance in destination asset units */
  slippageAbsolute: string;
  /** Protocol fee amount in canonical decimal string */
  protocolFee: string;
  /** Network fee amount in canonical decimal string */
  networkFee: string;
  /** Solver spread in basis points */
  solverSpreadBps: number;
  /** Absolute solver spread in destination asset units */
  solverSpreadAbsolute: string;
}

export interface ApprovalCostItem {
  name: string;
  absolute: string;
  percentageBps: number;
  percentageDisplay: string;
  limitDisplay: string;
  withinLimit: boolean;
}

export interface ApprovalCostBreakdown {
  items: Record<string, ApprovalCostItem>;
  totalFeesAbsolute: string;
  allWithinBounds: boolean;
}

export class CostLimitExceededError extends Error {
  constructor(
    public readonly component: string,
    public readonly actual: string | number,
    public readonly limit: string | number
  ) {
    super(
      `Cost limit exceeded for ${component}: actual=${actual} exceeds maximum allowable bound=${limit}`
    );
    this.name = 'CostLimitExceededError';
  }
}

export class PriceImpactExceededError extends CostLimitExceededError {
  constructor(actual: number, limit: number) {
    super('priceImpactBps', actual, limit);
    this.name = 'PriceImpactExceededError';
  }
}

export class SlippageExceededError extends CostLimitExceededError {
  constructor(actual: number, limit: number) {
    super('slippageBps', actual, limit);
    this.name = 'SlippageExceededError';
  }
}

export class ProtocolFeeExceededError extends CostLimitExceededError {
  constructor(actual: string, limit: string) {
    super('protocolFee', actual, limit);
    this.name = 'ProtocolFeeExceededError';
  }
}

export class NetworkFeeExceededError extends CostLimitExceededError {
  constructor(actual: string, limit: string) {
    super('networkFee', actual, limit);
    this.name = 'NetworkFeeExceededError';
  }
}

export class SolverSpreadExceededError extends CostLimitExceededError {
  constructor(actual: number, limit: number) {
    super('solverSpreadBps', actual, limit);
    this.name = 'SolverSpreadExceededError';
  }
}

/**
 * Validate each decomposed cost component independently against its configured limit.
 * Throws immediately if ANY single component breaches its individual ceiling,
 * regardless of whether the aggregate fee/cost remains within an overall budget.
 */
export function validateCostComponents(
  costs: CostComponentValues,
  limits: CostComponentLimits
): void {
  if (costs.priceImpactBps > limits.maxPriceImpactBps) {
    throw new PriceImpactExceededError(costs.priceImpactBps, limits.maxPriceImpactBps);
  }

  if (costs.slippageBps > limits.maxSlippageBps) {
    throw new SlippageExceededError(costs.slippageBps, limits.maxSlippageBps);
  }

  const actualProtocolFee = new BigNumber(costs.protocolFee || '0');
  const maxProtocolFee = new BigNumber(limits.maxProtocolFee || '0');
  if (actualProtocolFee.isGreaterThan(maxProtocolFee)) {
    throw new ProtocolFeeExceededError(costs.protocolFee, limits.maxProtocolFee);
  }

  const actualNetworkFee = new BigNumber(costs.networkFee || '0');
  const maxNetworkFee = new BigNumber(limits.maxNetworkFee || '0');
  if (actualNetworkFee.isGreaterThan(maxNetworkFee)) {
    throw new NetworkFeeExceededError(costs.networkFee, limits.maxNetworkFee);
  }

  if (costs.solverSpreadBps > limits.maxSolverSpreadBps) {
    throw new SolverSpreadExceededError(costs.solverSpreadBps, limits.maxSolverSpreadBps);
  }
}

/**
 * Generate user-facing approval breakdown displaying both absolute values
 * and percentage impact for each decomposed component.
 */
export function buildApprovalBreakdown(
  costs: CostComponentValues,
  limits: CostComponentLimits
): ApprovalCostBreakdown {
  const formatBps = (bps: number) => `${(bps / 100).toFixed(2)}%`;

  const items: Record<string, ApprovalCostItem> = {
    priceImpact: {
      name: 'Price Impact',
      absolute: costs.priceImpactAbsolute,
      percentageBps: costs.priceImpactBps,
      percentageDisplay: formatBps(costs.priceImpactBps),
      limitDisplay: formatBps(limits.maxPriceImpactBps),
      withinLimit: costs.priceImpactBps <= limits.maxPriceImpactBps,
    },
    slippage: {
      name: 'Slippage Tolerance',
      absolute: costs.slippageAbsolute,
      percentageBps: costs.slippageBps,
      percentageDisplay: formatBps(costs.slippageBps),
      limitDisplay: formatBps(limits.maxSlippageBps),
      withinLimit: costs.slippageBps <= limits.maxSlippageBps,
    },
    protocolFee: {
      name: 'Protocol Fee',
      absolute: costs.protocolFee,
      percentageBps: 0,
      percentageDisplay: `${costs.protocolFee} units`,
      limitDisplay: `${limits.maxProtocolFee} units`,
      withinLimit: new BigNumber(costs.protocolFee).isLessThanOrEqualTo(limits.maxProtocolFee),
    },
    networkFee: {
      name: 'Network Fee',
      absolute: costs.networkFee,
      percentageBps: 0,
      percentageDisplay: `${costs.networkFee} units`,
      limitDisplay: `${limits.maxNetworkFee} units`,
      withinLimit: new BigNumber(costs.networkFee).isLessThanOrEqualTo(limits.maxNetworkFee),
    },
    solverSpread: {
      name: 'Solver Spread',
      absolute: costs.solverSpreadAbsolute,
      percentageBps: costs.solverSpreadBps,
      percentageDisplay: formatBps(costs.solverSpreadBps),
      limitDisplay: formatBps(limits.maxSolverSpreadBps),
      withinLimit: costs.solverSpreadBps <= limits.maxSolverSpreadBps,
    },
  };

  const totalFees = new BigNumber(costs.protocolFee || '0').plus(costs.networkFee || '0');
  const allWithinBounds = Object.values(items).every((item) => item.withinLimit);

  return {
    items,
    totalFeesAbsolute: totalFees.toFixed(),
    allWithinBounds,
  };
}
