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
const mock_provider_1 = require("../mock-provider");
const ledger_provider_1 = require("../ledger-provider");
describe("SignatureProviderFactory - Basic Functionality", () => {
  let factory;
  beforeEach(() => {
    factory = new provider_factory_1.SignatureProviderFactory({
      enableLogging: false,
    });
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
    it("should auto-connect provider when requested", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const config = { type: provider_factory_1.ProviderType.MOCK };
        const provider = yield factory.createProvider(config, {
          autoConnect: true,
        });
        expect(provider.isConnected()).toBe(true);
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
  });
  describe("Global Factory Instance", () => {
    it("should provide global factory instance", () => {
      expect(provider_factory_1.signatureProviderFactory).toBeInstanceOf(
        provider_factory_1.SignatureProviderFactory
      );
    });
  });
});
describe("ProviderUtils - Basic Functionality", () => {
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
});
