import {
  CostComponentLimits,
  CostComponentValues,
  validateCostComponents,
  buildApprovalBreakdown,
  PriceImpactExceededError,
  SlippageExceededError,
  ProtocolFeeExceededError,
  NetworkFeeExceededError,
  SolverSpreadExceededError,
} from '../../src/domain/quotes/costComponents';

describe('Issue #756: Decomposed Execution Cost Components & Bound Enforcement', () => {
  const baseLimits: CostComponentLimits = {
    maxPriceImpactBps: 50, // 0.50%
    maxSlippageBps: 100, // 1.00%
    maxProtocolFee: '0.0050000',
    maxNetworkFee: '0.0001000',
    maxSolverSpreadBps: 25, // 0.25%
  };

  const validCosts: CostComponentValues = {
    priceImpactBps: 20,
    priceImpactAbsolute: '0.0020000',
    slippageBps: 50,
    slippageAbsolute: '0.0050000',
    protocolFee: '0.0030000',
    networkFee: '0.0000500',
    solverSpreadBps: 15,
    solverSpreadAbsolute: '0.0015000',
  };

  it('should validate successfully when all cost components are within individual limits', () => {
    expect(() => validateCostComponents(validCosts, baseLimits)).not.toThrow();
  });

  it('should fail when price impact exceeds bound even if overall aggregate fee is low', () => {
    const highImpact: CostComponentValues = {
      ...validCosts,
      priceImpactBps: 80, // > 50 bps
    };
    expect(() => validateCostComponents(highImpact, baseLimits)).toThrow(PriceImpactExceededError);
  });

  it('should fail when slippage exceeds bound', () => {
    const highSlippage: CostComponentValues = {
      ...validCosts,
      slippageBps: 150, // > 100 bps
    };
    expect(() => validateCostComponents(highSlippage, baseLimits)).toThrow(SlippageExceededError);
  });

  it('should fail when protocol fee breaches limit even if network fee is zero', () => {
    // Total aggregate fee = 0.006 + 0 = 0.006 (might be below an aggregate 0.01 limit)
    // but protocol fee exceeds individual bound of 0.005
    const highProtocolFee: CostComponentValues = {
      ...validCosts,
      protocolFee: '0.0060000',
      networkFee: '0.0000000',
    };
    expect(() => validateCostComponents(highProtocolFee, baseLimits)).toThrow(
      ProtocolFeeExceededError
    );
  });

  it('should fail when solver spread exceeds bound', () => {
    const highSpread: CostComponentValues = {
      ...validCosts,
      solverSpreadBps: 40, // > 25 bps
    };
    expect(() => validateCostComponents(highSpread, baseLimits)).toThrow(SolverSpreadExceededError);
  });

  it('should build accurate user approval surface with absolute and percentage impacts', () => {
    const breakdown = buildApprovalBreakdown(validCosts, baseLimits);

    expect(breakdown.allWithinBounds).toBe(true);
    expect(breakdown.items.priceImpact.percentageDisplay).toBe('0.20%');
    expect(breakdown.items.slippage.percentageDisplay).toBe('0.50%');
    expect(breakdown.items.solverSpread.percentageDisplay).toBe('0.15%');
    expect(breakdown.items.protocolFee.absolute).toBe('0.0030000');
    expect(breakdown.totalFeesAbsolute).toBe('0.00305');
  });
});
