import { ChainId } from "../types";
import { SignatureProvider } from "./interfaces";
import {
  AlbedoSignatureProvider,
  AlbedoProviderConfig,
} from "./albedo-provider";
import {
  SignatureProviderRegistry,
  signatureProviderRegistry,
} from "./registry";
import { MockSignatureProvider, MockProviderConfig } from "./mock-provider";
import {
  LedgerSignatureProvider,
  LedgerProviderConfig,
} from "./ledger-provider";
import {
  SignatureProviderError,
  UnsupportedChainError,
  ConnectionError,
  ProviderCreationError,
  UnsupportedProviderTypeError,
} from "./errors";
import { ProviderSelectionPreferences, ProviderType } from "./types";

/**
 * Concrete error class for provider factory operations
 */
class ProviderFactoryError extends SignatureProviderError {
  constructor(message: string, code: string, providerId?: string) {
    super(message, code, providerId, undefined, false);
  }
}

/**
 * Provider configuration union type
 */
type ProviderConfig =
  | { type: ProviderType.MOCK; config?: MockProviderConfig }
  | { type: ProviderType.LEDGER; config?: LedgerProviderConfig }
  | { type: ProviderType.ALBEDO; config?: AlbedoProviderConfig };

/**
 * Provider discovery result
 */
export interface ProviderDiscoveryResult {
  type: ProviderType;
  available: boolean;
  version?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

/**
 * Provider initialization options
 */
export interface ProviderInitializationOptions {
  autoConnect?: boolean;
  autoRegister?: boolean;
  registry?: SignatureProviderRegistry;
  timeout?: number;
  retries?: number;
}

/**
 * Provider factory configuration
 */
export interface ProviderFactoryConfig {
  defaultRegistry?: SignatureProviderRegistry;
  enableAutoDiscovery?: boolean;
  discoveryTimeout?: number;
  enableLogging?: boolean;
}

/**
 * Factory for creating and managing SignatureProvider instances
 */
export class SignatureProviderFactory {
  private config: ProviderFactoryConfig;
  private discoveryCache: Map<ProviderType, ProviderDiscoveryResult> =
    new Map();
  private providerInstances: Map<string, SignatureProvider> = new Map();

  constructor(config: ProviderFactoryConfig = {}) {
    this.config = {
      defaultRegistry: signatureProviderRegistry,
      enableAutoDiscovery: true,
      discoveryTimeout: 5000,
      enableLogging: false,
      ...config,
    };
  }

  /**
   * Create a new provider instance
   */
  async createProvider(
    providerConfig: ProviderConfig,
    options: ProviderInitializationOptions = {}
  ): Promise<SignatureProvider> {
    const {
      autoConnect = false,
      autoRegister = true,
      registry = this.config.defaultRegistry,
      timeout = 10000,
      retries = 3,
    } = options;

    this.log(`Creating provider of type: ${providerConfig.type}`);

    let provider: SignatureProvider;

    try {
      provider = this.createProviderInstance(providerConfig);

      // Store instance for reuse
      this.providerInstances.set(provider.providerId, provider);

      // Auto-connect if requested
      if (autoConnect) {
        await this.connectWithRetry(provider, timeout, retries);
      }

      // Auto-register if requested
      if (autoRegister && registry) {
        registry.register(provider);
        this.log(`Registered provider: ${provider.providerId}`);
      }

      this.log(`Successfully created provider: ${provider.providerId}`);
      return provider;
    } catch (error) {
      this.log(`Failed to create provider: ${error}`);
      throw error instanceof SignatureProviderError
        ? error
        : new ProviderCreationError(`Provider creation failed: ${error}`);
    }
  }

  /**
   * Get an existing provider instance
   */
  getProvider(providerId: string): SignatureProvider | undefined {
    return this.providerInstances.get(providerId);
  }

  /**
   * Create multiple providers from configurations
   */
  async createProviders(
    configs: ProviderConfig[],
    options: ProviderInitializationOptions = {}
  ): Promise<SignatureProvider[]> {
    const providers: SignatureProvider[] = [];
    const errors: Error[] = [];

    for (const config of configs) {
      try {
        const provider = await this.createProvider(config, options);
        providers.push(provider);
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));

        if (!options.autoConnect) {
          // If not auto-connecting, continue with other providers
          continue;
        } else {
          // If auto-connecting, this is a critical error
          throw error;
        }
      }
    }

    if (providers.length === 0 && errors.length > 0) {
      throw new ProviderFactoryError(
        `Failed to create any providers: ${errors.map((e) => e.message).join(", ")}`,
        "ALL_PROVIDERS_FAILED"
      );
    }

    return providers;
  }

  /**
   * Discover available providers
   */
  async discoverProviders(
    useCache: boolean = true
  ): Promise<ProviderDiscoveryResult[]> {
    if (useCache && this.discoveryCache.size > 0) {
      return Array.from(this.discoveryCache.values());
    }

    this.log("Discovering available providers...");

    const discoveries = await Promise.allSettled([
      this.discoverMockProvider(),
      this.discoverLedgerProvider(),
      this.discoverAlbedoProvider(),
    ]);

    const results: ProviderDiscoveryResult[] = [];

    discoveries.forEach((discovery, index) => {
      const providerType = [
        ProviderType.MOCK,
        ProviderType.LEDGER,
        ProviderType.ALBEDO,
      ][index];

      if (discovery.status === "fulfilled") {
        results.push(discovery.value);
        this.discoveryCache.set(providerType, discovery.value);
      } else {
        const errorResult: ProviderDiscoveryResult = {
          type: providerType,
          available: false,
          error: discovery.reason?.message || "Discovery failed",
        };
        results.push(errorResult);
        this.discoveryCache.set(providerType, errorResult);
      }
    });

    this.log(
      `Discovery complete. Found ${results.filter((r) => r.available).length} available providers`
    );
    return results;
  }

  /**
   * Create providers for specific chain
   */
  async createProvidersForChain(
    chainId: ChainId,
    options: ProviderInitializationOptions = {}
  ): Promise<SignatureProvider[]> {
    const discoveries = await this.discoverProviders();
    const availableProviders = discoveries.filter((d) => d.available);

    const configs: ProviderConfig[] = availableProviders
      .filter((discovery) => this.supportsChain(discovery.type, chainId))
      .map((discovery) => ({ type: discovery.type }) as ProviderConfig);

    if (configs.length === 0) {
      throw new UnsupportedChainError(chainId);
    }

    return this.createProviders(configs, options);
  }

  /**
   * Get the best provider for a specific chain
   */
  async getBestProviderForChain(
    chainId: ChainId,
    preferences: {
      preferHardwareWallet?: boolean;
      preferBrowserExtension?: boolean;
      requireUserInteraction?: boolean;
    } = {}
  ): Promise<SignatureProvider> {
    const registry = this.config.defaultRegistry ?? signatureProviderRegistry;
    const candidates = registry.resolveProviders(
      chainId,
      preferences as ProviderSelectionPreferences
    );
    if (!candidates.length) {
      throw new UnsupportedChainError(chainId);
    }
    const best = candidates[0];
    return (
      this.getProvider(best.providerId || "") ??
      (await this.createProvider({ type: best.providerType }))
    );
  }

  /**
   * Clear discovery cache
   */
  clearDiscoveryCache(): void {
    this.discoveryCache.clear();
  }

  /**
   * Dispose of all created providers
   */
  async dispose(): Promise<void> {
    this.log("Disposing of all providers...");

    const disposePromises = Array.from(this.providerInstances.values()).map(
      async (provider) => {
        try {
          if (provider.isConnected()) {
            await provider.disconnect();
          }
        } catch (error) {
          this.log(
            `Error disconnecting provider ${provider.providerId}: ${error}`
          );
        }
      }
    );

    await Promise.allSettled(disposePromises);

    this.providerInstances.clear();
    this.clearDiscoveryCache();

    this.log("All providers disposed");
  }

  private createMockProvider(
    config?: MockProviderConfig
  ): MockSignatureProvider {
    return new MockSignatureProvider("mock-provider", undefined, config);
  }

  private createLedgerProvider(
    config?: LedgerProviderConfig
  ): LedgerSignatureProvider {
    return new LedgerSignatureProvider(config);
  }

  private createAlbedoProvider(
    config?: AlbedoProviderConfig
  ): AlbedoSignatureProvider {
    return new AlbedoSignatureProvider(config);
  }

  private createProviderInstance(
    providerConfig: ProviderConfig
  ): SignatureProvider {
    switch (providerConfig.type) {
      case ProviderType.MOCK:
        return this.createMockProvider(providerConfig.config);
      case ProviderType.LEDGER:
        return this.createLedgerProvider(providerConfig.config);
      case ProviderType.ALBEDO:
        return this.createAlbedoProvider(providerConfig.config);
      default:
        throw new UnsupportedProviderTypeError(
          (providerConfig as unknown as { type: string }).type
        );
    }
  }

  private async discoverMockProvider(): Promise<ProviderDiscoveryResult> {
    // Mock provider is always available
    return {
      type: ProviderType.MOCK,
      available: true,
      version: "1.0.0",
      metadata: {
        description: "Mock provider for testing and development",
        supportedChains: [ChainId.BITCOIN, ChainId.STELLAR, ChainId.STARKNET],
      },
    };
  }

  private async discoverLedgerProvider(): Promise<ProviderDiscoveryResult> {
    try {
      // In a real implementation, this would check for Ledger device availability
      // For now, we'll simulate discovery
      await this.simulateDiscovery(1000);

      return {
        type: ProviderType.LEDGER,
        available: true,
        version: "1.0.0",
        metadata: {
          description: "Ledger hardware wallet",
          supportedChains: [ChainId.BITCOIN, ChainId.STELLAR, ChainId.STARKNET],
          requiresHardware: true,
        },
      };
    } catch (error) {
      return {
        type: ProviderType.LEDGER,
        available: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async discoverAlbedoProvider(): Promise<ProviderDiscoveryResult> {
    try {
      // Check if Albedo extension is available
      const isAvailable = typeof window !== "undefined" && "albedo" in window;

      if (!isAvailable) {
        return {
          type: ProviderType.ALBEDO,
          available: false,
          error: "Albedo browser extension not found",
        };
      }

      return {
        type: ProviderType.ALBEDO,
        available: true,
        version: "1.0.0",
        metadata: {
          description: "Albedo browser extension for Stellar",
          supportedChains: [ChainId.STELLAR],
          requiresBrowser: true,
        },
      };
    } catch (error) {
      return {
        type: ProviderType.ALBEDO,
        available: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private supportsChain(providerType: ProviderType, chainId: ChainId): boolean {
    switch (providerType) {
      case ProviderType.MOCK:
        return true; // Mock supports all chains
      case ProviderType.LEDGER:
        return [ChainId.BITCOIN, ChainId.STELLAR, ChainId.STARKNET].includes(
          chainId
        );
      case ProviderType.ALBEDO:
        return chainId === ChainId.STELLAR;
      default:
        return false;
    }
  }

  private async connectWithRetry(
    provider: SignatureProvider,
    timeout: number,
    retries: number
  ): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        this.log(
          `Connecting provider ${provider.providerId} (attempt ${attempt}/${retries})`
        );

        await this.executeWithTimeout(provider.connect(), timeout);
        this.log(`Successfully connected provider: ${provider.providerId}`);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.log(`Connection attempt ${attempt} failed: ${lastError.message}`);

        if (attempt < retries) {
          // Wait before retry (exponential backoff)
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new ConnectionError(
      `Failed to connect after ${retries} attempts: ${lastError?.message}`,
      provider.providerId
    );
  }

  private async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private async simulateDiscovery(delayMs: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(`[SignatureProviderFactory] ${message}`);
    }
  }
}

/**
 * Default factory instance
 */
export const signatureProviderFactory = new SignatureProviderFactory();

/**
 * Convenience functions for common operations
 */
export class ProviderUtils {
  /**
   * Quick create and connect a provider
   */
  static async createAndConnect(
    type: ProviderType,
    config?: unknown,
    timeout: number = 10000
  ): Promise<SignatureProvider> {
    const providerConfig: ProviderConfig = { type, config } as ProviderConfig;

    return signatureProviderFactory.createProvider(providerConfig, {
      autoConnect: true,
      autoRegister: true,
      timeout,
    });
  }

  /**
   * Get all available providers for a chain
   */
  static async getProvidersForChain(
    chainId: ChainId
  ): Promise<SignatureProvider[]> {
    return signatureProviderFactory.createProvidersForChain(chainId, {
      autoConnect: false,
      autoRegister: false,
    });
  }

  /**
   * Get the best provider for a chain with default preferences
   */
  static async getBestProvider(chainId: ChainId): Promise<SignatureProvider> {
    return signatureProviderFactory.getBestProviderForChain(chainId, {
      preferHardwareWallet: true,
      preferBrowserExtension: false,
    });
  }

  /**
   * Discover and list all available providers
   */
  static async discoverAll(): Promise<ProviderDiscoveryResult[]> {
    return signatureProviderFactory.discoverProviders(false);
  }

  /**
   * Create a mock provider for testing
   */
  static createMockProvider(
    config?: MockProviderConfig
  ): MockSignatureProvider {
    return new MockSignatureProvider("test-mock-provider", undefined, config);
  }
}
