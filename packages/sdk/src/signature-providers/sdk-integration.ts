/**
 * @fileoverview SDK Integration utilities for SignatureProvider system
 * @module SignatureProviders/SDKIntegration
 */

import { ChainId } from "../types";
import {
  SignatureProvider,
  SignatureProviderRegistry,
  signatureProviderRegistry,
  SignatureProviderFactory,
  signatureProviderFactory,
  MultiSignatureCoordinator,
  SignatureProviderErrorRecovery,
  signatureProviderErrorRecovery,
  ProviderType,
  ProviderConfig,
  TransactionWorkflowEngine,
} from "./index";
import {
  SignatureProviderSDKConfig,
  SignatureProviderContext,
  ProviderHealthCheck,
  ProviderMetrics,
  BatchOperationResult,
} from "./types";

/**
 * Main SDK class for SignatureProvider system integration
 */
export class SignatureProviderSDK {
  private config: Required<SignatureProviderSDKConfig>;
  private registry: SignatureProviderRegistry;
  private factory: SignatureProviderFactory;
  private coordinator: MultiSignatureCoordinator;
  private workflowEngine: TransactionWorkflowEngine;
  private errorRecovery: SignatureProviderErrorRecovery;
  private metrics: Map<string, ProviderMetrics> = new Map();
  private healthChecks: Map<string, ProviderHealthCheck> = new Map();
  private initialized = false;

  constructor(config: SignatureProviderSDKConfig = {}) {
    this.config = {
      defaultProviders: config.defaultProviders || [ProviderType.MOCK],
      autoDiscovery: config.autoDiscovery ?? true,
      enableMetrics: config.enableMetrics ?? false,
      enableLogging: config.enableLogging ?? false,
      connectionTimeout: config.connectionTimeout ?? 5000,
      maxRetries: config.maxRetries ?? 3,
      errorRecovery: {
        enabled: config.errorRecovery?.enabled ?? true,
        maxRetries: config.errorRecovery?.maxRetries ?? 3,
        retryDelay: config.errorRecovery?.retryDelay ?? 1000,
      },
      registry: {
        autoRegister: config.registry?.autoRegister ?? true,
        validateProviders: config.registry?.validateProviders ?? true,
      },
    };

    this.registry = signatureProviderRegistry;
    this.factory = signatureProviderFactory;
    this.coordinator = new MultiSignatureCoordinator();
    this.errorRecovery = signatureProviderErrorRecovery;
    this.workflowEngine = new TransactionWorkflowEngine(this.registry, this.factory);
  }

  /**
   * Initialize the SDK
   */
  async initialize(): Promise<void> {
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
        await this.discoverAndInitializeProviders();
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
  }

  /**
   * Get the SDK context for dependency injection
   */
  getContext(): SignatureProviderContext {
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
  async createProvider(
    type: ProviderType,
    config?: Record<string, unknown>
  ): Promise<SignatureProvider> {
    this.ensureInitialized();

    const provider = await this.factory.createProvider(
      { type, config } as unknown as ProviderConfig,
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
    await this.performHealthCheck(provider.providerId);

    return provider;
  }

  /**
   * Get all available providers
   */
  getProviders(): SignatureProvider[] {
    this.ensureInitialized();
    return this.registry.listProviders();
  }

  /**
   * Get providers for specific chain
   */
  getProvidersForChain(chainId: ChainId): SignatureProvider[] {
    this.ensureInitialized();
    return this.registry.findProvidersForChain(chainId);
  }

  /**
   * Get the best provider for a chain
   */
  async getBestProvider(chainId: ChainId): Promise<SignatureProvider> {
    this.ensureInitialized();
    return this.factory.getBestProviderForChain(chainId);
  }

  /**
   * Perform health checks on all providers
   */
  async performHealthChecks(): Promise<ProviderHealthCheck[]> {
    this.ensureInitialized();

    const providers = this.registry.listProviders();
    const healthChecks: ProviderHealthCheck[] = [];

    for (const provider of providers) {
      const healthCheck = await this.performHealthCheck(provider.providerId);
      healthChecks.push(healthCheck);
    }

    return healthChecks;
  }

  /**
   * Get provider metrics
   */
  getProviderMetrics(providerId?: string): ProviderMetrics[] {
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
  getProviderHealth(providerId?: string): ProviderHealthCheck[] {
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
  async batchCreateProviders(
    configs: Array<{ type: ProviderType; config?: Record<string, unknown> }>
  ): Promise<BatchOperationResult<SignatureProvider>> {
    this.ensureInitialized();

    const startTime = Date.now();
    const successful: SignatureProvider[] = [];
    const failed: Array<{ error: Error; input?: unknown }> = [];

    for (const config of configs) {
      try {
        const provider = await this.createProvider(config.type, config.config);
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
  }

  /**
   * Dispose of the SDK and cleanup resources
   */
  async dispose(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.log("Disposing SignatureProvider SDK...");

    try {
      // Dispose factory (disconnects all providers)
      await this.factory.dispose();

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
  }

  /**
   * Get SDK configuration
   */
  getConfig(): Required<SignatureProviderSDKConfig> {
    return { ...this.config };
  }

  /**
   * Update SDK configuration
   */
  updateConfig(newConfig: Partial<SignatureProviderSDKConfig>): void {
    this.config = { ...this.config, ...newConfig };

    if (this.initialized) {
      this.log(
        "SDK configuration updated, some changes may require reinitialization"
      );
    }
  }

  /**
   * Check if SDK is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  private async discoverAndInitializeProviders(): Promise<void> {
    this.log("Discovering available providers...");

    const discoveries = await this.factory.discoverProviders();
    const availableProviders = discoveries.filter((d) => d.available);

    this.log(`Found ${availableProviders.length} available providers`);

    // Initialize default providers
    for (const providerType of this.config.defaultProviders) {
      const discovery = availableProviders.find((d) => d.type === providerType);
      if (discovery) {
        try {
          await this.createProvider(providerType);
          this.log(`Initialized default provider: ${providerType}`);
        } catch (error) {
          this.log(
            `Failed to initialize default provider ${providerType}:`,
            error
          );
        }
      }
    }
  }

  private setupMetricsCollection(): void {
    this.log("Setting up metrics collection...");

    // Listen to registry events for provider lifecycle
    this.registry.onProviderRegistered((providerId, provider) => {
      this.initializeProviderMetrics(providerId);

      // Setup provider-specific event listeners
      provider.onConnectionChange?.((connected) => {
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

  private setupErrorRecovery(): void {
    this.log("Setting up error recovery...");
    // Error recovery is already configured globally
    // Additional setup could be added here if needed
  }

  private initializeProviderMetrics(providerId: string): void {
    if (!this.config.enableMetrics) {
      return;
    }

    const metrics: ProviderMetrics = {
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

  private updateProviderMetrics(
    providerId: string,
    updates: Partial<ProviderMetrics>
  ): void {
    if (!this.config.enableMetrics) {
      return;
    }

    const existing = this.metrics.get(providerId);
    if (existing) {
      this.metrics.set(providerId, { ...existing, ...updates });
    }
  }

  private async performHealthCheck(
    providerId: string
  ): Promise<ProviderHealthCheck> {
    const provider = this.registry.getProvider(providerId);

    if (!provider) {
      const healthCheck: ProviderHealthCheck = {
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

    const healthCheck: ProviderHealthCheck = {
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
        healthCheck.errors?.push(new Error("Provider not connected"));
      }
    } catch (error) {
      healthCheck.healthy = false;
      healthCheck.errors?.push(
        error instanceof Error ? error : new Error(String(error))
      );
    }

    this.healthChecks.set(providerId, healthCheck);
    return healthCheck;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("SDK not initialized. Call initialize() first.");
    }
  }

  private log(message: string, data?: unknown): void {
    if (this.config.enableLogging) {
      console.log(`[SignatureProviderSDK] ${message}`, data || "");
    }
  }
}

/**
 * Default SDK instance for convenience
 */
export const signatureProviderSDK = new SignatureProviderSDK();

/**
 * Convenience functions for common SDK operations
 */
export namespace SDKUtils {
  /**
   * Quick SDK initialization with default configuration
   */
  export async function initializeSDK(
    config?: SignatureProviderSDKConfig
  ): Promise<SignatureProviderSDK> {
    const sdk = new SignatureProviderSDK(config);
    await sdk.initialize();
    return sdk;
  }

  /**
   * Create and initialize a provider quickly
   */
  export async function quickCreateProvider(
    type: ProviderType,
    config?: Record<string, unknown>
  ): Promise<SignatureProvider> {
    if (!signatureProviderSDK.isInitialized()) {
      await signatureProviderSDK.initialize();
    }
    return signatureProviderSDK.createProvider(type, config);
  }

  /**
   * Get providers for chain with automatic SDK initialization
   */
  export async function getProvidersForChain(
    chainId: ChainId
  ): Promise<SignatureProvider[]> {
    if (!signatureProviderSDK.isInitialized()) {
      await signatureProviderSDK.initialize();
    }
    return signatureProviderSDK.getProvidersForChain(chainId);
  }

  /**
   * Perform system health check
   */
  export async function performSystemHealthCheck(): Promise<{
    sdkInitialized: boolean;
    totalProviders: number;
    healthyProviders: number;
    healthChecks: ProviderHealthCheck[];
  }> {
    const sdkInitialized = signatureProviderSDK.isInitialized();

    if (!sdkInitialized) {
      return {
        sdkInitialized: false,
        totalProviders: 0,
        healthyProviders: 0,
        healthChecks: [],
      };
    }

    const healthChecks = await signatureProviderSDK.performHealthChecks();
    const healthyProviders = healthChecks.filter((h) => h.healthy).length;

    return {
      sdkInitialized: true,
      totalProviders: healthChecks.length,
      healthyProviders,
      healthChecks,
    };
  }

  /**
   * Get system metrics summary
   */
  export function getSystemMetrics(): {
    totalProviders: number;
    totalConnections: number;
    totalSignatures: number;
    totalErrors: number;
    averageUptime: number;
  } {
    if (!signatureProviderSDK.isInitialized()) {
      return {
        totalProviders: 0,
        totalConnections: 0,
        totalSignatures: 0,
        totalErrors: 0,
        averageUptime: 0,
      };
    }

    const metrics = signatureProviderSDK.getProviderMetrics();

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
}

/**
 * Type-safe SDK builder pattern
 */
export class SignatureProviderSDKBuilder {
  private config: SignatureProviderSDKConfig = {};

  withDefaultProviders(providers: ProviderType[]): this {
    this.config.defaultProviders = providers;
    return this;
  }

  withAutoDiscovery(enabled: boolean = true): this {
    this.config.autoDiscovery = enabled;
    return this;
  }

  withMetrics(enabled: boolean = true): this {
    this.config.enableMetrics = enabled;
    return this;
  }

  withLogging(enabled: boolean = true): this {
    this.config.enableLogging = enabled;
    return this;
  }

  withErrorRecovery(config: {
    enabled?: boolean;
    maxRetries?: number;
    retryDelay?: number;
  }): this {
    this.config.errorRecovery = {
      enabled: config.enabled ?? this.config.errorRecovery?.enabled ?? true,
      maxRetries: config.maxRetries ?? this.config.errorRecovery?.maxRetries ?? 3,
      retryDelay: config.retryDelay ?? this.config.errorRecovery?.retryDelay ?? 1000,
    };
    return this;
  }

  withRegistry(config: {
    autoRegister?: boolean;
    validateProviders?: boolean;
  }): this {
    this.config.registry = { ...this.config.registry, ...config };
    return this;
  }

  async build(): Promise<SignatureProviderSDK> {
    const sdk = new SignatureProviderSDK(this.config);
    await sdk.initialize();
    return sdk;
  }
}

/**
 * Create SDK builder
 */
export function createSDKBuilder(): SignatureProviderSDKBuilder {
  return new SignatureProviderSDKBuilder();
}
