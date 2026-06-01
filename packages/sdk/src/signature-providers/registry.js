"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signatureProviderRegistry = exports.SignatureProviderRegistry = void 0;
const errors_1 = require("./errors");
/**
 * Registry for managing SignatureProvider instances.
 * Provides centralized registration, discovery, and management of signing providers.
 */
class SignatureProviderRegistry {
  constructor() {
    this.providers = new Map();
    this.registrationCallbacks = [];
    this.unregistrationCallbacks = [];
  }
  /**
   * Register a new signature provider
   */
  register(provider) {
    if (this.providers.has(provider.providerId)) {
      throw new errors_1.ProviderAlreadyRegisteredError(provider.providerId);
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
  unregister(providerId) {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new errors_1.ProviderNotFoundError(providerId);
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
  getProvider(providerId) {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new errors_1.ProviderNotFoundError(providerId);
    }
    return provider;
  }
  /**
   * Get all registered providers
   */
  listProviders() {
    return Array.from(this.providers.values());
  }
  /**
   * Find providers that support a specific chain
   */
  findProvidersForChain(chainId) {
    return this.listProviders().filter((provider) =>
      provider.getCapabilities().supportedChains.includes(chainId)
    );
  }
  /**
   * Find providers that support multiple chains
   */
  findMultiChainProviders(chainIds) {
    return this.listProviders().filter((provider) => {
      const supportedChains = provider.getCapabilities().supportedChains;
      return chainIds.every((chainId) => supportedChains.includes(chainId));
    });
  }
  /**
   * Check if a provider is registered
   */
  hasProvider(providerId) {
    return this.providers.has(providerId);
  }
  /**
   * Get the number of registered providers
   */
  getProviderCount() {
    return this.providers.size;
  }
  /**
   * Clear all registered providers
   */
  clear() {
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
  onProviderRegistered(callback) {
    this.registrationCallbacks.push(callback);
  }
  /**
   * Register callback for provider unregistration events
   */
  onProviderUnregistered(callback) {
    this.unregistrationCallbacks.push(callback);
  }
  /**
   * Validate that a provider implements the required interface correctly
   */
  validateProvider(provider) {
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
      if (typeof provider[method] !== "function") {
        throw new errors_1.InvalidProviderImplementationError(
          provider.providerId,
          `Missing required method: ${method}`
        );
      }
    }
    // Check required properties
    for (const property of requiredProperties) {
      if (!(property in provider)) {
        throw new errors_1.InvalidProviderImplementationError(
          provider.providerId,
          `Missing required property: ${property}`
        );
      }
    }
    // Validate providerId is non-empty string
    if (!provider.providerId || typeof provider.providerId !== "string") {
      throw new errors_1.InvalidProviderIdError(
        "Provider must have a valid providerId string"
      );
    }
    // Validate metadata structure
    const metadata = provider.metadata;
    if (!metadata || typeof metadata !== "object") {
      throw new errors_1.InvalidProviderMetadataError(
        provider.providerId,
        "Must have valid metadata object"
      );
    }
    if (!metadata.name || !metadata.version || !metadata.description) {
      throw new errors_1.InvalidProviderMetadataError(
        provider.providerId,
        "Metadata must include name, version, and description"
      );
    }
  }
}
exports.SignatureProviderRegistry = SignatureProviderRegistry;
// Global registry instance
exports.signatureProviderRegistry = new SignatureProviderRegistry();
