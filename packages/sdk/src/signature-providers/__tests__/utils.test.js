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
const utils_1 = require("../utils");
const interfaces_1 = require("../interfaces");
const errors_1 = require("../errors");
// Mock provider for testing
class TestProvider extends interfaces_1.BaseSignatureProvider {
  constructor(providerId, metadata, capabilities) {
    super(providerId, metadata);
    this.mockConnected = false;
    this.mockCapabilities = capabilities;
  }
  connect() {
    return __awaiter(this, void 0, void 0, function* () {
      this.mockConnected = true;
      return { isConnected: true, connectionId: "test" };
    });
  }
  disconnect() {
    return __awaiter(this, void 0, void 0, function* () {
      this.mockConnected = false;
    });
  }
  isConnected() {
    return this.mockConnected;
  }
  getAccounts(_chainId) {
    return __awaiter(this, void 0, void 0, function* () {
      void _chainId;
      return [];
    });
  }
  signTransaction(_request) {
    return __awaiter(this, void 0, void 0, function* () {
      void _request;
      return { signature: "test", publicKey: "test" };
    });
  }
  getCapabilities() {
    return this.mockCapabilities;
  }
}
describe("SignatureProviderUtils", () => {
  let stellarProvider;
  let multiChainProvider;
  let bitcoinProvider;
  beforeEach(() => {
    stellarProvider = new TestProvider(
      "stellar-provider",
      {
        name: "Stellar Provider",
        version: "1.0.0",
        description: "Stellar only",
      },
      {
        supportedChains: [types_1.ChainId.STELLAR],
        supportsMultipleAccounts: true,
        requiresUserInteraction: true,
        supportsMessageSigning: true,
        maxConcurrentSignatures: 1,
      }
    );
    multiChainProvider = new TestProvider(
      "multi-provider",
      { name: "Multi Provider", version: "1.0.0", description: "Multi-chain" },
      {
        supportedChains: [
          types_1.ChainId.STELLAR,
          types_1.ChainId.STARKNET,
          types_1.ChainId.BITCOIN,
        ],
        supportsMultipleAccounts: true,
        requiresUserInteraction: false,
        supportsMessageSigning: true,
        maxConcurrentSignatures: 5,
      }
    );
    bitcoinProvider = new TestProvider(
      "bitcoin-provider",
      {
        name: "Bitcoin Provider",
        version: "1.0.0",
        description: "Bitcoin only",
      },
      {
        supportedChains: [types_1.ChainId.BITCOIN],
        supportsMultipleAccounts: false,
        requiresUserInteraction: true,
        supportsMessageSigning: false,
        maxConcurrentSignatures: 1,
      }
    );
  });
  describe("Chain Support Checks", () => {
    it("should check if provider supports specific chain", () => {
      expect(
        utils_1.SignatureProviderUtils.supportsChain(
          stellarProvider,
          types_1.ChainId.STELLAR
        )
      ).toBe(true);
      expect(
        utils_1.SignatureProviderUtils.supportsChain(
          stellarProvider,
          types_1.ChainId.BITCOIN
        )
      ).toBe(false);
      expect(
        utils_1.SignatureProviderUtils.supportsChain(
          multiChainProvider,
          types_1.ChainId.STELLAR
        )
      ).toBe(true);
      expect(
        utils_1.SignatureProviderUtils.supportsChain(
          multiChainProvider,
          types_1.ChainId.BITCOIN
        )
      ).toBe(true);
    });
    it("should check if provider supports multiple chains", () => {
      expect(
        utils_1.SignatureProviderUtils.supportsMultipleChains(stellarProvider, [
          types_1.ChainId.STELLAR,
        ])
      ).toBe(true);
      expect(
        utils_1.SignatureProviderUtils.supportsMultipleChains(stellarProvider, [
          types_1.ChainId.STELLAR,
          types_1.ChainId.BITCOIN,
        ])
      ).toBe(false);
      expect(
        utils_1.SignatureProviderUtils.supportsMultipleChains(
          multiChainProvider,
          [
            types_1.ChainId.STELLAR,
            types_1.ChainId.STARKNET,
            types_1.ChainId.BITCOIN,
          ]
        )
      ).toBe(true);
    });
  });
  describe("Capability Checks", () => {
    it("should check message signing support", () => {
      expect(
        utils_1.SignatureProviderUtils.supportsMessageSigning(stellarProvider)
      ).toBe(true);
      expect(
        utils_1.SignatureProviderUtils.supportsMessageSigning(bitcoinProvider)
      ).toBe(false);
    });
    it("should check user interaction requirement", () => {
      expect(
        utils_1.SignatureProviderUtils.requiresUserInteraction(stellarProvider)
      ).toBe(true);
      expect(
        utils_1.SignatureProviderUtils.requiresUserInteraction(
          multiChainProvider
        )
      ).toBe(false);
    });
    it("should get max concurrent signatures", () => {
      expect(
        utils_1.SignatureProviderUtils.getMaxConcurrentSignatures(
          stellarProvider
        )
      ).toBe(1);
      expect(
        utils_1.SignatureProviderUtils.getMaxConcurrentSignatures(
          multiChainProvider
        )
      ).toBe(5);
    });
  });
  describe("Provider Validation", () => {
    it("should validate provider capability for supported chain", () => {
      expect(() => {
        utils_1.SignatureProviderUtils.validateProviderCapability(
          stellarProvider,
          types_1.ChainId.STELLAR
        );
      }).not.toThrow();
    });
    it("should throw error for unsupported chain", () => {
      expect(() => {
        utils_1.SignatureProviderUtils.validateProviderCapability(
          stellarProvider,
          types_1.ChainId.BITCOIN
        );
      }).toThrow(errors_1.UnsupportedChainError);
    });
    it("should validate message signing capability", () => {
      expect(() => {
        utils_1.SignatureProviderUtils.validateProviderCapability(
          stellarProvider,
          types_1.ChainId.STELLAR,
          true // requires message signing
        );
      }).not.toThrow();
      expect(() => {
        utils_1.SignatureProviderUtils.validateProviderCapability(
          bitcoinProvider,
          types_1.ChainId.BITCOIN,
          true // requires message signing
        );
      }).toThrow(errors_1.UnsupportedOperationError);
    });
  });
  describe("Provider Comparison", () => {
    it("should compare providers by capabilities", () => {
      const result = utils_1.SignatureProviderUtils.compareProviders(
        stellarProvider,
        multiChainProvider
      );
      expect(result).toBeGreaterThan(0); // multiChainProvider should rank higher
      const result2 = utils_1.SignatureProviderUtils.compareProviders(
        multiChainProvider,
        stellarProvider
      );
      expect(result2).toBeLessThan(0); // multiChainProvider should rank higher
    });
    it("should use alphabetical order when capabilities are equal", () => {
      const provider1 = new TestProvider(
        "a-provider",
        { name: "A Provider", version: "1.0.0", description: "Test" },
        stellarProvider.getCapabilities()
      );
      const provider2 = new TestProvider(
        "z-provider",
        { name: "Z Provider", version: "1.0.0", description: "Test" },
        stellarProvider.getCapabilities()
      );
      const result = utils_1.SignatureProviderUtils.compareProviders(
        provider1,
        provider2
      );
      expect(result).toBeLessThan(0); // A Provider should come before Z Provider
    });
  });
  describe("Capability Description", () => {
    it("should generate human-readable capability description", () => {
      const description =
        utils_1.SignatureProviderUtils.getCapabilityDescription(
          multiChainProvider.getCapabilities()
        );
      expect(description).toContain("Supports 3 chain(s)");
      expect(description).toContain("stellar, starknet, bitcoin");
      expect(description).toContain("Multiple accounts supported");
      expect(description).toContain("Message signing supported");
      expect(description).toContain("Max concurrent signatures: 5");
    });
    it("should handle providers without optional capabilities", () => {
      const description =
        utils_1.SignatureProviderUtils.getCapabilityDescription(
          bitcoinProvider.getCapabilities()
        );
      expect(description).toContain("Supports 1 chain(s)");
      expect(description).toContain("bitcoin");
      expect(description).toContain("Requires user interaction");
      expect(description).not.toContain("Message signing supported");
    });
  });
  describe("Provider Filtering", () => {
    const providers = [stellarProvider, multiChainProvider, bitcoinProvider];
    it("should filter by supported chains (any)", () => {
      const filtered = utils_1.SignatureProviderUtils.filterProviders(
        providers,
        {
          supportedChains: [types_1.ChainId.STELLAR],
          requiresAllChains: false,
        }
      );
      expect(filtered).toHaveLength(2);
      expect(filtered).toContain(stellarProvider);
      expect(filtered).toContain(multiChainProvider);
    });
    it("should filter by supported chains (all required)", () => {
      const filtered = utils_1.SignatureProviderUtils.filterProviders(
        providers,
        {
          supportedChains: [types_1.ChainId.STELLAR, types_1.ChainId.BITCOIN],
          requiresAllChains: true,
        }
      );
      expect(filtered).toHaveLength(1);
      expect(filtered).toContain(multiChainProvider);
    });
    it("should filter by message signing support", () => {
      const filtered = utils_1.SignatureProviderUtils.filterProviders(
        providers,
        {
          supportsMessageSigning: true,
        }
      );
      expect(filtered).toHaveLength(2);
      expect(filtered).toContain(stellarProvider);
      expect(filtered).toContain(multiChainProvider);
    });
    it("should filter by user interaction requirement", () => {
      const filtered = utils_1.SignatureProviderUtils.filterProviders(
        providers,
        {
          requiresUserInteraction: false,
        }
      );
      expect(filtered).toHaveLength(1);
      expect(filtered).toContain(multiChainProvider);
    });
    it("should filter by minimum concurrent signatures", () => {
      const filtered = utils_1.SignatureProviderUtils.filterProviders(
        providers,
        {
          minConcurrentSignatures: 3,
        }
      );
      expect(filtered).toHaveLength(1);
      expect(filtered).toContain(multiChainProvider);
    });
    it("should filter by connection status", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield multiChainProvider.connect();
        const connectedFiltered =
          utils_1.SignatureProviderUtils.filterProviders(providers, {
            connected: true,
          });
        expect(connectedFiltered).toHaveLength(1);
        expect(connectedFiltered).toContain(multiChainProvider);
        const disconnectedFiltered =
          utils_1.SignatureProviderUtils.filterProviders(providers, {
            connected: false,
          });
        expect(disconnectedFiltered).toHaveLength(2);
        expect(disconnectedFiltered).toContain(stellarProvider);
        expect(disconnectedFiltered).toContain(bitcoinProvider);
      }));
  });
  describe("Best Provider Selection", () => {
    const providers = [stellarProvider, multiChainProvider, bitcoinProvider];
    it("should find best provider for chain", () => {
      const best = utils_1.SignatureProviderUtils.findBestProvider(
        providers,
        types_1.ChainId.STELLAR
      );
      expect(best).toBe(multiChainProvider); // Higher capabilities
    });
    it("should return null if no provider supports chain", () => {
      const best = utils_1.SignatureProviderUtils.findBestProvider(
        [bitcoinProvider],
        types_1.ChainId.STELLAR
      );
      expect(best).toBeNull();
    });
    it("should prefer connected providers", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield stellarProvider.connect();
        const best = utils_1.SignatureProviderUtils.findBestProvider(
          providers,
          types_1.ChainId.STELLAR,
          {
            preferConnected: true,
          }
        );
        // Should prefer connected stellarProvider despite multiChainProvider having better capabilities
        expect(best).toBe(stellarProvider);
      }));
    it("should prefer providers without user interaction", () => {
      const best = utils_1.SignatureProviderUtils.findBestProvider(
        providers,
        types_1.ChainId.STELLAR,
        {
          preferNoUserInteraction: true,
        }
      );
      expect(best).toBe(multiChainProvider);
    });
  });
  describe("Provider Summary", () => {
    it("should create comprehensive provider summary", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const providers = [
          stellarProvider,
          multiChainProvider,
          bitcoinProvider,
        ];
        yield multiChainProvider.connect();
        const summary =
          utils_1.SignatureProviderUtils.createProviderSummary(providers);
        expect(summary.totalProviders).toBe(3);
        expect(summary.connectedProviders).toBe(1);
        expect(summary.chainSupport[types_1.ChainId.STELLAR]).toBe(2);
        expect(summary.chainSupport[types_1.ChainId.STARKNET]).toBe(1);
        expect(summary.chainSupport[types_1.ChainId.BITCOIN]).toBe(2);
        expect(summary.capabilities.messageSigningSupport).toBe(2);
        expect(summary.capabilities.multipleAccountsSupport).toBe(2);
        expect(summary.capabilities.requireUserInteraction).toBe(2);
      }));
    it("should handle empty provider list", () => {
      const summary = utils_1.SignatureProviderUtils.createProviderSummary([]);
      expect(summary.totalProviders).toBe(0);
      expect(summary.connectedProviders).toBe(0);
      expect(summary.chainSupport[types_1.ChainId.STELLAR]).toBe(0);
      expect(summary.capabilities.messageSigningSupport).toBe(0);
    });
  });
});
