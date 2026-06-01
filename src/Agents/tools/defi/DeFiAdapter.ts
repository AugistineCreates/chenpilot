import {
  DeFiAdapterConfig,
  AdapterCapabilities,
  getAdapterConfig,
} from "../../../config/defiAdapters";

/**
 * Result returned by DeFi adapter operations
 */
export interface AdapterResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

/**
 * Quote result for swap/liquidity operations
 */
export interface QuoteResult {
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  priceImpact: number;
  route: string[];
  estimatedGas: string;
}

/**
 * Position result for lending/borrowing positions
 */
export interface PositionResult {
  token: string;
  amount: string;
  valueUSD: number;
  APY: number;
}

/**
 * Transaction request for executing DeFi operations
 */
export interface TransactionRequest {
  to: string;
  data: string;
  value?: string;
  gasLimit?: string;
}

/**
 * Base class for DeFi protocol adapters
 */
export abstract class DeFiAdapter {
  protected config: DeFiAdapterConfig;

  constructor(protocol: "equilibre" | "yieldblox") {
    this.config = getAdapterConfig(protocol);

    if (!this.config.enabled) {
      console.warn(`[DeFiAdapter] ${this.config.name} adapter is disabled`);
    }
  }

  /**
   * Get the adapter configuration
   */
  getConfig(): DeFiAdapterConfig {
    return this.config;
  }

  /**
   * Check if a specific capability is enabled
   */
  hasCapability(capability: keyof AdapterCapabilities): boolean {
    return this.config.capabilities[capability];
  }

  /**
   * Get the API URL for this adapter
   */
  getApiUrl(): string {
    return this.config.apiUrl;
  }

  /**
   * Get a contract address for the current network
   */
  getContractAddress(contractName: string): string | undefined {
    const network =
      (process.env.STELLAR_NETWORK as "testnet" | "public") || "testnet";
    return this.config.contracts[network]?.[contractName];
  }

  /**
   * Execute an API request with retry logic
   */
  protected async fetchWithRetry<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const { timeout, retry } = this.config;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
      try {
        const response = await fetch(`${this.config.apiUrl}${endpoint}`, {
          ...options,
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            ...options.headers,
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < retry.maxAttempts) {
          await new Promise((resolve) =>
            setTimeout(resolve, retry.backoffMs * attempt)
          );
        }
      }
    }

    clearTimeout(timeoutId);
    throw lastError || new Error("Request failed after retries");
  }

  /**
   * Get a quote for a swap operation
   * Must be implemented by subclasses
   */
  abstract getSwapQuote(
    fromToken: string,
    toToken: string,
    amount: string
  ): Promise<AdapterResult<QuoteResult>>;

  /**
   * Execute a swap transaction
   * Must be implemented by subclasses
   */
  abstract executeSwap(
    fromToken: string,
    toToken: string,
    amount: string,
    minReceived?: string
  ): Promise<AdapterResult<TransactionRequest>>;

  /**
   * Get liquidity positions for an address
   * Must be implemented by subclasses
   */
  abstract getLiquidityPositions(
    address: string
  ): Promise<AdapterResult<PositionResult[]>>;

  /**
   * Get lending positions for an address
   * Must be implemented by subclasses
   */
  abstract getLendingPositions(
    address: string
  ): Promise<AdapterResult<PositionResult[]>>;

  /**
   * Get borrowing positions for an address
   * Must be implemented by subclasses
   */
  abstract getBorrowingPositions(
    address: string
  ): Promise<AdapterResult<PositionResult[]>>;

  /**
   * Health check for the adapter
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.fetchWithRetry("/health", { method: "GET" });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Factory for creating DeFi adapters
 */
export class DeFiAdapterFactory {
  private static adapters: Map<string, DeFiAdapter> = new Map();

  /**
   * Create or get an adapter instance
   */
  static getAdapter<T extends DeFiAdapter>(
    protocol: "equilibre" | "yieldblox",
    adapterClass: new (protocol: "equilibre" | "yieldblox") => T
  ): T {
    const key = protocol;

    if (!this.adapters.has(key)) {
      this.adapters.set(key, new adapterClass(protocol));
    }

    return this.adapters.get(key) as T;
  }

  /**
   * Clear all cached adapters
   */
  static clearCache(): void {
    this.adapters.clear();
  }
}

export { DeFiAdapterConfig, AdapterCapabilities };
