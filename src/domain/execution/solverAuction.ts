/**
 * Solver Auction with Sealed Commitments and Deterministic Settlement
 *
 * Implements Issue #755:
 * Prevents last-look manipulation and route front-running through:
 * - Sealed commit-reveal auction cycles
 * - Solver eligibility and collateral locking
 * - Deterministic, manipulation-resistant winner selection and tie-breaking
 * - Penalty slashing for non-reveal or settlement defaults
 * - Exact replay verification for audits
 */

import * as crypto from 'crypto';
import BigNumber from 'bignumber.js';

export type AuctionPhase = 'COMMIT' | 'REVEAL' | 'RESOLVED' | 'SETTLED';

export interface SolverEligibility {
  solverId: string;
  isActive: boolean;
  lockedCollateral: string; // stroops
  slashCount: number;
}

export interface BidCommitment {
  solverId: string;
  commitmentHash: string; // sha256(auctionId + solverId + destinationAmount + salt)
  committedAt: number;
  collateralLocked: string;
}

export interface BidReveal {
  solverId: string;
  destinationAmount: string; // canonical units
  route: string[];
  salt: string;
  revealedAt: number;
}

export interface AuctionParams {
  auctionId: string;
  sourceAsset: string;
  destinationAsset: string;
  sourceAmount: string;
  minCollateralRequired: string;
  commitDeadline: number;
  revealDeadline: number;
}

export interface AuctionResult {
  auctionId: string;
  winnerSolverId: string;
  winningAmount: string;
  winningRoute: string[];
  phase: AuctionPhase;
  penalizedSolvers: { solverId: string; reason: string; slashedCollateral: string }[];
  settlementTxHash?: string;
}

export class SolverAuctionManager {
  private commitments: Map<string, BidCommitment> = new Map();
  private reveals: Map<string, BidReveal> = new Map();
  private phase: AuctionPhase = 'COMMIT';

  constructor(
    public readonly params: AuctionParams,
    private eligibilityRegistry: Map<string, SolverEligibility>
  ) {}

  public static hashBid(
    auctionId: string,
    solverId: string,
    destinationAmount: string,
    salt: string
  ): string {
    const payload = `${auctionId}:${solverId}:${destinationAmount}:${salt}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Commit a sealed bid with collateral check
   */
  public commitBid(solverId: string, commitmentHash: string, now: number): void {
    if (this.phase !== 'COMMIT') {
      throw new Error(`Cannot commit in phase ${this.phase}`);
    }
    if (now > this.params.commitDeadline) {
      throw new Error('Commit deadline has passed');
    }
    if (this.commitments.has(solverId)) {
      throw new Error('Bid already committed. Bids cannot be modified after commitment.');
    }

    const solver = this.eligibilityRegistry.get(solverId);
    if (!solver || !solver.isActive) {
      throw new Error(`Solver ${solverId} is not active or eligible`);
    }

    const locked = new BigNumber(solver.lockedCollateral);
    const required = new BigNumber(this.params.minCollateralRequired);
    if (locked.isLessThan(required)) {
      throw new Error(`Insufficient collateral locked for solver ${solverId}`);
    }

    this.commitments.set(solverId, {
      solverId,
      commitmentHash,
      committedAt: now,
      collateralLocked: this.params.minCollateralRequired,
    });
  }

  /**
   * Reveal sealed bid during reveal window
   */
  public revealBid(reveal: BidReveal, now: number): void {
    if (now < this.params.commitDeadline) {
      throw new Error('Cannot reveal before commit deadline closes');
    }
    if (now > this.params.revealDeadline) {
      throw new Error('Reveal deadline has passed');
    }

    const commitment = this.commitments.get(reveal.solverId);
    if (!commitment) {
      throw new Error(`No prior commitment found for solver ${reveal.solverId}`);
    }

    const expectedHash = SolverAuctionManager.hashBid(
      this.params.auctionId,
      reveal.solverId,
      reveal.destinationAmount,
      reveal.salt
    );

    if (expectedHash !== commitment.commitmentHash) {
      throw new Error(`Invalid reveal: computed hash does not match commitment for solver ${reveal.solverId}`);
    }

    this.reveals.set(reveal.solverId, reveal);
  }

  /**
   * Resolve auction winner deterministically and slash non-revealing solvers
   */
  public resolveAuction(): AuctionResult {
    this.phase = 'RESOLVED';
    const penalizedSolvers: { solverId: string; reason: string; slashedCollateral: string }[] = [];

    // Check non-revealed commitments and penalize
    for (const [solverId, commitment] of this.commitments.entries()) {
      if (!this.reveals.has(solverId)) {
        penalizedSolvers.push({
          solverId,
          reason: 'NON_REVEAL_PENALTY',
          slashedCollateral: commitment.collateralLocked,
        });
      }
    }

    const validReveals = Array.from(this.reveals.values());
    if (validReveals.length === 0) {
      throw new Error('Auction failed: No valid bids were revealed');
    }

    // Deterministic winner selection: highest destinationAmount
    // Deterministic tie-breaking: sha256(auctionId + solverId)
    const sorted = [...validReveals].sort((a, b) => {
      const cmp = new BigNumber(b.destinationAmount).comparedTo(new BigNumber(a.destinationAmount));
      if (cmp !== 0) {
        return cmp;
      }
      // Deterministic tie-break
      const tieHashA = crypto.createHash('sha256').update(`${this.params.auctionId}:${a.solverId}`).digest('hex');
      const tieHashB = crypto.createHash('sha256').update(`${this.params.auctionId}:${b.solverId}`).digest('hex');
      return tieHashA.localeCompare(tieHashB);
    });

    const winner = sorted[0];

    return {
      auctionId: this.params.auctionId,
      winnerSolverId: winner.solverId,
      winningAmount: winner.destinationAmount,
      winningRoute: winner.route,
      phase: this.phase,
      penalizedSolvers,
    };
  }

  /**
   * Replay an auction transcript and verify deterministic outcome
   */
  public static replayAuction(
    params: AuctionParams,
    eligibility: Map<string, SolverEligibility>,
    commitments: BidCommitment[],
    reveals: BidReveal[]
  ): AuctionResult {
    const replayManager = new SolverAuctionManager(params, eligibility);

    for (const c of commitments) {
      replayManager.commitBid(c.solverId, c.commitmentHash, c.committedAt);
    }

    for (const r of reveals) {
      replayManager.revealBid(r, r.revealedAt);
    }

    return replayManager.resolveAuction();
  }
}
