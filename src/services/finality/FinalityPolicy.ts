/**
 * Finality policy configuration for reorg-aware confirmation.
 * Determines how deep confirmation must be and how to reconcile between providers.
 */
export interface FinalityPolicy {
  network: "mainnet" | "testnet" | "futurenet";

  /**
   * How many ledgers must close on top of the observed ledger before finality
   * is declared. Stellar closes ~1 ledger per 5 seconds.
   * Recommended: mainnet=3, testnet=2, futurenet=1
   */
  confirmationDepthRequired: number;

  /**
   * How often to poll for new ledger closes during CONFIRMING state (ms).
   * Recommended: mainnet=5000, testnet=2000, futurenet=1000
   */
  confirmationPollIntervalMs: number;

  /**
   * Max time to wait for confirmationDepthRequired before marking STALE (ms).
   * Recommended: mainnet=600000 (10 min), testnet=300000 (5 min), futurenet=120000 (2 min)
   */
  confirmationTimeoutMs: number;

  /**
   * Primary Horizon endpoint — used for submission and confirmation polling.
   * Must be a working Horizon URL.
   */
  primaryHorizonUrl: string;

  /**
   * Reconciliation Horizon endpoint — used ONLY for cross-check after orphan/STALE.
   * MUST be genuinely independent (different operator) from primary for reconciliation
   * to be meaningful. Set to primary URL only in test environments.
   */
  reconciliationHorizonUrl: string;

  /**
   * How many ledgers back to check for ancestry during orphan detection.
   * Recommended: mainnet=10, testnet=5, futurenet=3
   */
  ancestryCheckDepth: number;

  /**
   * Max number of reconciliation attempts before giving up and emitting
   * reconciliation_provider_unavailable event. Recommended: 3-5
   */
  maxReconciliationAttempts: number;

  /**
   * Delay between reconciliation retries (ms).
   * Recommended: 2000-5000
   */
  reconciliationRetryDelayMs: number;
}

/**
 * Load finality policy from environment variables.
 * Falls back to sensible defaults for the specified network.
 */
export function loadFinalityPolicyFromEnv(network: string): FinalityPolicy {
  const stellarNetwork = (process.env.STELLAR_NETWORK || "testnet") as "mainnet" | "testnet" | "futurenet";

  // Default policies per network
  const defaults: Record<string, Partial<FinalityPolicy>> = {
    mainnet: {
      confirmationDepthRequired: 3,
      confirmationPollIntervalMs: 5000,
      confirmationTimeoutMs: 600000, // 10 min
      ancestryCheckDepth: 10,
      maxReconciliationAttempts: 5,
      reconciliationRetryDelayMs: 5000,
    },
    testnet: {
      confirmationDepthRequired: 2,
      confirmationPollIntervalMs: 2000,
      confirmationTimeoutMs: 300000, // 5 min
      ancestryCheckDepth: 5,
      maxReconciliationAttempts: 3,
      reconciliationRetryDelayMs: 2000,
    },
    futurenet: {
      confirmationDepthRequired: 1,
      confirmationPollIntervalMs: 1000,
      confirmationTimeoutMs: 120000, // 2 min
      ancestryCheckDepth: 3,
      maxReconciliationAttempts: 3,
      reconciliationRetryDelayMs: 1000,
    },
  };

  const networkDefaults = defaults[stellarNetwork] || defaults.testnet;

  return {
    network: stellarNetwork,
    confirmationDepthRequired:
      parseInt(process.env.FINALITY_CONFIRMATION_DEPTH || "", 10) ||
      networkDefaults.confirmationDepthRequired!,
    confirmationPollIntervalMs:
      parseInt(process.env.FINALITY_POLL_INTERVAL_MS || "", 10) ||
      networkDefaults.confirmationPollIntervalMs!,
    confirmationTimeoutMs:
      parseInt(process.env.FINALITY_CONFIRMATION_TIMEOUT_MS || "", 10) ||
      networkDefaults.confirmationTimeoutMs!,
    primaryHorizonUrl:
      process.env.FINALITY_PRIMARY_HORIZON_URL ||
      process.env.STELLAR_HORIZON_URL ||
      "https://horizon-testnet.stellar.org",
    reconciliationHorizonUrl:
      process.env.FINALITY_RECONCILIATION_HORIZON_URL ||
      process.env.FINALITY_PRIMARY_HORIZON_URL ||
      process.env.STELLAR_HORIZON_URL ||
      "https://horizon-testnet.stellar.org",
    ancestryCheckDepth:
      parseInt(process.env.FINALITY_ANCESTRY_CHECK_DEPTH || "", 10) ||
      networkDefaults.ancestryCheckDepth!,
    maxReconciliationAttempts:
      parseInt(process.env.FINALITY_MAX_RECONCILIATION_ATTEMPTS || "", 10) ||
      networkDefaults.maxReconciliationAttempts!,
    reconciliationRetryDelayMs:
      parseInt(process.env.FINALITY_RECONCILIATION_RETRY_DELAY_MS || "", 10) ||
      networkDefaults.reconciliationRetryDelayMs!,
  };
}

export const defaultFinalityPolicy = loadFinalityPolicyFromEnv("testnet");
