import {
  PortfolioSnapshotCoordinator,
  SnapshotSkewExceededError,
  SnapshotInvalidatedError,
  ResourceObservation,
} from '../../src/domain/execution/portfolioSnapshot';

describe('Issue #754: Consistent Multi-Resource Snapshots for Portfolio Decisions', () => {
  const baseLedger = 50000000;
  const baseTime = 1700000000;

  it('should successfully bind compatible observations within allowed skew', () => {
    const coordinator = new PortfolioSnapshotCoordinator({
      baseLedgerSequence: baseLedger,
      baseTimestamp: baseTime,
      maxSkewLedgers: 2,
      maxSkewSeconds: 10,
    });

    const balanceObs: ResourceObservation = {
      kind: 'balance',
      resourceId: 'GBEMI...XLM',
      ledgerSequence: baseLedger + 1, // skew = 1, <= 2
      observedAt: baseTime + 2,
      data: { amount: '1000' },
    };

    const priceObs: ResourceObservation = {
      kind: 'price',
      resourceId: 'XLM:USDC',
      ledgerSequence: baseLedger, // skew = 0
      observedAt: baseTime,
      data: { price: '0.12' },
    };

    expect(() => coordinator.bindObservation(balanceObs)).not.toThrow();
    expect(() => coordinator.bindObservation(priceObs)).not.toThrow();

    const decisionContext = coordinator.getDecisionContext();
    expect(decisionContext.provenance.resourceCount).toBe(2);
    expect(decisionContext.provenance.baseLedgerSequence).toBe(baseLedger);
    expect(decisionContext.provenance.resources[0].skewLedgers).toBe(1);
  });

  it('should reject observations outside permitted ledger skew window', () => {
    const coordinator = new PortfolioSnapshotCoordinator({
      baseLedgerSequence: baseLedger,
      baseTimestamp: baseTime,
      maxSkewLedgers: 2,
    });

    const staleObservation: ResourceObservation = {
      kind: 'liability',
      resourceId: 'margin-debt',
      ledgerSequence: baseLedger - 5, // skew = 5 > 2
      observedAt: baseTime,
      data: { debt: '500' },
    };

    expect(() => coordinator.bindObservation(staleObservation)).toThrow(SnapshotSkewExceededError);
  });

  it('should invalidate dependent quotes and approvals on snapshot refresh', () => {
    const coordinator = new PortfolioSnapshotCoordinator({
      baseLedgerSequence: baseLedger,
      baseTimestamp: baseTime,
    });

    coordinator.registerDependentQuote('quote-123');
    coordinator.registerDependentQuote('quote-456');
    coordinator.registerDependentApproval('approval-789');

    const result = coordinator.invalidate();

    expect(result.invalidatedQuotes).toEqual(['quote-123', 'quote-456']);
    expect(result.invalidatedApprovals).toEqual(['approval-789']);

    // Subsequent access must throw SnapshotInvalidatedError
    expect(() => coordinator.getDecisionContext()).toThrow(SnapshotInvalidatedError);
  });
});
