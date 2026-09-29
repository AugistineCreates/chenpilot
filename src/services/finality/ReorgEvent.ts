/**
 * Structured event emitted when reorg-aware state transitions occur.
 * Used for operator notifications, logging, and monitoring.
 */
export interface ReorgEvent {
  eventType:
    | "finality_declared"
    | "orphan_detected"
    | "reconciliation_updated"
    | "reconciliation_failed"
    | "conflicting_providers"
    | "stale_horizon"
    | "reconciliation_provider_unavailable";

  transactionId: string;
  transactionHash: string;
  network: string;
  timestamp: string; // ISO 8601

  previousStatus: string;
  newStatus: string;

  details: {
    ledgerSequence?: number;
    ledgerHash?: string;
    confirmationDepth?: number;
    reorgDepth?: number;
    primaryProvider?: string;
    reconciliationProvider?: string;
    primaryResult?: string;
    reconciliationResult?: string;
    ancestryVerified?: boolean;
    error?: string;
    [key: string]: unknown;
  };
}

export type ReorgEventType = ReorgEvent["eventType"];
