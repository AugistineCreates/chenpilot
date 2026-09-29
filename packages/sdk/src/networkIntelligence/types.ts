/**
 * Types for the Network Intelligence subsystem
 *
 * Unifies Horizon access, network health checks, and asset/network caching
 * into a single consistent source of network state and availability signals.
 */

import type { AssetInfo } from "../assetCache";
import type {
  NetworkHealth,
  LedgerLatency,
  ProtocolVersion,
  NetworkStatus,
} from "../types";

export { AssetInfo } from "../assetCache";
export type {
  NetworkHealth,
  LedgerLatency,
  ProtocolVersion,
  NetworkStatus,
} from "../types";

/** Configuration for the NetworkIntelligence subsystem */
export interface NetworkIntelligenceConfig {
  /** Network to connect to ("testnet" | "mainnet") */
  network?: "testnet" | "mainnet";
  /** Horizon URL override */
  horizonUrl?: string;
  /** Soroban RPC URL override */
  rpcUrl?: string;
  /** Custom fetch function (for testing or proxy) */
  fetchFn?: typeof fetch;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Cache directory for persistent asset cache */
  cacheDir?: string;
}

/** Network availability level */
export enum NetworkAvailability {
  /** Network is fully operational */
  OPERATIONAL = "operational",
  /** Network is experiencing degraded performance */
  DEGRADED = "degraded",
  /** Network is experiencing a partial outage */
  PARTIAL_OUTAGE = "partial_outage",
  /** Network is unreachable */
  UNAVAILABLE = "unavailable",
}

/** Detailed network availability information */
export interface NetworkAvailabilityInfo {
  /** Overall availability level */
  level: NetworkAvailability;
  /** Whether the network is considered healthy enough for operations */
  isOperational: boolean;
  /** Human-readable summary */
  summary: string;
  /** Timestamp of the check */
  checkedAt: number;
}

/** Result of an asset resolution operation */
export interface AssetResolutionResult {
  /** Asset code */
  code: string;
  /** Asset issuer (empty for native assets) */
  issuer: string;
  /** Whether the asset is native XLM */
  isNative: boolean;
  /** Resolved asset info, if available */
  info: AssetInfo | null;
  /** Whether the asset was found in the cache */
  fromCache: boolean;
}

/** Snapshot of the current network intelligence state */
export interface NetworkIntelligenceSnapshot {
  /** Network status at the time of the snapshot */
  status: NetworkStatus | null;
  /** Network availability assessment */
  availability: NetworkAvailabilityInfo;
  /** Timestamp of the snapshot */
  timestamp: number;
}