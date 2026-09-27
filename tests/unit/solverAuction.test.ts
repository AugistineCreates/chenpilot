import {
  SolverAuctionManager,
  SolverEligibility,
  AuctionParams,
  BidReveal,
} from '../../src/domain/execution/solverAuction';

describe('Issue #755: Solver Auction with Sealed Commitments & Deterministic Settlement', () => {
  const eligibility = new Map<string, SolverEligibility>([
    ['solver-1', { solverId: 'solver-1', isActive: true, lockedCollateral: '1000.0000000', slashCount: 0 }],
    ['solver-2', { solverId: 'solver-2', isActive: true, lockedCollateral: '1000.0000000', slashCount: 0 }],
    ['solver-3', { solverId: 'solver-3', isActive: true, lockedCollateral: '1000.0000000', slashCount: 0 }],
    ['solver-inactive', { solverId: 'solver-inactive', isActive: false, lockedCollateral: '1000.0000000', slashCount: 0 }],
  ]);

  const params: AuctionParams = {
    auctionId: 'auction-xyz-100',
    sourceAsset: 'XLM',
    destinationAsset: 'USDC',
    sourceAmount: '100.0000000',
    minCollateralRequired: '100.0000000',
    commitDeadline: 1000,
    revealDeadline: 1050,
  };

  it('should prevent bids from being changed after commitment', () => {
    const auction = new SolverAuctionManager(params, eligibility);
    const hash = SolverAuctionManager.hashBid(params.auctionId, 'solver-1', '98.5000000', 'salt-1');

    auction.commitBid('solver-1', hash, 500);

    expect(() => {
      auction.commitBid('solver-1', 'different-hash', 600);
    }).toThrow(/Bid already committed/);
  });

  it('should reject commitments from inactive solvers', () => {
    const auction = new SolverAuctionManager(params, eligibility);
    const hash = SolverAuctionManager.hashBid(params.auctionId, 'solver-inactive', '98.5000000', 'salt');

    expect(() => {
      auction.commitBid('solver-inactive', hash, 500);
    }).toThrow(/not active or eligible/);
  });

  it('should select winner with best output and penalize non-revealed commitments', () => {
    const auction = new SolverAuctionManager(params, eligibility);

    // Commitments
    const hash1 = SolverAuctionManager.hashBid(params.auctionId, 'solver-1', '95.0000000', 'salt-1');
    const hash2 = SolverAuctionManager.hashBid(params.auctionId, 'solver-2', '99.5000000', 'salt-2');
    const hash3 = SolverAuctionManager.hashBid(params.auctionId, 'solver-3', '97.0000000', 'salt-3');

    auction.commitBid('solver-1', hash1, 500);
    auction.commitBid('solver-2', hash2, 500);
    auction.commitBid('solver-3', hash3, 500);

    // Reveals: solver-1 and solver-2 reveal, solver-3 does not reveal
    auction.revealBid(
      {
        solverId: 'solver-1',
        destinationAmount: '95.0000000',
        route: ['XLM', 'USDC'],
        salt: 'salt-1',
        revealedAt: 1010,
      },
      1010
    );

    auction.revealBid(
      {
        solverId: 'solver-2',
        destinationAmount: '99.5000000',
        route: ['XLM', 'USDC'],
        salt: 'salt-2',
        revealedAt: 1020,
      },
      1020
    );

    const result = auction.resolveAuction();

    expect(result.winnerSolverId).toBe('solver-2');
    expect(result.winningAmount).toBe('99.5000000');
    expect(result.penalizedSolvers).toHaveLength(1);
    expect(result.penalizedSolvers[0].solverId).toBe('solver-3');
    expect(result.penalizedSolvers[0].reason).toBe('NON_REVEAL_PENALTY');
  });

  it('should perform deterministic replay of the auction', () => {
    const hash1 = SolverAuctionManager.hashBid(params.auctionId, 'solver-1', '95.0000000', 'salt-1');
    const hash2 = SolverAuctionManager.hashBid(params.auctionId, 'solver-2', '99.5000000', 'salt-2');

    const commitments = [
      { solverId: 'solver-1', commitmentHash: hash1, committedAt: 500, collateralLocked: '100.0000000' },
      { solverId: 'solver-2', commitmentHash: hash2, committedAt: 510, collateralLocked: '100.0000000' },
    ];

    const reveals: BidReveal[] = [
      { solverId: 'solver-1', destinationAmount: '95.0000000', route: ['XLM', 'USDC'], salt: 'salt-1', revealedAt: 1010 },
      { solverId: 'solver-2', destinationAmount: '99.5000000', route: ['XLM', 'USDC'], salt: 'salt-2', revealedAt: 1020 },
    ];

    const replay1 = SolverAuctionManager.replayAuction(params, eligibility, commitments, reveals);
    const replay2 = SolverAuctionManager.replayAuction(params, eligibility, commitments, reveals);

    expect(replay1.winnerSolverId).toBe('solver-2');
    expect(replay1.winnerSolverId).toBe(replay2.winnerSolverId);
  });
});
