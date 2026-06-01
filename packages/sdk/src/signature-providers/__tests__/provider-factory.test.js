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
const provider_factory_1 = require("../provider-factory");
const registry_1 = require("../registry");
const mock_provider_1 = require("../mock-provider");
const ledger_provider_1 = require("../ledger-provider");
const albedo_provider_1 = require("../albedo-provider");
const errors_1 = require("../errors");
describe("SignatureProviderFactory", () => {
  let factory;
  let registry;
  beforeEach(() => {
    factory = new provider_factory_1.SignatureProviderFactory({
      enableLogging: false,
    });
    registry = new registry_1.SignatureProviderRegistry();
  });
  afterEach(() =>
    __awaiter(void 0, void 0, void 0, function* () {
      yield factory.dispose();
    })
  );
  describe("Provider Creation", () => {
    it("should create mock provider", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const config = {
          type: provider_factory_1.ProviderType.MOCK,
          config: { enableLogging: true },
        };
        const provider = yield factory.createProvider(config);
        expect(provider).toBeInstanceOf(mock_provider_1.MockSignatureProvider);
        expect(provider.providerId).toBe("mock-provider");
      }));
    it("should create ledger provider", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const config = {
          type: provider_factory_1.ProviderType.LEDGER,
          config: { enableDebugLogging: true },
        };
        const provider = yield factory.createProvider(config);
        expect(provider).toBeInstanceOf(
          ledger_provider_1.LedgerSignatureProvider
        );
        expect(provider.providerId).toBe("ledger-provider");
      }));
    it("should create albedo provider", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const config = {
          type: provider_factory_1.ProviderType.ALBEDO,
          config: { enableDebugLogging: true },
        };
        const provider = yield factory.createProvider(config);
        expect(provider).toBeInstanceOf(
          albedo_provider_1.AlbedoSignatureProvider
        );
        expect(provider.providerId).toBe("albedo-provider");
      }));
    it("should throw error for unsupported provider type", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const config = {
          type: "unsupported",
        };
        yield expect(factory.createProvider(config)).rejects.toThrow(
          errors_1.SignatureProviderError
        );
      }));
    it("should auto-register provider when requested", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const config = { type: provider_factory_1.ProviderType.MOCK };
        const provider = yield factory.createProvider(config, {
          autoRegister: true,
          registry,
        });
        expect(registry.hasProvider(provider.providerId)).toBe(true);
      }));
    it("should auto-connect provider when requested", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const config = { type: provider_factory_1.ProviderType.MOCK };
        const provider = yield factory.createProvider(config, {
          autoConnect: true,
        });
        expect(provider.isConnected()).toBe(true);
      }));
    it("should handle connection failures with retry", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const config = {
          type: provider_factory_1.ProviderType.MOCK,
          config: { shouldFailConnection: true },
        };
        yield expect(
          factory.createProvider(config, {
            autoConnect: true,
            retries: 2,
            timeout: 1000,
          })
        ).rejects.toThrow(errors_1.ConnectionError);
      }));
  });
  describe("Multiple Provider Creation", () => {
    it("should create multiple providers", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const configs = [
          { type: provider_factory_1.ProviderType.MOCK },
          { type: provider_factory_1.ProviderType.LEDGER },
          { type: provider_factory_1.ProviderType.ALBEDO },
        ];
        const providers = yield factory.createProviders(configs);
        expect(providers).toHaveLength(3);
        expect(providers[0]).toBeInstanceOf(
          mock_provider_1.MockSignatureProvider
        );
        expect(providers[1]).toBeInstanceOf(
          ledger_provider_1.LedgerSignatureProvider
        );
        expect(providers[2]).toBeInstanceOf(
          albedo_provider_1.AlbedoSignatureProvider
        );
      }));
    it("should handle partial failures when not auto-connecting", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const configs = [
          { type: provider_factory_1.ProviderType.MOCK },
          { type: "invalid" },
        ];
        const providers = yield factory.createProviders(configs, {
          autoConnect: false,
        });
        expect(providers).toHaveLength(1);
        expect(providers[0]).toBeInstanceOf(
          mock_provider_1.MockSignatureProvider
        );
      }));
    it("should throw error when all providers fail", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const configs = [{ type: "invalid1" }, { type: "invalid2" }];
        yield expect(
          factory.createProviders(configs, { autoConnect: false })
        ).rejects.toThrow(errors_1.SignatureProviderError);
      }));
  });
  describe("Provider Discovery", () => {
    it("should discover available providers", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const discoveries = yield factory.discoverProviders();
        expect(discoveries).toHaveLength(3);
        const mockDiscovery = discoveries.find(
          (d) => d.type === provider_factory_1.ProviderType.MOCK
        );
        expect(
          mockDiscovery === null || mockDiscovery === void 0
            ? void 0
            : mockDiscovery.available
        ).toBe(true);
        const ledgerDiscovery = discoveries.find(
          (d) => d.type === provider_factory_1.ProviderType.LEDGER
        );
        expect(
          ledgerDiscovery === null || ledgerDiscovery === void 0
            ? void 0
            : ledgerDiscovery.available
        ).toBe(true);
        // Albedo might not be available in test environment
        const albedoDiscovery = discoveries.find(
          (d) => d.type === provider_factory_1.ProviderType.ALBEDO
        );
        expect(albedoDiscovery).toBeDefined();
      }));
    it("should use cache on subsequent discovery calls", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const discoveries1 = yield factory.discoverProviders();
        const discoveries2 = yield factory.discoverProviders(true);
        expect(discoveries1).toEqual(discoveries2);
      }));
    it("should bypass cache when requested", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield factory.discoverProviders();
        const discoveries = yield factory.discoverProviders(false);
        expect(discoveries).toBeDefined();
      }));
    it("should clear discovery cache", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield factory.discoverProviders();
        factory.clearDiscoveryCache();
        // Should rediscover
        const discoveries = yield factory.discoverProviders();
        expect(discoveries).toBeDefined();
      }));
  });
  describe("Chain-Specific Provider Creation", () => {
    it("should create providers for Bitcoin", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const providers = yield factory.createProvidersForChain(
          types_1.ChainId.BITCOIN
        );
        expect(providers.length).toBeGreaterThan(0);
        providers.forEach((provider) => {
          expect(provider.getCapabilities().supportedChains).toContain(
            types_1.ChainId.BITCOIN
          );
        });
      }));
    it("should create providers for Stellar", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const providers = yield factory.createProvidersForChain(
          types_1.ChainId.STELLAR
        );
        expect(providers.length).toBeGreaterThan(0);
        providers.forEach((provider) => {
          expect(provider.getCapabilities().supportedChains).toContain(
            types_1.ChainId.STELLAR
          );
        });
      }));
    it("should create providers for Starknet", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const providers = yield factory.createProvidersForChain(
          types_1.ChainId.STARKNET
        );
        expect(providers.length).toBeGreaterThan(0);
        providers.forEach((provider) => {
          expect(provider.getCapabilities().supportedChains).toContain(
            types_1.ChainId.STARKNET
          );
        });
      }));
    it("should throw error for unsupported chain", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield expect(
          factory.createProvidersForChain("unsupported-chain")
        ).rejects.toThrow(errors_1.UnsupportedChainError);
      }));
  });
  describe("Best Provider Selection", () => {
    it("should select best provider for chain", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const provider = yield factory.getBestProviderForChain(
          types_1.ChainId.STELLAR
        );
        expect(provider).toBeDefined();
        expect(provider.getCapabilities().supportedChains).toContain(
          types_1.ChainId.STELLAR
        );
      }));
    it("should prefer hardware wallet when requested", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const provider = yield factory.getBestProviderForChain(
          types_1.ChainId.BITCOIN,
          {
            preferHardwareWallet: true,
          }
        );
        expect(provider).toBeDefined();
        // In our test setup, Ledger would be preferred for hardware wallet
      }));
    it("should prefer browser extension when requested", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const provider = yield factory.getBestProviderForChain(
          types_1.ChainId.STELLAR,
          {
            preferBrowserExtension: true,
          }
        );
        expect(provider).toBeDefined();
      }));
  });
  describe("Provider Instance Management", () => {
    it("should store and retrieve provider instances", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const config = { type: provider_factory_1.ProviderType.MOCK };
        const provider = yield factory.createProvider(config);
        const retrieved = factory.getProvider(provider.providerId);
        expect(retrieved).toBe(provider);
      }));
    it("should return undefined for non-existent provider", () => {
      const provider = factory.getProvider("non-existent");
      expect(provider).toBeUndefined();
    });
  });
  describe("Factory Disposal", () => {
    it("should dispose of all providers", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const configs = [
          { type: provider_factory_1.ProviderType.MOCK },
          { type: provider_factory_1.ProviderType.LEDGER },
        ];
        const providers = yield factory.createProviders(configs, {
          autoConnect: true,
        });
        expect(providers.every((p) => p.isConnected())).toBe(true);
        yield factory.dispose();
        expect(providers.every((p) => !p.isConnected())).toBe(true);
      }));
    it("should handle disposal errors gracefully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const config = { type: provider_factory_1.ProviderType.MOCK };
        const provider = yield factory.createProvider(config, {
          autoConnect: true,
        });
        // Mock a disconnect error
        const originalDisconnect = provider.disconnect;
        provider.disconnect = jest
          .fn()
          .mockRejectedValue(new Error("Disconnect failed"));
        // Should not throw
        yield expect(factory.dispose()).resolves.toBeUndefined();
        // Restore original method
        provider.disconnect = originalDisconnect;
      }));
  });
  describe("Global Factory Instance", () => {
    it("should provide global factory instance", () => {
      expect(provider_factory_1.signatureProviderFactory).toBeInstanceOf(
        provider_factory_1.SignatureProviderFactory
      );
    });
  });
  describe("Error Handling", () => {
    it("should handle provider creation errors", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Mock a provider that throws during construction
        const originalCreateMock = factory.createMockProvider;
        factory.createMockProvider = jest.fn(() => {
          throw new Error("Mock creation failed");
        });
        const config = { type: provider_factory_1.ProviderType.MOCK };
        yield expect(factory.createProvider(config)).rejects.toThrow(
          errors_1.SignatureProviderError
        );
        // Restore original method
        factory.createMockProvider = originalCreateMock;
      }));
    it("should handle connection timeout", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const config = {
          type: provider_factory_1.ProviderType.MOCK,
          config: { connectionDelay: 2000 }, // Longer than timeout
        };
        yield expect(
          factory.createProvider(config, {
            autoConnect: true,
            timeout: 500, // Short timeout
            retries: 1,
          })
        ).rejects.toThrow(errors_1.ConnectionError);
      }));
  });
});
describe("ProviderUtils", () => {
  afterEach(() =>
    __awaiter(void 0, void 0, void 0, function* () {
      yield provider_factory_1.signatureProviderFactory.dispose();
    })
  );
  describe("Convenience Methods", () => {
    it("should create and connect provider", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const provider =
          yield provider_factory_1.ProviderUtils.createAndConnect(
            provider_factory_1.ProviderType.MOCK
          );
        expect(provider).toBeInstanceOf(mock_provider_1.MockSignatureProvider);
        expect(provider.isConnected()).toBe(true);
      }));
    it("should get providers for chain", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const providers =
          yield provider_factory_1.ProviderUtils.getProvidersForChain(
            types_1.ChainId.STELLAR
          );
        expect(providers.length).toBeGreaterThan(0);
        providers.forEach((provider) => {
          expect(provider.getCapabilities().supportedChains).toContain(
            types_1.ChainId.STELLAR
          );
        });
      }));
    it("should get best provider", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const provider = yield provider_factory_1.ProviderUtils.getBestProvider(
          types_1.ChainId.BITCOIN
        );
        expect(provider).toBeDefined();
        expect(provider.getCapabilities().supportedChains).toContain(
          types_1.ChainId.BITCOIN
        );
      }));
    it("should discover all providers", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const discoveries =
          yield provider_factory_1.ProviderUtils.discoverAll();
        expect(discoveries).toHaveLength(3);
        expect(
          discoveries.some(
            (d) => d.type === provider_factory_1.ProviderType.MOCK
          )
        ).toBe(true);
        expect(
          discoveries.some(
            (d) => d.type === provider_factory_1.ProviderType.LEDGER
          )
        ).toBe(true);
        expect(
          discoveries.some(
            (d) => d.type === provider_factory_1.ProviderType.ALBEDO
          )
        ).toBe(true);
      }));
    it("should create mock provider for testing", () => {
      const provider = provider_factory_1.ProviderUtils.createMockProvider({
        enableLogging: true,
      });
      expect(provider).toBeInstanceOf(mock_provider_1.MockSignatureProvider);
      expect(provider.providerId).toBe("test-mock-provider");
    });
  });
  describe("Error Scenarios", () => {
    it("should handle connection failures", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield expect(
          provider_factory_1.ProviderUtils.createAndConnect(
            provider_factory_1.ProviderType.MOCK,
            {
              shouldFailConnection: true,
            }
          )
        ).rejects.toThrow(errors_1.ConnectionError);
      }));
    it("should handle unsupported chains", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield expect(
          provider_factory_1.ProviderUtils.getProvidersForChain("unsupported")
        ).rejects.toThrow(errors_1.UnsupportedChainError);
      }));
  });
});
