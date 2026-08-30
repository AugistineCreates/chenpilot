import { ChainId } from "../types";
import { SignatureProvider } from "./interfaces";
import { ProviderType, ProviderSelectionPreferences, ProviderResolutionResult } from "./types";
import {
  ProviderNotFoundError,
  ProviderAlreadyRegisteredError,
  InvalidProviderImplementationError,
  InvalidProviderIdError,
  InvalidProviderMetadataError,
} from "./errors";

/**
 * Registry for managing SignatureProvider instances.
 * Provides centralized registration, discovery, and management of signing providers.
 */
export class SignatureProviderRegistry {
  private providers: Map<string, SignatureProvider> = new Map();
  private registrationCallbacks: Array<
    (providerId: string, provider: SignatureProvider) => void
  > = [];
  private unregistrationCallbacks: Array<(providerId: string) => void> = [];

  /**
   * Register a new signature provider
   */
  register(provider: SignatureProvider): void {
    if (this.providers.has(provider.providerId)) {
      throw new ProviderAlreadyRegisteredError(provider.providerId);
    }

    // Validate provider implementation
    this.validateProvider(provider);

    this.providers.set(provider.providerId, provider);

    // Notify registration callbacks
    this.registrationCallbacks.forEach((callback) => {
      try {
        callback(provider.providerId, provider);
      } catch (error) {
        console.error("Error in provider registration callback:", error);
      }
    });
  }

  /**
   * Unregister a signature provider
   */
  unregister(providerId: string): void {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new ProviderNotFoundError(providerId);
    }

    // Disconnect provider if connected
    if (provider.isConnected()) {
      provider.disconnect().catch((error) => {
        console.error(`Error disconnecting provider ${providerId}:`, error);
      });
    }

    this.providers.delete(providerId);

    // Notify unregistration callbacks
    this.unregistrationCallbacks.forEach((callback) => {
      try {
        callback(providerId);
      } catch (error) {
        console.error("Error in provider unregistration callback:", error);
      }
    });
  }

  /**
   * Get a specific provider by ID
   */
  getProvider(providerId: string): SignatureProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new ProviderNotFoundError(providerId);
    }
    return provider;
  }

  /**
   * Get all registered providers
   */
  listProviders(): SignatureProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Find providers that support a specific chain
   */
  findProvidersForChain(chainId: ChainId): SignatureProvider[] {
    return this.listProviders().filter((provider) =>
      provider.getCapabilities().supportedChains.includes(chainId)
    );
  }

  /**
   * Find providers that support multiple chains
   */
  findMultiChainProviders(chainIds: ChainId[]): SignatureProvider[] {
    return this.listProviders().filter((provider) => {
      const supportedChains = provider.getCapabilities().supportedChains;
      return chainIds.every((chainId) => supportedChains.includes(chainId));
    });
  }

  resolveProviders(
    chainId: ChainId,
    preferences: ProviderSelectionPreferences = {}
  ): ProviderResolutionResult[] {
    return this.listProviders()
      .filter((provider) => provider.getCapabilities().supportedChains.includes(chainId))
      .map((provider) => {
        const capabilities = provider.getCapabilities();
        let score = 10;
        const reason: string[] = ["supports requested chain"];

        if (preferences.preferHardwareWallet && provider.providerId.includes("ledger")) {
          score += 5;
          reason.push("hardware wallet preference");
        }
        if (preferences.preferBrowserExtension && provider.providerId.includes("albedo")) {
          score += 5;
          reason.push("browser extension preference");
        }
        if (preferences.requireUserInteraction === capabilities.requiresUserInteraction) {
          score += 3;
          reason.push("interaction preference matched");
        }
        if (preferences.requireMessageSigning && capabilities.supportsMessageSigning) {
          score += 2;
          reason.push("message signing supported");
        }
        if (preferences.minConcurrentSignatures && capabilities.maxConcurrentSignatures >= preferences.minConcurrentSignatures) {
          score += 2;
          reason.push("concurrency requirement met");
        }
        if (preferences.preferredProviderIds?.includes(provider.providerId)) {
          score += 10;
          reason.push("preferred provider id");
        }

        return {
          providerType: provider.providerId.includes("ledger")
            ? ProviderType.LEDGER
            : provider.providerId.includes("albedo")
              ? ProviderType.ALBEDO
              : ProviderType.MOCK,
          providerId: provider.providerId,
          score,
          capabilities,
          reason,
        } satisfies ProviderResolutionResult;
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Check if a provider is registered
   */
  hasProvider(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  /**
   * Get the number of registered providers
   */
  getProviderCount(): number {
    return this.providers.size;
  }

  /**
   * Clear all registered providers
   */
  clear(): void {
    // Disconnect all providers first
    const disconnectPromises = Array.from(this.providers.values())
      .filter((provider) => provider.isConnected())
      .map((provider) =>
        provider.disconnect().catch((error) => {
          console.error(
            `Error disconnecting provider ${provider.providerId}:`,
            error
          );
        })
      );

    Promise.all(disconnectPromises).finally(() => {
      const providerIds = Array.from(this.providers.keys());
      this.providers.clear();

      // Notify unregistration callbacks for all providers
      providerIds.forEach((providerId) => {
        this.unregistrationCallbacks.forEach((callback) => {
          try {
            callback(providerId);
          } catch (error) {
            console.error("Error in provider unregistration callback:", error);
          }
        });
      });
    });
  }

  /**
   * Register callback for provider registration events
   */
  onProviderRegistered(
    callback: (providerId: string, provider: SignatureProvider) => void
  ): void {
    this.registrationCallbacks.push(callback);
  }

  /**
   * Register callback for provider unregistration events
   */
  onProviderUnregistered(callback: (providerId: string) => void): void {
    this.unregistrationCallbacks.push(callback);
  }

  /**
   * Validate that a provider implements the required interface correctly
   */
  private validateProvider(provider: SignatureProvider): void {
    const requiredMethods = [
      "connect",
      "disconnect",
      "isConnected",
      "getAccounts",
      "signTransaction",
      "getCapabilities",
    ];

    const requiredProperties = ["providerId", "metadata"];

    // Check required methods
    for (const method of requiredMethods) {
      if (
        typeof (provider as unknown as Record<string, unknown>)[method] !==
        "function"
      ) {
        throw new InvalidProviderImplementationError(
          provider.providerId,
          `Missing required method: ${method}`
        );
      }
    }

    // Check required properties
    for (const property of requiredProperties) {
      if (!(property in provider)) {
        throw new InvalidProviderImplementationError(
          provider.providerId,
          `Missing required property: ${property}`
        );
      }
    }

    // Validate providerId is non-empty string
    if (!provider.providerId || typeof provider.providerId !== "string") {
      throw new InvalidProviderIdError(
        "Provider must have a valid providerId string"
      );
    }

    // Validate metadata structure
    const metadata = provider.metadata;
    if (!metadata || typeof metadata !== "object") {
      throw new InvalidProviderMetadataError(
        provider.providerId,
        "Must have valid metadata object"
      );
    }

    if (!metadata.name || !metadata.version || !metadata.description) {
      throw new InvalidProviderMetadataError(
        provider.providerId,
        "Metadata must include name, version, and description"
      );
    }
  }
}

// Global registry instance
export const signatureProviderRegistry = new SignatureProviderRegistry();
