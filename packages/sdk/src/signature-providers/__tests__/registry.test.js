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
const registry_1 = require("../registry");
const interfaces_1 = require("../interfaces");
const errors_1 = require("../errors");
// Mock provider implementations for testing
class MockProvider extends interfaces_1.BaseSignatureProvider {
  constructor(
    providerId,
    metadata,
    supportedChains = [types_1.ChainId.STELLAR]
  ) {
    super(providerId, metadata);
    this.mockConnected = false;
    this.mockAccounts = [];
    this.mockCapabilities = {
      supportedChains,
      supportsMultipleAccounts: true,
      requiresUserInteraction: false,
      supportsMessageSigning: true,
      maxConcurrentSignatures: 1,
    };
  }
  connect() {
    return __awaiter(this, void 0, void 0, function* () {
      this.mockConnected = true;
      this.connectionState = {
        isConnected: true,
        connectionId: `${this.providerId}-connection`,
      };
      return this.connectionState;
    });
  }
  disconnect() {
    return __awaiter(this, void 0, void 0, function* () {
      this.mockConnected = false;
      this.connectionState = null;
    });
  }
  isConnected() {
    return this.mockConnected;
  }
  getAccounts(_chainId) {
    return __awaiter(this, void 0, void 0, function* () {
      void _chainId;
      return this.mockAccounts;
    });
  }
  signTransaction(_request) {
    return __awaiter(this, void 0, void 0, function* () {
      void _request;
      return {
        signature: "mock-signature",
        publicKey: "mock-public-key",
      };
    });
  }
  getCapabilities() {
    return this.mockCapabilities;
  }
  // Test helpers
  setMockAccounts(accounts) {
    this.mockAccounts = accounts;
  }
}
describe("SignatureProviderRegistry", () => {
  let registry;
  let mockProvider1;
  let mockProvider2;
  let mockProvider3;
  const mockMetadata1 = {
    name: "Mock Provider 1",
    version: "1.0.0",
    description: "First mock provider",
  };
  const mockMetadata2 = {
    name: "Mock Provider 2",
    version: "2.0.0",
    description: "Second mock provider",
  };
  const mockMetadata3 = {
    name: "Multi-Chain Provider",
    version: "1.0.0",
    description: "Provider supporting multiple chains",
  };
  beforeEach(() => {
    registry = new registry_1.SignatureProviderRegistry();
    mockProvider1 = new MockProvider("provider1", mockMetadata1, [
      types_1.ChainId.STELLAR,
    ]);
    mockProvider2 = new MockProvider("provider2", mockMetadata2, [
      types_1.ChainId.STARKNET,
    ]);
    mockProvider3 = new MockProvider("provider3", mockMetadata3, [
      types_1.ChainId.STELLAR,
      types_1.ChainId.STARKNET,
      types_1.ChainId.BITCOIN,
    ]);
  });
  describe("Provider Registration", () => {
    it("should register a provider successfully", () => {
      registry.register(mockProvider1);
      expect(registry.hasProvider("provider1")).toBe(true);
      expect(registry.getProviderCount()).toBe(1);
      expect(registry.getProvider("provider1")).toBe(mockProvider1);
    });
    it("should register multiple providers", () => {
      registry.register(mockProvider1);
      registry.register(mockProvider2);
      expect(registry.getProviderCount()).toBe(2);
      expect(registry.hasProvider("provider1")).toBe(true);
      expect(registry.hasProvider("provider2")).toBe(true);
    });
    it("should throw error when registering duplicate provider ID", () => {
      registry.register(mockProvider1);
      expect(() => registry.register(mockProvider1)).toThrow(
        "Provider with ID 'provider1' is already registered"
      );
    });
    it("should validate provider implementation during registration", () => {
      const invalidProvider = {};
      expect(() => registry.register(invalidProvider)).toThrow(
        "Provider must have a valid providerId string"
      );
    });
    it("should notify registration callbacks", () => {
      const callback = jest.fn();
      registry.onProviderRegistered(callback);
      registry.register(mockProvider1);
      expect(callback).toHaveBeenCalledWith("provider1", mockProvider1);
    });
    it("should handle errors in registration callbacks gracefully", () => {
      const errorCallback = jest.fn(() => {
        throw new Error("Callback error");
      });
      const goodCallback = jest.fn();
      registry.onProviderRegistered(errorCallback);
      registry.onProviderRegistered(goodCallback);
      // Should not throw despite callback error
      registry.register(mockProvider1);
      expect(errorCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalledWith("provider1", mockProvider1);
    });
  });
  describe("Provider Unregistration", () => {
    beforeEach(() => {
      registry.register(mockProvider1);
      registry.register(mockProvider2);
    });
    it("should unregister a provider successfully", () => {
      registry.unregister("provider1");
      expect(registry.hasProvider("provider1")).toBe(false);
      expect(registry.getProviderCount()).toBe(1);
      expect(registry.hasProvider("provider2")).toBe(true);
    });
    it("should throw error when unregistering non-existent provider", () => {
      expect(() => registry.unregister("nonexistent")).toThrow(
        errors_1.ProviderNotFoundError
      );
    });
    it("should disconnect provider before unregistering", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield mockProvider1.connect();
        expect(mockProvider1.isConnected()).toBe(true);
        registry.unregister("provider1");
        // Give time for async disconnect
        yield new Promise((resolve) => setTimeout(resolve, 10));
        expect(mockProvider1.isConnected()).toBe(false);
      }));
    it("should notify unregistration callbacks", () => {
      const callback = jest.fn();
      registry.onProviderUnregistered(callback);
      registry.unregister("provider1");
      expect(callback).toHaveBeenCalledWith("provider1");
    });
  });
  describe("Provider Retrieval", () => {
    beforeEach(() => {
      registry.register(mockProvider1);
      registry.register(mockProvider2);
      registry.register(mockProvider3);
    });
    it("should get provider by ID", () => {
      const provider = registry.getProvider("provider1");
      expect(provider).toBe(mockProvider1);
    });
    it("should throw error for non-existent provider", () => {
      expect(() => registry.getProvider("nonexistent")).toThrow(
        errors_1.ProviderNotFoundError
      );
    });
    it("should list all providers", () => {
      const providers = registry.listProviders();
      expect(providers).toHaveLength(3);
      expect(providers).toContain(mockProvider1);
      expect(providers).toContain(mockProvider2);
      expect(providers).toContain(mockProvider3);
    });
    it("should check if provider exists", () => {
      expect(registry.hasProvider("provider1")).toBe(true);
      expect(registry.hasProvider("nonexistent")).toBe(false);
    });
    it("should get provider count", () => {
      expect(registry.getProviderCount()).toBe(3);
      registry.unregister("provider1");
      expect(registry.getProviderCount()).toBe(2);
    });
  });
  describe("Chain-Based Provider Discovery", () => {
    beforeEach(() => {
      registry.register(mockProvider1); // Stellar only
      registry.register(mockProvider2); // Starknet only
      registry.register(mockProvider3); // All chains
    });
    it("should find providers for specific chain", () => {
      const stellarProviders = registry.findProvidersForChain(
        types_1.ChainId.STELLAR
      );
      expect(stellarProviders).toHaveLength(2);
      expect(stellarProviders).toContain(mockProvider1);
      expect(stellarProviders).toContain(mockProvider3);
      const starknetProviders = registry.findProvidersForChain(
        types_1.ChainId.STARKNET
      );
      expect(starknetProviders).toHaveLength(2);
      expect(starknetProviders).toContain(mockProvider2);
      expect(starknetProviders).toContain(mockProvider3);
      const bitcoinProviders = registry.findProvidersForChain(
        types_1.ChainId.BITCOIN
      );
      expect(bitcoinProviders).toHaveLength(1);
      expect(bitcoinProviders).toContain(mockProvider3);
    });
    it("should find multi-chain providers", () => {
      const multiChainProviders = registry.findMultiChainProviders([
        types_1.ChainId.STELLAR,
        types_1.ChainId.STARKNET,
      ]);
      expect(multiChainProviders).toHaveLength(1);
      expect(multiChainProviders).toContain(mockProvider3);
      const allChainProviders = registry.findMultiChainProviders([
        types_1.ChainId.STELLAR,
        types_1.ChainId.STARKNET,
        types_1.ChainId.BITCOIN,
      ]);
      expect(allChainProviders).toHaveLength(1);
      expect(allChainProviders).toContain(mockProvider3);
    });
    it("should return empty array for unsupported chain combinations", () => {
      const impossibleProviders = registry.findMultiChainProviders([
        types_1.ChainId.STELLAR,
        types_1.ChainId.STARKNET,
        types_1.ChainId.BITCOIN,
        "unsupported-chain",
      ]);
      expect(impossibleProviders).toHaveLength(0);
    });
  });
  describe("Registry Clearing", () => {
    beforeEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        registry.register(mockProvider1);
        registry.register(mockProvider2);
        yield mockProvider1.connect();
        yield mockProvider2.connect();
      })
    );
    it("should clear all providers", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        expect(registry.getProviderCount()).toBe(2);
        expect(mockProvider1.isConnected()).toBe(true);
        expect(mockProvider2.isConnected()).toBe(true);
        registry.clear();
        // Give time for async operations
        yield new Promise((resolve) => setTimeout(resolve, 10));
        expect(registry.getProviderCount()).toBe(0);
        expect(mockProvider1.isConnected()).toBe(false);
        expect(mockProvider2.isConnected()).toBe(false);
      }));
    it("should notify unregistration callbacks for all providers when clearing", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const callback = jest.fn();
        registry.onProviderUnregistered(callback);
        registry.clear();
        // Give time for async operations
        yield new Promise((resolve) => setTimeout(resolve, 10));
        expect(callback).toHaveBeenCalledTimes(2);
        expect(callback).toHaveBeenCalledWith("provider1");
        expect(callback).toHaveBeenCalledWith("provider2");
      }));
  });
  describe("Provider Validation", () => {
    it("should validate provider has required methods", () => {
      const invalidProvider = {
        providerId: "invalid",
        metadata: mockMetadata1,
        // Missing required methods
      };
      expect(() => registry.register(invalidProvider)).toThrow(
        "Provider invalid missing required method: connect"
      );
    });
    it("should validate provider has required properties", () => {
      const invalidProvider = {
        connect: jest.fn(),
        disconnect: jest.fn(),
        isConnected: jest.fn(),
        getAccounts: jest.fn(),
        signTransaction: jest.fn(),
        getCapabilities: jest.fn(),
        // Missing providerId and metadata
      };
      expect(() => registry.register(invalidProvider)).toThrow(
        "Provider must have a valid providerId string"
      );
    });
    it("should validate provider metadata structure", () => {
      const invalidProvider = {
        providerId: "test",
        metadata: {}, // Invalid metadata - intentionally empty for testing
        connect: jest.fn(),
        disconnect: jest.fn(),
        isConnected: jest.fn(),
        getAccounts: jest.fn(),
        signTransaction: jest.fn(),
        getCapabilities: jest.fn(),
      };
      expect(() => registry.register(invalidProvider)).toThrow(
        "Provider test metadata must include name, version, and description"
      );
    });
    it("should validate providerId is non-empty string", () => {
      const invalidProvider = {
        providerId: "", // Empty string
        metadata: mockMetadata1,
        connect: jest.fn(),
        disconnect: jest.fn(),
        isConnected: jest.fn(),
        getAccounts: jest.fn(),
        signTransaction: jest.fn(),
        getCapabilities: jest.fn(),
      };
      expect(() => registry.register(invalidProvider)).toThrow(
        "Provider must have a valid providerId string"
      );
    });
  });
  describe("Global Registry Instance", () => {
    it("should provide a global registry instance", () => {
      expect(registry_1.signatureProviderRegistry).toBeInstanceOf(
        registry_1.SignatureProviderRegistry
      );
    });
    it("should maintain state across imports", () => {
      registry_1.signatureProviderRegistry.register(mockProvider1);
      expect(
        registry_1.signatureProviderRegistry.hasProvider("provider1")
      ).toBe(true);
      // Clean up
      registry_1.signatureProviderRegistry.unregister("provider1");
    });
  });
  describe("Error Handling", () => {
    it("should handle provider disconnect errors gracefully during unregistration", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const faultyProvider = new MockProvider("faulty", mockMetadata1);
        faultyProvider.disconnect = jest
          .fn()
          .mockRejectedValue(new Error("Disconnect failed"));
        registry.register(faultyProvider);
        yield faultyProvider.connect();
        // Should not throw despite disconnect error
        expect(() => registry.unregister("faulty")).not.toThrow();
      }));
    it("should handle provider disconnect errors gracefully during clear", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const faultyProvider = new MockProvider("faulty", mockMetadata1);
        faultyProvider.disconnect = jest
          .fn()
          .mockRejectedValue(new Error("Disconnect failed"));
        registry.register(faultyProvider);
        yield faultyProvider.connect();
        // Should not throw despite disconnect error
        expect(() => registry.clear()).not.toThrow();
      }));
  });
});
