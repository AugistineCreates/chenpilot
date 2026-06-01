import * as dotenv from "dotenv";
import * as path from "path";

// Load .env.local first, then fall back to .env
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

/**
 * DeFi Protocol Types supported by the system
 */
export type DeFiProtocol = "equilibre" | "yieldblox";

/**
 * Adapter capabilities that can be enabled/disabled
 */
export interface AdapterCapabilities {
  swap: boolean;
  liquidity: boolean;
  staking: boolean;
  lending: boolean;
  borrowing: boolean;
  farming: boolean;
}

/**
 * Base configuration for a DeFi adapter
 */
export interface DeFiAdapterConfig {
  /** Unique identifier for the adapter */
  id: string;
  /** Protocol name */
  name: string;
  /** Protocol type */
  protocol: DeFiProtocol;
  /** Whether the adapter is enabled */
  enabled: boolean;
  /** API endpoint URL */
  apiUrl: string;
  /** RPC endpoint URL (if applicable) */
  rpcUrl?: string;
  /** Smart contract addresses (network-specific) */
  contracts: {
    testnet: Record<string, string>;
    public: Record<string, string>;
  };
  /** Enabled capabilities for this adapter */
  capabilities: AdapterCapabilities;
  /** Additional custom configuration */
  customConfig?: Record<string, any>;
  /** Timeout for API requests in milliseconds */
  timeout: number;
  /** Retry configuration */
  retry: {
    maxAttempts: number;
    backoffMs: number;
  };
}

/**
 * Default adapter capabilities
 */
export const DEFAULT_CAPABILITIES: AdapterCapabilities = {
  swap: false,
  liquidity: false,
  staking: false,
  lending: false,
  borrowing: false,
  farming: false,
};

/**
 * Environment variable prefixes for DeFi adapters
 */
const ADAPTER_ENV_PREFIXES: Record<DeFiProtocol, string> = {
  equilibre: "DEFI_EQUILIBRE",
  yieldblox: "DEFI_YIELDBLOX",
};

/**
 * Parse boolean environment variable
 */
function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === "true";
}

/**
 * Parse number environment variable
 */
function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Create a DeFi adapter configuration from environment variables
 */
function createAdapterConfig(
  protocol: DeFiProtocol,
  defaults: Partial<DeFiAdapterConfig>
): DeFiAdapterConfig {
  const prefix = ADAPTER_ENV_PREFIXES[protocol];

  const enabled = parseBool(
    process.env[`${prefix}_ENABLED`],
    defaults.enabled ?? false
  );
  const network =
    (process.env.STELLAR_NETWORK as "testnet" | "public") || "testnet";

  return {
    id: defaults.id || protocol,
    name: defaults.name || protocol.charAt(0).toUpperCase() + protocol.slice(1),
    protocol,
    enabled,
    apiUrl: process.env[`${prefix}_API_URL`] || defaults.apiUrl || "",
    rpcUrl: process.env[`${prefix}_RPC_URL`] || defaults.rpcUrl,
    contracts: {
      testnet: defaults.contracts?.testnet || {},
      public: defaults.contracts?.public || {},
    },
    capabilities: {
      swap: parseBool(
        process.env[`${prefix}_CAPABILITY_SWAP`],
        defaults.capabilities?.swap ?? false
      ),
      liquidity: parseBool(
        process.env[`${prefix}_CAPABILITY_LIQUIDITY`],
        defaults.capabilities?.liquidity ?? false
      ),
      staking: parseBool(
        process.env[`${prefix}_CAPABILITY_STAKING`],
        defaults.capabilities?.staking ?? false
      ),
      lending: parseBool(
        process.env[`${prefix}_CAPABILITY_LENDING`],
        defaults.capabilities?.lending ?? false
      ),
      borrowing: parseBool(
        process.env[`${prefix}_CAPABILITY_BORROWING`],
        defaults.capabilities?.borrowing ?? false
      ),
      farming: parseBool(
        process.env[`${prefix}_CAPABILITY_FARMING`],
        defaults.capabilities?.farming ?? false
      ),
    },
    customConfig: defaults.customConfig,
    timeout: parseNumber(
      process.env[`${prefix}_TIMEOUT`],
      defaults.timeout ?? 30000
    ),
    retry: {
      maxAttempts: parseNumber(
        process.env[`${prefix}_RETRY_ATTEMPTS`],
        defaults.retry?.maxAttempts ?? 3
      ),
      backoffMs: parseNumber(
        process.env[`${prefix}_RETRY_BACKOFF`],
        defaults.retry?.backoffMs ?? 1000
      ),
    },
  };
}

/**
 * Pre-configured DeFi adapter configurations
 * These serve as defaults and can be overridden by environment variables
 */
const DEFAULT_ADAPTERS: Record<DeFiProtocol, Partial<DeFiAdapterConfig>> = {
  equilibre: {
    id: "equilibre",
    name: "Equilibre",
    protocol: "equilibre",
    apiUrl: process.env.DEFI_EQUILIBRE_API_URL || "https://api.equilibre.io",
    contracts: {
      testnet: {
        router: "CDTZQV2WRVR7H2NYIV4VKDIIV6XNRDDD4JVF3ZHRXLG5IIQT3J4P3MR",
        factory: "GDLZ7ZCVK2XOZ3VXHBA2EHZ3M5FZRKCEFGUD3JHZ4C3RUGP3B2C2M5V",
      },
      public: {
        router: "GDK76T75KBR3NHVCSHMFNJ3ZRWB0C1RC7AVDKVC7CJE3V7VJ2J6W5JUD",
        factory: "GDFRLMSXRK2WMVZNWQJ3PJ4Y6VUNQZC3P2XZU5XOHNHZG3K2BLV6WJC",
      },
    },
    capabilities: {
      swap: true,
      liquidity: true,
      staking: false,
      lending: false,
      borrowing: false,
      farming: false,
    },
    timeout: 30000,
    retry: {
      maxAttempts: 3,
      backoffMs: 1000,
    },
  },
  yieldblox: {
    id: "yieldblox",
    name: "YieldBlox",
    protocol: "yieldblox",
    apiUrl: process.env.DEFI_YIELDBLOX_API_URL || "https://api.yieldblox.io",
    contracts: {
      testnet: {
        lendingPool: "SCZ3BA4NCW5VJ5N3V5F3VZJK5ROXKVCYKD4JDKFRF5JJ5I5S7VF5H7P",
        creditLine: "SD5CZOX4HX5UK67UBDU3EQDDUUBCY4CZNH5FV4YIP4UFU6GZJ7W5VLYT",
      },
      public: {
        lendingPool: "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOUJ3LNLRK",
        creditLine:
          "GCRA6F4H3K4KZ5P7V6D2J3T5Y8W9X0Z1Y2A3B4C5D6E7F8G9H0I1J2K3L4",
      },
    },
    capabilities: {
      swap: false,
      liquidity: false,
      staking: false,
      lending: true,
      borrowing: true,
      farming: false,
    },
    timeout: 30000,
    retry: {
      maxAttempts: 3,
      backoffMs: 1000,
    },
  },
};

/**
 * Generate all DeFi adapter configurations
 */
export function generateDeFiAdapterConfigs(): DeFiAdapterConfig[] {
  const adapters: DeFiAdapterConfig[] = [];

  for (const protocol of Object.keys(DEFAULT_ADAPTERS) as DeFiProtocol[]) {
    const config = createAdapterConfig(protocol, DEFAULT_ADAPTERS[protocol]);
    adapters.push(config);
  }

  return adapters;
}

/**
 * Get adapter configuration by protocol type
 */
export function getAdapterConfig(protocol: DeFiProtocol): DeFiAdapterConfig {
  return createAdapterConfig(protocol, DEFAULT_ADAPTERS[protocol]);
}

/**
 * Get enabled adapters only
 */
export function getEnabledAdapters(): DeFiAdapterConfig[] {
  return generateDeFiAdapterConfigs().filter((adapter) => adapter.enabled);
}

/**
 * Get adapters supporting a specific capability
 */
export function getAdaptersByCapability(
  capability: keyof AdapterCapabilities
): DeFiAdapterConfig[] {
  return getEnabledAdapters().filter(
    (adapter) => adapter.capabilities[capability]
  );
}

/**
 * Get contract address for a specific adapter and network
 */
export function getContractAddress(
  protocol: DeFiProtocol,
  contractName: string,
  network?: "testnet" | "public"
): string | undefined {
  const config = getAdapterConfig(protocol);
  const net =
    network ||
    (process.env.STELLAR_NETWORK as "testnet" | "public") ||
    "testnet";
  return config.contracts[net]?.[contractName];
}
