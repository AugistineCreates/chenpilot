"use strict";
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done
          ? resolve(result.value)
          : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderUtils =
  exports.signatureProviderFactory =
  exports.SignatureProviderFactory =
  exports.ProviderType =
    void 0;
const types_1 = require("../types");
const registry_1 = require("./registry");
const mock_provider_1 = require("./mock-provider");
const ledger_provider_1 = require("./ledger-provider");
const errors_1 = require("./errors");
/**
 * Concrete error class for provider factory operations
 */
class ProviderFactoryError extends errors_1.SignatureProviderError {
  constructor(message, code, providerId) {
    super(message, code, providerId, undefined, false);
  }
}
// Temporary mock for AlbedoSignatureProvider until module export is fixed
class AlbedoSignatureProvider {
  constructor(_config) {
    void _config;
    // Mock implementation
  }
}
/**
 * Provider type identifiers
 */
var ProviderType;
(function (ProviderType) {
  ProviderType["MOCK"] = "mock";
  ProviderType["LEDGER"] = "ledger";
  ProviderType["ALBEDO"] = "albedo";
})(ProviderType || (exports.ProviderType = ProviderType = {}));
/**
 * Factory for creating and managing SignatureProvider instances
 */
class SignatureProviderFactory {
  constructor(config = {}) {
    this.discoveryCache = new Map();
    this.providerInstances = new Map();
    this.config = Object.assign(
      {
        defaultRegistry: registry_1.signatureProviderRegistry,
        enableAutoDiscovery: true,
        discoveryTimeout: 5000,
        enableLogging: false,
      },
      config
    );
  }
  /**
   * Create a new provider instance
   */
  createProvider(providerConfig_1) {
    return __awaiter(
      this,
      arguments,
      void 0,
      function* (providerConfig, options = {}) {
        const {
          autoConnect = false,
          autoRegister = true,
          registry = this.config.defaultRegistry,
          timeout = 10000,
          retries = 3,
        } = options;
        this.log(`Creating provider of type: ${providerConfig.type}`);
        let provider;
        try {
          // Create provider instance based on type
          switch (providerConfig.type) {
            case ProviderType.MOCK:
              provider = this.createMockProvider(providerConfig.config);
              break;
            case ProviderType.LEDGER:
              provider = this.createLedgerProvider(providerConfig.config);
              break;
            case ProviderType.ALBEDO:
              provider = this.createAlbedoProvider(providerConfig.config);
              break;
            default:
              throw new ProviderFactoryError(
                `Unsupported provider type: ${providerConfig.type}`,
                "UNSUPPORTED_PROVIDER_TYPE"
              );
          }
          // Store instance for reuse
          this.providerInstances.set(provider.providerId, provider);
          // Auto-connect if requested
          if (autoConnect) {
            yield this.connectWithRetry(provider, timeout, retries);
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
          throw error instanceof errors_1.SignatureProviderError
            ? error
            : new ProviderFactoryError(
                `Provider creation failed: ${error}`,
                "PROVIDER_CREATION_FAILED"
              );
        }
      }
    );
  }
  /**
   * Get an existing provider instance
   */
  getProvider(providerId) {
    return this.providerInstances.get(providerId);
  }
  /**
   * Create multiple providers from configurations
   */
  createProviders(configs_1) {
    return __awaiter(
      this,
      arguments,
      void 0,
      function* (configs, options = {}) {
        const providers = [];
        const errors = [];
        for (const config of configs) {
          try {
            const provider = yield this.createProvider(config, options);
            providers.push(provider);
          } catch (error) {
            errors.push(
              error instanceof Error ? error : new Error(String(error))
            );
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
    );
  }
  /**
   * Discover available providers
   */
  discoverProviders() {
    return __awaiter(this, arguments, void 0, function* (useCache = true) {
      if (useCache && this.discoveryCache.size > 0) {
        return Array.from(this.discoveryCache.values());
      }
      this.log("Discovering available providers...");
      const discoveries = yield Promise.allSettled([
        this.discoverMockProvider(),
        this.discoverLedgerProvider(),
        this.discoverAlbedoProvider(),
      ]);
      const results = [];
      discoveries.forEach((discovery, index) => {
        var _a;
        const providerType = [
          ProviderType.MOCK,
          ProviderType.LEDGER,
          ProviderType.ALBEDO,
        ][index];
        if (discovery.status === "fulfilled") {
          results.push(discovery.value);
          this.discoveryCache.set(providerType, discovery.value);
        } else {
          const errorResult = {
            type: providerType,
            available: false,
            error:
              ((_a = discovery.reason) === null || _a === void 0
                ? void 0
                : _a.message) || "Discovery failed",
          };
          results.push(errorResult);
          this.discoveryCache.set(providerType, errorResult);
        }
      });
      this.log(
        `Discovery complete. Found ${results.filter((r) => r.available).length} available providers`
      );
      return results;
    });
  }
  /**
   * Create providers for specific chain
   */
  createProvidersForChain(chainId_1) {
    return __awaiter(
      this,
      arguments,
      void 0,
      function* (chainId, options = {}) {
        const discoveries = yield this.discoverProviders();
        const availableProviders = discoveries.filter((d) => d.available);
        const configs = [];
        for (const discovery of availableProviders) {
          if (this.supportsChain(discovery.type, chainId)) {
            configs.push({ type: discovery.type });
          }
        }
        if (configs.length === 0) {
          throw new errors_1.UnsupportedChainError(chainId);
        }
        return this.createProviders(configs, options);
      }
    );
  }
  /**
   * Get the best provider for a specific chain
   */
  getBestProviderForChain(chainId_1) {
    return __awaiter(
      this,
      arguments,
      void 0,
      function* (chainId, preferences = {}) {
        const providers = yield this.createProvidersForChain(chainId, {
          autoConnect: false,
        });
        if (providers.length === 0) {
          throw new errors_1.UnsupportedChainError(chainId);
        }
        // Score providers based on preferences
        const scoredProviders = providers.map((provider) => {
          let score = 0;
          const capabilities = provider.getCapabilities();
          // Base score for supporting the chain
          if (capabilities.supportedChains.includes(chainId)) {
            score += 10;
          }
          // Preference bonuses
          if (
            preferences.preferHardwareWallet &&
            provider.providerId.includes("ledger")
          ) {
            score += 5;
          }
          if (
            preferences.preferBrowserExtension &&
            provider.providerId.includes("albedo")
          ) {
            score += 5;
          }
          if (
            preferences.requireUserInteraction ===
            capabilities.requiresUserInteraction
          ) {
            score += 3;
          }
          // Bonus for higher concurrent signature capacity
          score += Math.min(capabilities.maxConcurrentSignatures, 5);
          return { provider, score };
        });
        // Sort by score and return the best
        scoredProviders.sort((a, b) => b.score - a.score);
        return scoredProviders[0].provider;
      }
    );
  }
  /**
   * Clear discovery cache
   */
  clearDiscoveryCache() {
    this.discoveryCache.clear();
  }
  /**
   * Dispose of all created providers
   */
  dispose() {
    return __awaiter(this, void 0, void 0, function* () {
      this.log("Disposing of all providers...");
      const disposePromises = Array.from(this.providerInstances.values()).map(
        (provider) =>
          __awaiter(this, void 0, void 0, function* () {
            try {
              if (provider.isConnected()) {
                yield provider.disconnect();
              }
            } catch (error) {
              this.log(
                `Error disconnecting provider ${provider.providerId}: ${error}`
              );
            }
          })
      );
      yield Promise.allSettled(disposePromises);
      this.providerInstances.clear();
      this.clearDiscoveryCache();
      this.log("All providers disposed");
    });
  }
  createMockProvider(config) {
    return new mock_provider_1.MockSignatureProvider(
      "mock-provider",
      undefined,
      config
    );
  }
  createLedgerProvider(config) {
    return new ledger_provider_1.LedgerSignatureProvider(config);
  }
  createAlbedoProvider(config) {
    return new AlbedoSignatureProvider(config);
  }
  discoverMockProvider() {
    return __awaiter(this, void 0, void 0, function* () {
      // Mock provider is always available
      return {
        type: ProviderType.MOCK,
        available: true,
        version: "1.0.0",
        metadata: {
          description: "Mock provider for testing and development",
          supportedChains: [
            types_1.ChainId.BITCOIN,
            types_1.ChainId.STELLAR,
            types_1.ChainId.STARKNET,
          ],
        },
      };
    });
  }
  discoverLedgerProvider() {
    return __awaiter(this, void 0, void 0, function* () {
      try {
        // In a real implementation, this would check for Ledger device availability
        // For now, we'll simulate discovery
        yield this.simulateDiscovery(1000);
        return {
          type: ProviderType.LEDGER,
          available: true,
          version: "1.0.0",
          metadata: {
            description: "Ledger hardware wallet",
            supportedChains: [
              types_1.ChainId.BITCOIN,
              types_1.ChainId.STELLAR,
              types_1.ChainId.STARKNET,
            ],
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
    });
  }
  discoverAlbedoProvider() {
    return __awaiter(this, void 0, void 0, function* () {
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
            supportedChains: [types_1.ChainId.STELLAR],
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
    });
  }
  supportsChain(providerType, chainId) {
    switch (providerType) {
      case ProviderType.MOCK:
        return true; // Mock supports all chains
      case ProviderType.LEDGER:
        return [
          types_1.ChainId.BITCOIN,
          types_1.ChainId.STELLAR,
          types_1.ChainId.STARKNET,
        ].includes(chainId);
      case ProviderType.ALBEDO:
        return chainId === types_1.ChainId.STELLAR;
      default:
        return false;
    }
  }
  connectWithRetry(provider, timeout, retries) {
    return __awaiter(this, void 0, void 0, function* () {
      let lastError;
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          this.log(
            `Connecting provider ${provider.providerId} (attempt ${attempt}/${retries})`
          );
          yield this.executeWithTimeout(provider.connect(), timeout);
          this.log(`Successfully connected provider: ${provider.providerId}`);
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          this.log(
            `Connection attempt ${attempt} failed: ${lastError.message}`
          );
          if (attempt < retries) {
            // Wait before retry (exponential backoff)
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            yield new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }
      throw new errors_1.ConnectionError(
        `Failed to connect after ${retries} attempts: ${lastError === null || lastError === void 0 ? void 0 : lastError.message}`,
        provider.providerId
      );
    });
  }
  executeWithTimeout(promise, timeoutMs) {
    return __awaiter(this, void 0, void 0, function* () {
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
    });
  }
  simulateDiscovery(delayMs) {
    return __awaiter(this, void 0, void 0, function* () {
      yield new Promise((resolve) => setTimeout(resolve, delayMs));
    });
  }
  log(message) {
    if (this.config.enableLogging) {
      console.log(`[SignatureProviderFactory] ${message}`);
    }
  }
}
exports.SignatureProviderFactory = SignatureProviderFactory;
/**
 * Default factory instance
 */
exports.signatureProviderFactory = new SignatureProviderFactory();
/**
 * Convenience functions for common operations
 */
class ProviderUtils {
  /**
   * Quick create and connect a provider
   */
  static createAndConnect(type_1, config_1) {
    return __awaiter(
      this,
      arguments,
      void 0,
      function* (type, config, timeout = 10000) {
        const providerConfig = { type, config };
        return exports.signatureProviderFactory.createProvider(providerConfig, {
          autoConnect: true,
          autoRegister: true,
          timeout,
        });
      }
    );
  }
  /**
   * Get all available providers for a chain
   */
  static getProvidersForChain(chainId) {
    return __awaiter(this, void 0, void 0, function* () {
      return exports.signatureProviderFactory.createProvidersForChain(chainId, {
        autoConnect: false,
        autoRegister: false,
      });
    });
  }
  /**
   * Get the best provider for a chain with default preferences
   */
  static getBestProvider(chainId) {
    return __awaiter(this, void 0, void 0, function* () {
      return exports.signatureProviderFactory.getBestProviderForChain(chainId, {
        preferHardwareWallet: true,
        preferBrowserExtension: false,
      });
    });
  }
  /**
   * Discover and list all available providers
   */
  static discoverAll() {
    return __awaiter(this, void 0, void 0, function* () {
      return exports.signatureProviderFactory.discoverProviders(false);
    });
  }
  /**
   * Create a mock provider for testing
   */
  static createMockProvider(config) {
    return new mock_provider_1.MockSignatureProvider(
      "test-mock-provider",
      undefined,
      config
    );
  }
}
exports.ProviderUtils = ProviderUtils;
