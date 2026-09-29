/**
 * Quorum Read Types
 *
 * Defines the interfaces for provider quorum reads that require
 * consensus across multiple independent providers before accepting
 * security-critical chain state.
 */

/** Supported chain state categories that require quorum reads */
export type ChainStateCategory =
  | "balance"
  | "sequence_number"
  | "contract_state"
  | "transaction_status";

/** A single provider's response for a quorum read */
export interface ProviderResponse<T> {
  /** Unique provider identifier (e.g., "horizon-primary", "soroban-rpc-2") */
  providerId: string;
  /** The response value, or null if the provider failed */
  value: T | null;
  /** Error message if the provider failed */
  error?: string;
  /** Timestamp of the response */
  timestamp: number;
  /** Response latency in milliseconds */
  latencyMs: number;
}

/** Result of a quorum read */
export interface QuorumReadResult<T> {
  /** Whether quorum was achieved */
  quorumAchieved: boolean;
  /** The accepted value (null if quorum failed) */
  value: T | null;
  /** Number of providers that returned this value */
  agreementCount: number;
  /** Total number of providers queried */
  totalProviders: number;
  /** All provider responses */
  responses: ProviderResponse<T>[];
  /** Error message if quorum failed */
  error?: string;
  /** Whether the operation was rejected due to divergence */
  rejected: boolean;
}

/** Provider configuration */
export interface ProviderConfig {
  /** Unique provider identifier */
  id: string;
  /** Provider URL */
  url: string;
  /** Provider type */
  type: "horizon" | "soroban_rpc";
  /** Whether this provider is independent (not run by the same entity) */
  independent: boolean;
  /** Maximum acceptable response latency in ms */
  maxLatencyMs?: number;
}

/** Quorum read configuration */
export interface QuorumReadConfig {
  /** Minimum number of providers that must agree (default: 2) */
  minQuorumSize: number;
  /** Total number of providers to query (must be >= minQuorumSize) */
  totalProviders: number;
  /** Timeout for individual provider requests in ms */
  providerTimeoutMs: number;
  /** Maximum acceptable age of response in ms (staleness threshold) */
  maxResponseAgeMs: number;
  /** Whether to fail closed on divergence (default: true for mutating ops) */
  failClosedOnDivergence: boolean;
  /** Categories that require quorum reads */
  protectedCategories: ChainStateCategory[];
}

/** Provider health status */
export interface ProviderHealth {
  /** Provider identifier */
  providerId: string;
  /** Whether the provider is currently healthy */
  healthy: boolean;
  /** Health score (0-1, higher is better) */
  score: number;
  /** Number of consecutive failures */
  consecutiveFailures: number;
  /** Total requests made */
  totalRequests: number;
  /** Total failures */
  totalFailures: number;
  /** Average response latency in ms */
  avgLatencyMs: number;
  /** Last successful request timestamp */
  lastSuccessAt?: number;
  /** Last failure timestamp */
  lastFailureAt?: number;
}

/** Quorum read error types */
export enum QuorumReadError {
  /** Not enough providers responded */
  INSUFFICIENT_PROVIDERS = "INSUFFICIENT_PROVIDERS",
  /** Providers returned divergent responses */
  DIVERGENT_RESPONSES = "DIVERGENT_RESPONSES",
  /** All providers failed */
  ALL_PROVIDERS_FAILED = "ALL_PROVIDERS_FAILED",
  /** Response exceeded staleness threshold */
  STALE_RESPONSE = "STALE_RESPONSE",
  /** Response exceeded latency threshold */
  HIGH_LATENCY = "HIGH_LATENCY",
  /** Operation rejected due to fail-closed policy */
  FAIL_CLOSED = "FAIL_CLOSED",
}

/** Quorum read exception */
export class QuorumReadException extends Error {
  constructor(
    public readonly code: QuorumReadError,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "QuorumReadException";
  }
}
