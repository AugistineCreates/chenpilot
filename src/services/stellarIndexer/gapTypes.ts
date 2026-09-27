/**
 * Types and interfaces for ledger ingestion gap detection, page completeness,
 * and quarantine management (Issue #750).
 */

export type GapStatus = "QUARANTINED" | "REPLAYING" | "RESOLVED" | "FAILED";

/**
 * Proof of complete and contiguous ledger ingestion.
 * Must be verified and committed atomically with indexer cursor advancement.
 */
export interface CompletenessEvidence {
  streamId: string;
  startLedger: number;
  endLedger: number;
  totalEventsCount: number;
  /** Whether the event page was fully consumed without pagination truncation */
  isPageComplete: boolean;
  /** Whether the ledger boundary was reached (all events for endLedger ingested) */
  expectedBoundaryReached: boolean;
  /** List of contiguous ledger sequence numbers verified */
  observedLedgers: number[];
  /** Cryptographic or deterministic checksum verifying evidence integrity */
  evidenceHash: string;
  committedAt: string;
}

/**
 * Quarantined ingestion gap representing missing ledgers or incomplete pages.
 */
export interface QuarantinedGap {
  gapId: string;
  streamId: string;
  fromLedger: number;
  toLedger: number;
  status: GapStatus;
  missingLedgersCount: number;
  detectedAt: string;
  resolvedAt?: string;
  failureReason?: string;
  providerId?: string;
  retryCount: number;
}

/**
 * Result of a continuity analysis between cursor and incoming batch.
 */
export interface ContinuityAnalysisResult {
  isContiguous: boolean;
  expectedNextLedger: number;
  actualFirstLedger: number;
  actualLastLedger: number;
  missingGaps: { fromLedger: number; toLedger: number }[];
  isPageTruncated: boolean;
  reason?: string;
}

/**
 * Error thrown when cursor advancement is attempted across a discontinuity.
 */
export class LedgerDiscontinuityError extends Error {
  constructor(
    public readonly streamId: string,
    public readonly expectedLedger: number,
    public readonly receivedLedger: number,
    message?: string
  ) {
    super(
      message ||
        `Ledger discontinuity in stream '${streamId}': expected contiguous ledger ${expectedLedger}, received ${receivedLedger}`
    );
    this.name = "LedgerDiscontinuityError";
  }
}

/**
 * Error thrown when cursor advancement is attempted on an incomplete event page.
 */
export class PageTruncationError extends Error {
  constructor(
    public readonly streamId: string,
    public readonly ledger: number,
    message?: string
  ) {
    super(
      message ||
        `Incomplete event page in stream '${streamId}' for ledger ${ledger}: page was truncated before boundary was reached`
    );
    this.name = "PageTruncationError";
  }
}

/**
 * Error thrown when reconciliation is attempted against a gapped indexer stream.
 */
export class ReconciliationBlockedByGapError extends Error {
  constructor(
    public readonly streamId: string,
    public readonly targetLedger: number,
    public readonly blockingGaps: QuarantinedGap[],
    message?: string
  ) {
    super(
      message ||
        `Reconciliation blocked on stream '${streamId}' for ledger ${targetLedger}: ${blockingGaps.length} active quarantined gap(s) detected (${blockingGaps
          .map((g) => `[${g.fromLedger}-${g.toLedger}]`)
          .join(", ")})`
    );
    this.name = "ReconciliationBlockedByGapError";
  }
}
