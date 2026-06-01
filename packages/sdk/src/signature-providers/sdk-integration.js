"use strict";
/**
 * @fileoverview SDK Integration utilities for SignatureProvider system
 * @module SignatureProviders/SDKIntegration
 */
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
exports.SignatureProviderSDKBuilder =
  exports.SDKUtils =
  exports.signatureProviderSDK =
  exports.SignatureProviderSDK =
    void 0;
exports.createSDKBuilder = createSDKBuilder;
const index_1 = require("./index");
/**
 * Main SDK class for SignatureProvider system integration
 */
class SignatureProviderSDK {
  constructor(config = {}) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    this.metrics = new Map();
    this.healthChecks = new Map();
    this.initialized = false;
    this.config = {
      defaultProviders: config.defaultProviders || [index_1.ProviderType.MOCK],
      autoDiscovery:
        (_a = config.autoDiscovery) !== null && _a !== void 0 ? _a : true,
      enableMetrics:
        (_b = config.enableMetrics) !== null && _b !== void 0 ? _b : false,
      enableLogging:
        (_c = config.enableLogging) !== null && _c !== void 0 ? _c : false,
      errorRecovery: {
        enabled:
          (_e =
            (_d = config.errorRecovery) === null || _d === void 0
              ? void 0
              : _d.enabled) !== null && _e !== void 0
            ? _e
            : true,
        maxRetries:
          (_g =
            (_f = config.errorRecovery) === null || _f === void 0
              ? void 0
              : _f.maxRetries) !== null && _g !== void 0
            ? _g
            : 3,
        retryDelay:
          (_j =
            (_h = config.errorRecovery) === null || _h === void 0
              ? void 0
              : _h.retryDelay) !== null && _j !== void 0
            ? _j
            : 1000,
      },
      registry: {
        autoRegister:
          (_l =
            (_k = config.registry) === null || _k === void 0
              ? void 0
              : _k.autoRegister) !== null && _l !== void 0
            ? _l
            : true,
        validateProviders:
          (_o =
            (_m = config.registry) === null || _m === void 0
              ? void 0
              : _m.validateProviders) !== null && _o !== void 0
            ? _o
            : true,
      },
    };
    this.registry = index_1.signatureProviderRegistry;
    this.factory = index_1.signatureProviderFactory;
    this.coordinator = new index_1.MultiSignatureCoordinator();
    this.errorRecovery = index_1.signatureProviderErrorRecovery;
  }
  /**
   * Initialize the SDK
   */
  initialize() {
    return __awaiter(this, void 0, void 0, function* () {
      if (this.initialized) {
        return;
      }
      this.log("Initializing SignatureProvider SDK...");
      try {
        // Setup event listeners for metrics collection
        if (this.config.enableMetrics) {
          this.setupMetricsCollection();
        }
        // Auto-discover providers if enabled
        if (this.config.autoDiscovery) {
          yield this.discoverAndInitializeProviders();
        }
        // Setup error recovery if enabled
        if (this.config.errorRecovery.enabled) {
          this.setupErrorRecovery();
        }
        this.initialized = true;
        this.log("SignatureProvider SDK initialized successfully");
      } catch (error) {
        this.log("Failed to initialize SDK:", error);
        throw error;
      }
    });
  }
  /**
   * Get the SDK context for dependency injection
   */
  getContext() {
    return {
      registry: this.registry,
      factory: this.factory,
      coordinator: this.coordinator,
      errorRecovery: this.errorRecovery,
    };
  }
  /**
   * Create a provider with SDK configuration
   */
  createProvider(type, config) {
    return __awaiter(this, void 0, void 0, function* () {
      this.ensureInitialized();
      const provider = yield this.factory.createProvider(
        { type, config },
        {
          autoConnect: true,
          autoRegister: this.config.registry.autoRegister,
          timeout: 10000,
        }
      );
      // Initialize metrics tracking
      if (this.config.enableMetrics) {
        this.initializeProviderMetrics(provider.providerId);
      }
      // Perform health check
      yield this.performHealthCheck(provider.providerId);
      return provider;
    });
  }
  /**
   * Get all available providers
   */
  getProviders() {
    this.ensureInitialized();
    return this.registry.listProviders();
  }
  /**
   * Get providers for specific chain
   */
  getProvidersForChain(chainId) {
    this.ensureInitialized();
    return this.registry.findProvidersForChain(chainId);
  }
  /**
   * Get the best provider for a chain
   */
  getBestProvider(chainId) {
    return __awaiter(this, void 0, void 0, function* () {
      this.ensureInitialized();
      return this.factory.getBestProviderForChain(chainId);
    });
  }
  /**
   * Perform health checks on all providers
   */
  performHealthChecks() {
    return __awaiter(this, void 0, void 0, function* () {
      this.ensureInitialized();
      const providers = this.registry.listProviders();
      const healthChecks = [];
      for (const provider of providers) {
        const healthCheck = yield this.performHealthCheck(provider.providerId);
        healthChecks.push(healthCheck);
      }
      return healthChecks;
    });
  }
  /**
   * Get provider metrics
   */
  getProviderMetrics(providerId) {
    this.ensureInitialized();
    if (providerId) {
      const metrics = this.metrics.get(providerId);
      return metrics ? [metrics] : [];
    }
    return Array.from(this.metrics.values());
  }
  /**
   * Get provider health status
   */
  getProviderHealth(providerId) {
    this.ensureInitialized();
    if (providerId) {
      const health = this.healthChecks.get(providerId);
      return health ? [health] : [];
    }
    return Array.from(this.healthChecks.values());
  }
  /**
   * Batch create providers
   */
  batchCreateProviders(configs) {
    return __awaiter(this, void 0, void 0, function* () {
      this.ensureInitialized();
      const startTime = Date.now();
      const successful = [];
      const failed = [];
      for (const config of configs) {
        try {
          const provider = yield this.createProvider(
            config.type,
            config.config
          );
          successful.push(provider);
        } catch (error) {
          failed.push({
            error: error instanceof Error ? error : new Error(String(error)),
            input: config,
          });
        }
      }
      const endTime = Date.now();
      return {
        successful,
        failed,
        totalCount: configs.length,
        successCount: successful.length,
        failureCount: failed.length,
        duration: endTime - startTime,
      };
    });
  }
  /**
   * Dispose of the SDK and cleanup resources
   */
  dispose() {
    return __awaiter(this, void 0, void 0, function* () {
      if (!this.initialized) {
        return;
      }
      this.log("Disposing SignatureProvider SDK...");
      try {
        // Dispose factory (disconnects all providers)
        yield this.factory.dispose();
        // Clear registry
        this.registry.clear();
        // Clear metrics and health checks
        this.metrics.clear();
        this.healthChecks.clear();
        this.initialized = false;
        this.log("SignatureProvider SDK disposed successfully");
      } catch (error) {
        this.log("Error during SDK disposal:", error);
        throw error;
      }
    });
  }
  /**
   * Get SDK configuration
   */
  getConfig() {
    return Object.assign({}, this.config);
  }
  /**
   * Update SDK configuration
   */
  updateConfig(newConfig) {
    this.config = Object.assign(Object.assign({}, this.config), newConfig);
    if (this.initialized) {
      this.log(
        "SDK configuration updated, some changes may require reinitialization"
      );
    }
  }
  /**
   * Check if SDK is initialized
   */
  isInitialized() {
    return this.initialized;
  }
  discoverAndInitializeProviders() {
    return __awaiter(this, void 0, void 0, function* () {
      this.log("Discovering available providers...");
      const discoveries = yield this.factory.discoverProviders();
      const availableProviders = discoveries.filter((d) => d.available);
      this.log(`Found ${availableProviders.length} available providers`);
      // Initialize default providers
      for (const providerType of this.config.defaultProviders) {
        const discovery = availableProviders.find(
          (d) => d.type === providerType
        );
        if (discovery) {
          try {
            yield this.createProvider(providerType);
            this.log(`Initialized default provider: ${providerType}`);
          } catch (error) {
            this.log(
              `Failed to initialize default provider ${providerType}:`,
              error
            );
          }
        }
      }
    });
  }
  setupMetricsCollection() {
    this.log("Setting up metrics collection...");
    // Listen to registry events for provider lifecycle
    this.registry.onProviderRegistered((providerId, provider) => {
      var _a;
      this.initializeProviderMetrics(providerId);
      // Setup provider-specific event listeners
      (_a = provider.onConnectionChange) === null || _a === void 0
        ? void 0
        : _a.call(provider, (connected) => {
            this.updateProviderMetrics(providerId, {
              connectionCount: connected ? 1 : 0,
            });
          });
    });
    this.registry.onProviderUnregistered((providerId) => {
      this.metrics.delete(providerId);
      this.healthChecks.delete(providerId);
    });
  }
  setupErrorRecovery() {
    this.log("Setting up error recovery...");
    // Error recovery is already configured globally
    // Additional setup could be added here if needed
  }
  initializeProviderMetrics(providerId) {
    if (!this.config.enableMetrics) {
      return;
    }
    const metrics = {
      providerId,
      connectionCount: 0,
      signatureCount: 0,
      errorCount: 0,
      averageSigningTime: 0,
      lastActivity: new Date(),
      uptime: 0,
    };
    this.metrics.set(providerId, metrics);
  }
  updateProviderMetrics(providerId, updates) {
    if (!this.config.enableMetrics) {
      return;
    }
    const existing = this.metrics.get(providerId);
    if (existing) {
      this.metrics.set(
        providerId,
        Object.assign(Object.assign({}, existing), updates)
      );
    }
  }
  performHealthCheck(providerId) {
    return __awaiter(this, void 0, void 0, function* () {
      var _a, _b;
      const provider = this.registry.getProvider(providerId);
      if (!provider) {
        const healthCheck = {
          providerId,
          healthy: false,
          connected: false,
          lastChecked: new Date(),
          capabilities: {
            supportedChains: [],
            supportsMultipleAccounts: false,
            requiresUserInteraction: false,
            supportsMessageSigning: false,
            maxConcurrentSignatures: 0,
          },
          errors: [new Error("Provider not found")],
        };
        this.healthChecks.set(providerId, healthCheck);
        return healthCheck;
      }
      const healthCheck = {
        providerId,
        healthy: true,
        connected: provider.isConnected(),
        lastChecked: new Date(),
        capabilities: provider.getCapabilities(),
        errors: [],
      };
      // Perform basic connectivity test
      try {
        if (!provider.isConnected()) {
          healthCheck.healthy = false;
          (_a = healthCheck.errors) === null || _a === void 0
            ? void 0
            : _a.push(new Error("Provider not connected"));
        }
      } catch (error) {
        healthCheck.healthy = false;
        (_b = healthCheck.errors) === null || _b === void 0
          ? void 0
          : _b.push(error instanceof Error ? error : new Error(String(error)));
      }
      this.healthChecks.set(providerId, healthCheck);
      return healthCheck;
    });
  }
  ensureInitialized() {
    if (!this.initialized) {
      throw new Error("SDK not initialized. Call initialize() first.");
    }
  }
  log(message, data) {
    if (this.config.enableLogging) {
      console.log(`[SignatureProviderSDK] ${message}`, data || "");
    }
  }
}
exports.SignatureProviderSDK = SignatureProviderSDK;
/**
 * Default SDK instance for convenience
 */
exports.signatureProviderSDK = new SignatureProviderSDK();
/**
 * Convenience functions for common SDK operations
 */
var SDKUtils;
(function (SDKUtils) {
  /**
   * Quick SDK initialization with default configuration
   */
  function initializeSDK(config) {
    return __awaiter(this, void 0, void 0, function* () {
      const sdk = new SignatureProviderSDK(config);
      yield sdk.initialize();
      return sdk;
    });
  }
  SDKUtils.initializeSDK = initializeSDK;
  /**
   * Create and initialize a provider quickly
   */
  function quickCreateProvider(type, config) {
    return __awaiter(this, void 0, void 0, function* () {
      if (!exports.signatureProviderSDK.isInitialized()) {
        yield exports.signatureProviderSDK.initialize();
      }
      return exports.signatureProviderSDK.createProvider(type, config);
    });
  }
  SDKUtils.quickCreateProvider = quickCreateProvider;
  /**
   * Get providers for chain with automatic SDK initialization
   */
  function getProvidersForChain(chainId) {
    return __awaiter(this, void 0, void 0, function* () {
      if (!exports.signatureProviderSDK.isInitialized()) {
        yield exports.signatureProviderSDK.initialize();
      }
      return exports.signatureProviderSDK.getProvidersForChain(chainId);
    });
  }
  SDKUtils.getProvidersForChain = getProvidersForChain;
  /**
   * Perform system health check
   */
  function performSystemHealthCheck() {
    return __awaiter(this, void 0, void 0, function* () {
      const sdkInitialized = exports.signatureProviderSDK.isInitialized();
      if (!sdkInitialized) {
        return {
          sdkInitialized: false,
          totalProviders: 0,
          healthyProviders: 0,
          healthChecks: [],
        };
      }
      const healthChecks =
        yield exports.signatureProviderSDK.performHealthChecks();
      const healthyProviders = healthChecks.filter((h) => h.healthy).length;
      return {
        sdkInitialized: true,
        totalProviders: healthChecks.length,
        healthyProviders,
        healthChecks,
      };
    });
  }
  SDKUtils.performSystemHealthCheck = performSystemHealthCheck;
  /**
   * Get system metrics summary
   */
  function getSystemMetrics() {
    if (!exports.signatureProviderSDK.isInitialized()) {
      return {
        totalProviders: 0,
        totalConnections: 0,
        totalSignatures: 0,
        totalErrors: 0,
        averageUptime: 0,
      };
    }
    const metrics = exports.signatureProviderSDK.getProviderMetrics();
    return {
      totalProviders: metrics.length,
      totalConnections: metrics.reduce((sum, m) => sum + m.connectionCount, 0),
      totalSignatures: metrics.reduce((sum, m) => sum + m.signatureCount, 0),
      totalErrors: metrics.reduce((sum, m) => sum + m.errorCount, 0),
      averageUptime:
        metrics.length > 0
          ? metrics.reduce((sum, m) => sum + m.uptime, 0) / metrics.length
          : 0,
    };
  }
  SDKUtils.getSystemMetrics = getSystemMetrics;
})(SDKUtils || (exports.SDKUtils = SDKUtils = {}));
/**
 * Type-safe SDK builder pattern
 */
class SignatureProviderSDKBuilder {
  constructor() {
    this.config = {};
  }
  withDefaultProviders(providers) {
    this.config.defaultProviders = providers;
    return this;
  }
  withAutoDiscovery(enabled = true) {
    this.config.autoDiscovery = enabled;
    return this;
  }
  withMetrics(enabled = true) {
    this.config.enableMetrics = enabled;
    return this;
  }
  withLogging(enabled = true) {
    this.config.enableLogging = enabled;
    return this;
  }
  withErrorRecovery(config) {
    this.config.errorRecovery = Object.assign(
      Object.assign({}, this.config.errorRecovery),
      config
    );
    return this;
  }
  withRegistry(config) {
    this.config.registry = Object.assign(
      Object.assign({}, this.config.registry),
      config
    );
    return this;
  }
  build() {
    return __awaiter(this, void 0, void 0, function* () {
      const sdk = new SignatureProviderSDK(this.config);
      yield sdk.initialize();
      return sdk;
    });
  }
}
exports.SignatureProviderSDKBuilder = SignatureProviderSDKBuilder;
/**
 * Create SDK builder
 */
function createSDKBuilder() {
  return new SignatureProviderSDKBuilder();
}
