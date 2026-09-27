/**
 * Consistent Multi-Resource Snapshots for Portfolio Decisions
 *
 * Implements Issue #754:
 * Binds balances, prices, liabilities, and protocol positions read across
 * providers/ledgers to a unified snapshot token. Rejects inputs exceeding
 * permitted skew windows and propagates invalidations to dependent quotes & approvals.
 */

import * as crypto from 'crypto';

export type ResourceKind = 'balance' | 'price' | 'liability' | 'protocol_position';

export interface ResourceObservation<T = unknown> {
  kind: ResourceKind;
  resourceId: string;
  ledgerSequence: number;
  observedAt: number; // Unix timestamp in seconds
  data: T;
}

export interface SnapshotProvenance {
  snapshotTokenId: string;
  baseLedgerSequence: number;
  baseTimestamp: number;
  maxSkewLedgers: number;
  maxSkewSeconds: number;
  resourceCount: number;
  resources: {
    kind: ResourceKind;
    resourceId: string;
    ledgerSequence: number;
    skewLedgers: number;
    observedAt: number;
    skewSeconds: number;
  }[];
}

export interface PortfolioDecisionContext {
  provenance: SnapshotProvenance;
  observations: Map<string, ResourceObservation>;
}

export class SnapshotSkewExceededError extends Error {
  constructor(
    public readonly resourceId: string,
    public readonly resourceLedger: number,
    public readonly baseLedger: number,
    public readonly maxSkewLedgers: number
  ) {
    super(
      `Resource skew exceeded for ${resourceId}: observed at ledger ${resourceLedger}, base is ${baseLedger} (max skew allowed: ${maxSkewLedgers} ledgers)`
    );
    this.name = 'SnapshotSkewExceededError';
  }
}

export class SnapshotInvalidatedError extends Error {
  constructor(public readonly tokenId: string) {
    super(`Snapshot token ${tokenId} has been invalidated due to refresh or ledger advancement.`);
    this.name = 'SnapshotInvalidatedError';
  }
}

export class PortfolioSnapshotCoordinator {
  public readonly id: string;
  public readonly baseLedgerSequence: number;
  public readonly baseTimestamp: number;
  public readonly maxSkewLedgers: number;
  public readonly maxSkewSeconds: number;

  private isInvalidated = false;
  private observations: Map<string, ResourceObservation> = new Map();
  private dependentQuoteIds: Set<string> = new Set();
  private dependentApprovalIds: Set<string> = new Set();

  constructor(options: {
    baseLedgerSequence: number;
    baseTimestamp: number;
    maxSkewLedgers?: number;
    maxSkewSeconds?: number;
  }) {
    this.id = crypto.randomUUID();
    this.baseLedgerSequence = options.baseLedgerSequence;
    this.baseTimestamp = options.baseTimestamp;
    this.maxSkewLedgers = options.maxSkewLedgers ?? 2;
    this.maxSkewSeconds = options.maxSkewSeconds ?? 10;
  }

  /**
   * Bind an observation to this snapshot token, verifying skew bounds.
   */
  public bindObservation(observation: ResourceObservation): void {
    if (this.isInvalidated) {
      throw new SnapshotInvalidatedError(this.id);
    }

    const ledgerDiff = Math.abs(observation.ledgerSequence - this.baseLedgerSequence);
    if (ledgerDiff > this.maxSkewLedgers) {
      throw new SnapshotSkewExceededError(
        observation.resourceId,
        observation.ledgerSequence,
        this.baseLedgerSequence,
        this.maxSkewLedgers
      );
    }

    const timeDiff = Math.abs(observation.observedAt - this.baseTimestamp);
    if (timeDiff > this.maxSkewSeconds) {
      throw new Error(
        `Time skew exceeded for ${observation.resourceId}: observedAt=${observation.observedAt} vs baseTimestamp=${this.baseTimestamp} (max skew allowed: ${this.maxSkewSeconds}s)`
      );
    }

    const key = `${observation.kind}:${observation.resourceId}`;
    this.observations.set(key, observation);
  }

  /**
   * Register quotes and approvals dependent on this snapshot
   */
  public registerDependentQuote(quoteId: string): void {
    if (this.isInvalidated) throw new SnapshotInvalidatedError(this.id);
    this.dependentQuoteIds.add(quoteId);
  }

  public registerDependentApproval(approvalId: string): void {
    if (this.isInvalidated) throw new SnapshotInvalidatedError(this.id);
    this.dependentApprovalIds.add(approvalId);
  }

  /**
   * Invalidate this snapshot token upon refresh or ledger advance.
   * Returns dependent quotes and approvals that must be revoked.
   */
  public invalidate(): { invalidatedQuotes: string[]; invalidatedApprovals: string[] } {
    this.isInvalidated = true;
    const quotes = Array.from(this.dependentQuoteIds);
    const approvals = Array.from(this.dependentApprovalIds);
    this.dependentQuoteIds.clear();
    this.dependentApprovalIds.clear();

    return {
      invalidatedQuotes: quotes,
      invalidatedApprovals: approvals,
    };
  }

  public getDecisionContext(): PortfolioDecisionContext {
    if (this.isInvalidated) {
      throw new SnapshotInvalidatedError(this.id);
    }

    const resourceProvenance = Array.from(this.observations.values()).map((obs) => ({
      kind: obs.kind,
      resourceId: obs.resourceId,
      ledgerSequence: obs.ledgerSequence,
      skewLedgers: obs.ledgerSequence - this.baseLedgerSequence,
      observedAt: obs.observedAt,
      skewSeconds: obs.observedAt - this.baseTimestamp,
    }));

    const provenance: SnapshotProvenance = {
      snapshotTokenId: this.id,
      baseLedgerSequence: this.baseLedgerSequence,
      baseTimestamp: this.baseTimestamp,
      maxSkewLedgers: this.maxSkewLedgers,
      maxSkewSeconds: this.maxSkewSeconds,
      resourceCount: resourceProvenance.length,
      resources: resourceProvenance,
    };

    return {
      provenance,
      observations: new Map(this.observations),
    };
  }
}
