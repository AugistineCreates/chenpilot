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
const types_1 = require("../../types");
const sdk_integration_1 = require("../sdk-integration");
const types_2 = require("../types");
const mock_provider_1 = require("../mock-provider");
describe("SignatureProvider SDK Integration", () => {
  let sdk;
  beforeEach(() => {
    sdk = new sdk_integration_1.SignatureProviderSDK({
      enableLogging: false,
      enableMetrics: true,
      autoDiscovery: false, // Disable for controlled testing
    });
  });
  afterEach(() =>
    __awaiter(void 0, void 0, void 0, function* () {
      if (sdk.isInitialized()) {
        yield sdk.dispose();
      }
    })
  );
  describe("SDK Initialization", () => {
    it("should initialize SDK with default configuration", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        expect(sdk.isInitialized()).toBe(false);
        yield sdk.initialize();
        expect(sdk.isInitialized()).toBe(true);
      }));
    it("should initialize SDK with custom configuration", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const customSDK = new sdk_integration_1.SignatureProviderSDK({
          defaultProviders: [
            types_2.ProviderType.MOCK,
            types_2.ProviderType.LEDGER,
          ],
          enableMetrics: true,
          enableLogging: true,
          autoDiscovery: false,
        });
        yield customSDK.initialize();
        expect(customSDK.isInitialized()).toBe(true);
        const config = customSDK.getConfig();
        expect(config.defaultProviders).toEqual([
          types_2.ProviderType.MOCK,
          types_2.ProviderType.LEDGER,
        ]);
        expect(config.enableMetrics).toBe(true);
        expect(config.enableLogging).toBe(true);
        yield customSDK.dispose();
      }));
    it("should not reinitialize if already initialized", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield sdk.initialize();
        expect(sdk.isInitialized()).toBe(true);
        // Should not throw or cause issues
        yield sdk.initialize();
        expect(sdk.isInitialized()).toBe(true);
      }));
    it("should throw error when using uninitialized SDK", () => {
      expect(() => sdk.getProviders()).toThrow("SDK not initialized");
    });
  });
  describe("Provider Management", () => {
    beforeEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield sdk.initialize();
      })
    );
    it("should create providers through SDK", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const provider = yield sdk.createProvider(types_2.ProviderType.MOCK);
        expect(provider).toBeInstanceOf(mock_provider_1.MockSignatureProvider);
        expect(provider.isConnected()).toBe(true);
        const providers = sdk.getProviders();
        expect(providers).toContain(provider);
      }));
    it("should get providers for specific chain", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield sdk.createProvider(types_2.ProviderType.MOCK);
        yield sdk.createProvider(types_2.ProviderType.LEDGER);
        const stellarProviders = sdk.getProvidersForChain(
          types_1.ChainId.STELLAR
        );
        expect(stellarProviders.length).toBeGreaterThan(0);
        stellarProviders.forEach((provider) => {
          expect(provider.getCapabilities().supportedChains).toContain(
            types_1.ChainId.STELLAR
          );
        });
      }));
    it("should get best provider for chain", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield sdk.createProvider(types_2.ProviderType.MOCK);
        yield sdk.createProvider(types_2.ProviderType.LEDGER);
        const bestProvider = yield sdk.getBestProvider(types_1.ChainId.BITCOIN);
        expect(bestProvider).toBeDefined();
        expect(bestProvider.getCapabilities().supportedChains).toContain(
          types_1.ChainId.BITCOIN
        );
      }));
    it("should batch create providers", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const configs = [
          { type: types_2.ProviderType.MOCK },
          { type: types_2.ProviderType.LEDGER },
          { type: types_2.ProviderType.ALBEDO },
        ];
        const result = yield sdk.batchCreateProviders(configs);
        expect(result.totalCount).toBe(3);
        expect(result.successCount).toBe(3);
        expect(result.failureCount).toBe(0);
        expect(result.successful.length).toBe(3);
        expect(result.duration).toBeGreaterThan(0);
      }));
    it("should handle batch creation failures", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const configs = [
          { type: types_2.ProviderType.MOCK },
          { type: "invalid" },
        ];
        const result = yield sdk.batchCreateProviders(configs);
        expect(result.totalCount).toBe(2);
        expect(result.successCount).toBe(1);
        expect(result.failureCount).toBe(1);
        expect(result.failed.length).toBe(1);
      }));
  });
  describe("Health Checks and Metrics", () => {
    beforeEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield sdk.initialize();
      })
    );
    it("should perform health checks on providers", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const provider = yield sdk.createProvider(types_2.ProviderType.MOCK);
        const healthChecks = yield sdk.performHealthChecks();
        expect(healthChecks.length).toBe(1);
        expect(healthChecks[0].providerId).toBe(provider.providerId);
        expect(healthChecks[0].healthy).toBe(true);
        expect(healthChecks[0].connected).toBe(true);
        expect(healthChecks[0].capabilities).toBeDefined();
      }));
    it("should track provider metrics", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const provider = yield sdk.createProvider(types_2.ProviderType.MOCK);
        const metrics = sdk.getProviderMetrics(provider.providerId);
        expect(metrics.length).toBe(1);
        expect(metrics[0].providerId).toBe(provider.providerId);
        expect(metrics[0].connectionCount).toBeDefined();
        expect(metrics[0].signatureCount).toBeDefined();
      }));
    it("should get all provider metrics", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield sdk.createProvider(types_2.ProviderType.MOCK);
        yield sdk.createProvider(types_2.ProviderType.LEDGER);
        const allMetrics = sdk.getProviderMetrics();
        expect(allMetrics.length).toBe(2);
      }));
    it("should get provider health status", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const provider = yield sdk.createProvider(types_2.ProviderType.MOCK);
        const healthStatus = sdk.getProviderHealth(provider.providerId);
        expect(healthStatus.length).toBe(1);
        expect(healthStatus[0].providerId).toBe(provider.providerId);
        expect(healthStatus[0].healthy).toBe(true);
      }));
  });
  describe("SDK Context", () => {
    beforeEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield sdk.initialize();
      })
    );
    it("should provide SDK context for dependency injection", () => {
      const context = sdk.getContext();
      expect(context.registry).toBeDefined();
      expect(context.factory).toBeDefined();
      expect(context.coordinator).toBeDefined();
      expect(context.errorRecovery).toBeDefined();
    });
  });
  describe("Configuration Management", () => {
    it("should get and update configuration", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield sdk.initialize();
        const originalConfig = sdk.getConfig();
        expect(originalConfig.enableMetrics).toBe(true);
        sdk.updateConfig({ enableMetrics: false });
        const updatedConfig = sdk.getConfig();
        expect(updatedConfig.enableMetrics).toBe(false);
      }));
  });
  describe("SDK Disposal", () => {
    it("should dispose SDK and cleanup resources", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield sdk.initialize();
        yield sdk.createProvider(types_2.ProviderType.MOCK);
        expect(sdk.isInitialized()).toBe(true);
        expect(sdk.getProviders().length).toBe(1);
        yield sdk.dispose();
        expect(sdk.isInitialized()).toBe(false);
      }));
    it("should handle disposal of uninitialized SDK", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        expect(sdk.isInitialized()).toBe(false);
        // Should not throw
        yield expect(sdk.dispose()).resolves.toBeUndefined();
      }));
  });
  describe("Global SDK Instance", () => {
    afterEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        if (sdk_integration_1.signatureProviderSDK.isInitialized()) {
          yield sdk_integration_1.signatureProviderSDK.dispose();
        }
      })
    );
    it("should provide global SDK instance", () => {
      expect(sdk_integration_1.signatureProviderSDK).toBeInstanceOf(
        sdk_integration_1.SignatureProviderSDK
      );
    });
    it("should work with global instance", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield sdk_integration_1.signatureProviderSDK.initialize();
        const provider =
          yield sdk_integration_1.signatureProviderSDK.createProvider(
            types_2.ProviderType.MOCK
          );
        expect(provider).toBeDefined();
        const providers = sdk_integration_1.signatureProviderSDK.getProviders();
        expect(providers).toContain(provider);
      }));
  });
});
describe("SDK Utils", () => {
  afterEach(() =>
    __awaiter(void 0, void 0, void 0, function* () {
      if (sdk_integration_1.signatureProviderSDK.isInitialized()) {
        yield sdk_integration_1.signatureProviderSDK.dispose();
      }
    })
  );
  describe("Convenience Functions", () => {
    it("should initialize SDK with default configuration", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const sdk = yield sdk_integration_1.SDKUtils.initializeSDK({
          enableLogging: false,
          autoDiscovery: false,
        });
        expect(sdk.isInitialized()).toBe(true);
        yield sdk.dispose();
      }));
    it("should quickly create provider", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const provider = yield sdk_integration_1.SDKUtils.quickCreateProvider(
          types_2.ProviderType.MOCK
        );
        expect(provider).toBeInstanceOf(mock_provider_1.MockSignatureProvider);
        expect(sdk_integration_1.signatureProviderSDK.isInitialized()).toBe(
          true
        );
      }));
    it("should get providers for chain with auto-initialization", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Create a provider first
        yield sdk_integration_1.SDKUtils.quickCreateProvider(
          types_2.ProviderType.MOCK
        );
        const providers = yield sdk_integration_1.SDKUtils.getProvidersForChain(
          types_1.ChainId.STELLAR
        );
        expect(providers.length).toBeGreaterThan(0);
      }));
    it("should perform system health check", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const healthCheck =
          yield sdk_integration_1.SDKUtils.performSystemHealthCheck();
        expect(healthCheck.sdkInitialized).toBe(false);
        expect(healthCheck.totalProviders).toBe(0);
        // Initialize and add provider
        yield sdk_integration_1.SDKUtils.quickCreateProvider(
          types_2.ProviderType.MOCK
        );
        const healthCheckAfter =
          yield sdk_integration_1.SDKUtils.performSystemHealthCheck();
        expect(healthCheckAfter.sdkInitialized).toBe(true);
        expect(healthCheckAfter.totalProviders).toBe(1);
        expect(healthCheckAfter.healthyProviders).toBe(1);
      }));
    it("should get system metrics", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const metricsEmpty = sdk_integration_1.SDKUtils.getSystemMetrics();
        expect(metricsEmpty.totalProviders).toBe(0);
        expect(metricsEmpty.totalConnections).toBe(0);
        // Initialize SDK with metrics enabled
        const sdk = yield sdk_integration_1.SDKUtils.initializeSDK({
          enableMetrics: true,
        });
        yield sdk.createProvider(types_2.ProviderType.MOCK);
        const metricsWithProvider =
          sdk_integration_1.SDKUtils.getSystemMetrics();
        expect(metricsWithProvider.totalProviders).toBe(1);
        yield sdk.dispose();
      }));
  });
});
describe("SDK Builder", () => {
  it("should build SDK with fluent interface", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const sdk = yield (0, sdk_integration_1.createSDKBuilder)()
        .withDefaultProviders([types_2.ProviderType.MOCK])
        .withAutoDiscovery(false)
        .withMetrics(true)
        .withLogging(false)
        .withErrorRecovery({
          enabled: true,
          maxRetries: 5,
          retryDelay: 2000,
        })
        .withRegistry({
          autoRegister: true,
          validateProviders: true,
        })
        .build();
      expect(sdk.isInitialized()).toBe(true);
      const config = sdk.getConfig();
      expect(config.defaultProviders).toEqual([types_2.ProviderType.MOCK]);
      expect(config.autoDiscovery).toBe(false);
      expect(config.enableMetrics).toBe(true);
      expect(config.enableLogging).toBe(false);
      expect(config.errorRecovery.maxRetries).toBe(5);
      expect(config.errorRecovery.retryDelay).toBe(2000);
      yield sdk.dispose();
    }));
  it("should create builder instance", () => {
    const builder = (0, sdk_integration_1.createSDKBuilder)();
    expect(builder).toBeInstanceOf(
      sdk_integration_1.SignatureProviderSDKBuilder
    );
  });
});
describe("Error Handling", () => {
  let sdk;
  beforeEach(() => {
    sdk = new sdk_integration_1.SignatureProviderSDK({
      enableLogging: false,
      autoDiscovery: false,
    });
  });
  afterEach(() =>
    __awaiter(void 0, void 0, void 0, function* () {
      if (sdk.isInitialized()) {
        yield sdk.dispose();
      }
    })
  );
  it("should handle initialization errors gracefully", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      // Mock an initialization error
      const originalInitialize = sdk.initialize;
      sdk.initialize = jest.fn().mockRejectedValue(new Error("Init failed"));
      yield expect(sdk.initialize()).rejects.toThrow("Init failed");
      expect(sdk.isInitialized()).toBe(false);
      // Restore original method
      sdk.initialize = originalInitialize;
    }));
  it("should handle provider creation errors", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      yield sdk.initialize();
      // Try to create invalid provider type
      yield expect(sdk.createProvider("invalid")).rejects.toThrow();
    }));
  it("should handle disposal errors gracefully", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      yield sdk.initialize();
      // Mock disposal error
      const originalDispose = sdk.factory.dispose;
      sdk.factory.dispose = jest
        .fn()
        .mockRejectedValue(new Error("Disposal failed"));
      yield expect(sdk.dispose()).rejects.toThrow("Disposal failed");
      // Restore original method
      sdk.factory.dispose = originalDispose;
    }));
});
