/**
 * NetworkIntelligence - Unified network state and availability signals
 *
 * Wraps HorizonClient, network health checks, and asset caching into one
 * consistent subsystem so SDK consumers never need to manage these concerns
 * separately.
 */

import { HorizonClient } from "../horizonClient";
import { AssetCache, AssetInfo } from "../assetCache";
import { NetworkIdentityVerifier } from "../networkIdentity";
import { ContractCompatibilityRegistry } from "../contractRegistry";
import {
  checkNetworkHealth,
  checkLedgerLatency,
  getProtocolVersion,
  getNetworkStatus,
} from "../networkStatus";
import type {
  NetworkHealth,
  LedgerLatency,
  ProtocolVersion,
  NetworkStatus,
} from "../types";
import {
  NetworkIntelligenceConfig,
  NetworkAvailability,
  NetworkAvailabilityInfo,
  AssetResolutionResult,
  NetworkIntelligenceSnapshot,
} from "./types";

const DEFAULT_NETWORK = "testnet" as const;
const DEFAULT_HORIZON_URLS: Record<string, string> = {
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
};
const DEFAULT_RPC_URLS: Record<string, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://soroban-mainnet.stellar.org",
};

/**
 * Unified network intelligence subsystem.
 *
 * @example
 * ```typescript
 * const ni = new NetworkIntelligence({ network: "testnet" });
 *
 * // Check if the network is operational
 * const availability = await ni.checkAvailability();
 * if (availability.isOperational) {
 *   // Proceed with operations
 * }
 *
 * // Resolve an asset (cached or fresh)
 * const asset = await ni.resolveAsset("USDC", "GA5Z...");
 *
 * // Get a comprehensive status snapshot
 * const snapshot = await ni.snapshot();
 * ```
 */
export class NetworkIntelligence {
  public readonly config: Required<NetworkIntelligenceConfig>;
  public readonly horizon: HorizonClient;
  public readonly assetCache: AssetCache;

  private lastStatus: NetworkStatus | null = null;
  private lastStatusTime: number = 0;
  private readonly statusTtlMs: number = 30_000; // 30 seconds

  constructor(config: NetworkIntelligenceConfig = {}) {
    const network = config.network ?? DEFAULT_NETWORK;
    const horizonUrl = config.horizonUrl ?? DEFAULT_HORIZON_URLS[network];
    const rpcUrl = config.rpcUrl ?? DEFAULT_RPC_URLS[network];

    this.config = {
      network,
      horizonUrl,
      rpcUrl,
      fetchFn: config.fetchFn ?? globalThis.fetch.bind(globalThis),
      timeout: config.timeout ?? 10_000,
      cacheDir: config.cacheDir ?? ".asset-cache",
    };

    this.horizon = new HorizonClient({
      baseUrl: horizonUrl,
      fetchFn: this.config.fetchFn as any,
      timeout: this.config.timeout,
    });

    this.assetCache = new AssetCache(this.config.cacheDir, network);
  }

  /**
   * Verify that every configured service (RPC, Horizon, contract registry)
   * agrees on the network this instance was configured for.
   *
   * Fail-closed: throws {@link NetworkIdentityError} on mismatch or when the
   * identity cannot be confirmed.
   */
  async verifyNetworkIdentity(options?: { forceRefresh?: boolean }): Promise<void> {
    const verifier = new NetworkIdentityVerifier({
      expectedNetwork: this.config.network as "testnet" | "mainnet",
      rpcUrls: [this.config.rpcUrl],
      horizonUrls: [this.config.horizonUrl],
      fetcher: this.config.fetchFn,
      contractRegistryNetworks: () => {
        try {
          return ContractCompatibilityRegistry.registeredNetworks();
        } catch {
          return [];
        }
      },
      assetRegistryNetworks: () =>
        this.assetCache.isNetworkScoped()
          ? this.assetCache.inspectNetworks()
          : [],
    });
    if (options?.forceRefresh) {
      await verifier.verifyBeforeSigning(options);
    } else {
      await verifier.assertVerified(options);
    }
  }

  // ─── Network Health ────────────────────────────────────────────────────────

  /**
   * Check whether the Stellar network is reachable and responding.
   */
  async checkHealth(): Promise<NetworkHealth> {
    return checkNetworkHealth({
      network: this.config.network,
      rpcUrl: this.config.rpcUrl,
      timeout: this.config.timeout,
    });
  }

  /**
   * Check ledger latency (time since last ledger close).
   */
  async checkLatency(): Promise<LedgerLatency> {
    return checkLedgerLatency({
      network: this.config.network,
      rpcUrl: this.config.rpcUrl,
      timeout: this.config.timeout,
    });
  }

  /**
   * Get the current protocol version from Horizon.
   */
  async getProtocolVersion(): Promise<ProtocolVersion> {
    return getProtocolVersion({
      network: this.config.network,
      horizonUrl: this.config.horizonUrl,
      timeout: this.config.timeout,
    });
  }

  /**
   * Get a comprehensive network status (health + latency + protocol).
   *
   * Results are cached for `statusTtlMs` (30s) to avoid hammering the network
   * on repeated calls.
   */
  async getStatus(): Promise<NetworkStatus> {
    const now = Date.now();
    if (this.lastStatus && now - this.lastStatusTime < this.statusTtlMs) {
      return this.lastStatus;
    }

    this.lastStatus = await getNetworkStatus({
      network: this.config.network,
      rpcUrl: this.config.rpcUrl,
      horizonUrl: this.config.horizonUrl,
      timeout: this.config.timeout,
    });
    this.lastStatusTime = now;
    return this.lastStatus;
  }

  /**
   * Assess overall network availability based on health and latency.
   *
   * Returns a human-readable availability level that can be used to decide
   * whether to proceed with operations.
   */
  async checkAvailability(): Promise<NetworkAvailabilityInfo> {
    const now = Date.now();

    try {
      const status = await this.getStatus();

      if (!status.health.isHealthy) {
        return {
          level: NetworkAvailability.UNAVAILABLE,
          isOperational: false,
          summary: `Network unreachable: ${status.health.error ?? "unknown error"}`,
          checkedAt: now,
        };
      }

      if (!status.latency.isNormal) {
        return {
          level: NetworkAvailability.DEGRADED,
          isOperational: true,
          summary: `Network is responding but latency is abnormal (${status.latency.timeSinceLastLedgerSec}s since last ledger)`,
          checkedAt: now,
        };
      }

      if (status.health.responseTimeMs > 5000) {
        return {
          level: NetworkAvailability.DEGRADED,
          isOperational: true,
          summary: `Network is operational but slow (response time: ${status.health.responseTimeMs}ms)`,
          checkedAt: now,
        };
      }

      return {
        level: NetworkAvailability.OPERATIONAL,
        isOperational: true,
        summary: `Network is fully operational (ledger: ${status.health.latestLedger}, protocol: ${status.protocol.version})`,
        checkedAt: now,
      };
    } catch (error) {
      return {
        level: NetworkAvailability.UNAVAILABLE,
        isOperational: false,
        summary: `Failed to check network status: ${error instanceof Error ? error.message : String(error)}`,
        checkedAt: now,
      };
    }
  }

  // ─── Asset Resolution ──────────────────────────────────────────────────────

  /**
   * Resolve an asset by code and issuer, using the cache if available.
   *
   * @param code - Asset code (e.g. "USDC", "XLM" for native)
   * @param issuer - Asset issuer public key (empty string for native)
   */
  async resolveAsset(
    code: string,
    issuer: string = ""
  ): Promise<AssetResolutionResult> {
    const isNative = code === "XLM" || code === "native" || !issuer;

    // Build a minimal StellarSdk.Asset-like object for the cache
    const assetLike = {
      isNative: () => isNative,
      getCode: () => code,
      getIssuer: () => issuer,
    } as any;

    const cached = this.assetCache.get(assetLike);
    if (cached) {
      return {
        code,
        issuer,
        isNative,
        info: cached,
        fromCache: true,
      };
    }

    // Fetch and cache
    const info = await this.assetCache.fetchAndCache(assetLike, this.config.horizonUrl);

    return {
      code,
      issuer,
      isNative,
      info,
      fromCache: false,
    };
  }

  /**
   * Clear the asset cache.
   */
  clearAssetCache(): void {
    this.assetCache.clear();
  }

  // ─── Snapshot ──────────────────────────────────────────────────────────────

  /**
   * Take a snapshot of the current network intelligence state.
   *
   * This is useful for diagnostics, monitoring, or reporting.
   */
  async snapshot(): Promise<NetworkIntelligenceSnapshot> {
    const [status, availability] = await Promise.all([
      this.getStatus().catch(() => null),
      this.checkAvailability(),
    ]);

    return {
      status,
      availability,
      timestamp: Date.now(),
    };
  }
}