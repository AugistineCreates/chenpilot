/**
 * Network Status API for Stellar/Soroban
 *
 * Provides simple health checks, ledger latency, and protocol version information.
 */

import type {
  NetworkStatusConfig,
  NetworkHealth,
  LedgerLatency,
  ProtocolVersion,
  NetworkStatus,
} from "./types";

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_RPC_URLS: Record<string, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://soroban-mainnet.stellar.org",
};

const DEFAULT_HORIZON_URLS: Record<string, string> = {
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
};

const EXPECTED_LEDGER_TIME_SEC = 5; // Stellar ledgers close ~every 5 seconds
const LATENCY_THRESHOLD_SEC = 15; // Consider abnormal if > 15 seconds

// ─── Implementation ─────────────────────────────────────────────────────────

/**
 * Check the health of the Stellar network.
 *
 * @param config - Network configuration
 * @returns Network health information
 *
 * @example
 * ```typescript
 * const health = await checkNetworkHealth({ network: "testnet" });
 * if (health.isHealthy) {
 *   console.log(`Network is healthy. Latest ledger: ${health.latestLedger}`);
 * }
 * ```
 */
export async function checkNetworkHealth(
  config: NetworkStatusConfig
): Promise<NetworkHealth> {
  const rpcUrl = config.rpcUrl || DEFAULT_RPC_URLS[config.network];
  const startTime = Date.now();

  try {
    const signal = config.timeout
      ? AbortSignal.timeout(config.timeout)
      : undefined;
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getLatestLedger",
        params: [],
      }),
      signal,
    });

    const responseTimeMs = Date.now() - startTime;

    if (!response.ok) {
      return {
        isHealthy: false,
        responseTimeMs,
        latestLedger: 0,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = (await response.json()) as {
      error?: { message?: string };
      result?: { sequence?: number };
    };

    if (data.error) {
      return {
        isHealthy: false,
        responseTimeMs,
        latestLedger: 0,
        error: data.error.message || "RPC error",
      };
    }

    return {
      isHealthy: true,
      responseTimeMs,
      latestLedger: data.result?.sequence || 0,
    };
  } catch (error) {
    return {
      isHealthy: false,
      responseTimeMs: Date.now() - startTime,
      latestLedger: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check the ledger latency of the Stellar network.
 *
 * @param config - Network configuration
 * @returns Ledger latency information
 *
 * @example
 * ```typescript
 * const latency = await checkLedgerLatency({ network: "testnet" });
 * console.log(`Time since last ledger: ${latency.timeSinceLastLedgerSec}s`);
 * console.log(`Latency is ${latency.isNormal ? "normal" : "abnormal"}`);
 * ```
 */
export async function checkLedgerLatency(
  config: NetworkStatusConfig
): Promise<LedgerLatency> {
  const rpcUrl = config.rpcUrl || DEFAULT_RPC_URLS[config.network];

  const signal = config.timeout
    ? AbortSignal.timeout(config.timeout)
    : undefined;
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getLatestLedger",
      params: [],
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ledger: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    error?: { message?: string };
    result?: {
      sequence?: number;
      protocolVersion?: number;
      closeTime?: number;
    };
  };

  if (data.error) {
    throw new Error(data.error.message || "RPC error");
  }

  const currentLedger = data.result?.sequence || 0;

  // Get ledger close time from the result
  // The RPC returns timestamps in Unix seconds
  const ledgerCloseTime = data.result?.closeTime || 0;
  const currentTime = Math.floor(Date.now() / 1000);
  const timeSinceLastLedger = currentTime - ledgerCloseTime;

  return {
    currentLedger,
    timeSinceLastLedgerSec: timeSinceLastLedger,
    averageLedgerTimeSec: EXPECTED_LEDGER_TIME_SEC,
    isNormal: timeSinceLastLedger <= LATENCY_THRESHOLD_SEC,
  };
}

/**
 * Get the protocol version of the Stellar network.
 *
 * @param config - Network configuration
 * @returns Protocol version information
 *
 * @example
 * ```typescript
 * const protocol = await getProtocolVersion({ network: "mainnet" });
 * console.log(`Protocol version: ${protocol.version}`);
 * console.log(`Core version: ${protocol.coreVersion}`);
 * ```
 */
export async function getProtocolVersion(
  config: NetworkStatusConfig
): Promise<ProtocolVersion> {
  const horizonUrl = config.horizonUrl || DEFAULT_HORIZON_URLS[config.network];

  const signal = config.timeout
    ? AbortSignal.timeout(config.timeout)
    : undefined;
  const response = await fetch(`${horizonUrl}/`, { signal });

  if (!response.ok) {
    throw new Error(`Failed to fetch protocol version: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    current_protocol_version?: number;
    core_version?: string;
    network_passphrase?: string;
  };

  return {
    version: data.current_protocol_version || 0,
    coreVersion: data.core_version || "unknown",
    networkPassphrase: data.network_passphrase || "unknown",
  };
}

/**
 * Get comprehensive network status including health, latency, and protocol version.
 *
 * @param config - Network configuration
 * @returns Complete network status
 *
 * @example
 * ```typescript
 * const status = await getNetworkStatus({ network: "testnet" });
 *
 * console.log("Network Health:", status.health.isHealthy);
 * console.log("Latest Ledger:", status.health.latestLedger);
 * console.log("Response Time:", status.health.responseTimeMs, "ms");
 * console.log("Ledger Latency:", status.latency.timeSinceLastLedgerSec, "s");
 * console.log("Protocol Version:", status.protocol.version);
 * ```
 */
export async function getNetworkStatus(
  config: NetworkStatusConfig
): Promise<NetworkStatus> {
  const [health, latency, protocol] = await Promise.all([
    checkNetworkHealth(config),
    checkLedgerLatency(config),
    getProtocolVersion(config),
  ]);

  return {
    health,
    latency,
    protocol,
    checkedAt: Date.now(),
  };
}
