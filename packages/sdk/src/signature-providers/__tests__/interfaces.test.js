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
const interfaces_1 = require("../interfaces");
const errors_1 = require("../errors");
// Mock implementation for testing
class MockSignatureProvider extends interfaces_1.BaseSignatureProvider {
  constructor(providerId, metadata) {
    super(providerId, metadata);
    this.mockAccounts = [];
    this.mockCapabilities = {
      supportedChains: [types_1.ChainId.STELLAR, types_1.ChainId.STARKNET],
      supportsMultipleAccounts: true,
      requiresUserInteraction: false,
      supportsMessageSigning: true,
      maxConcurrentSignatures: 5,
    };
  }
  connect() {
    return __awaiter(this, void 0, void 0, function* () {
      this.connectionState = {
        isConnected: true,
        connectionId: "mock-connection-123",
        metadata: { mockProvider: true },
      };
      this.notifyConnectionChange(true);
      return this.connectionState;
    });
  }
  disconnect() {
    return __awaiter(this, void 0, void 0, function* () {
      this.connectionState = null;
      this.notifyConnectionChange(false);
    });
  }
  getAccounts(_chainId) {
    return __awaiter(this, void 0, void 0, function* () {
      if (!this.mockCapabilities.supportedChains.includes(_chainId)) {
        throw new errors_1.UnsupportedChainError(_chainId, this.providerId);
      }
      return this.mockAccounts;
    });
  }
  signTransaction(_request) {
    return __awaiter(this, void 0, void 0, function* () {
      void _request;
      return {
        signature: "mock-signature-123",
        publicKey: "mock-public-key-456",
        signedTransaction: { mockSigned: true },
        metadata: { mockSigning: true },
      };
    });
  }
  getCapabilities() {
    return this.mockCapabilities;
  }
  // Helper method for testing
  setMockAccounts(accounts) {
    this.mockAccounts = accounts;
  }
}
describe("SignatureProvider Interface", () => {
  let provider;
  const mockMetadata = {
    name: "Mock Provider",
    version: "1.0.0",
    description: "A mock signature provider for testing",
    icon: "mock-icon.png",
    website: "https://mock-provider.com",
  };
  beforeEach(() => {
    provider = new MockSignatureProvider("mock-provider", mockMetadata);
  });
  describe("Provider Identification", () => {
    it("should have correct provider ID and metadata", () => {
      expect(provider.providerId).toBe("mock-provider");
      expect(provider.metadata).toEqual(mockMetadata);
    });
  });
  describe("Connection Management", () => {
    it("should start disconnected", () => {
      expect(provider.isConnected()).toBe(false);
    });
    it("should connect successfully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const connection = yield provider.connect();
        expect(provider.isConnected()).toBe(true);
        expect(connection.isConnected).toBe(true);
        expect(connection.connectionId).toBe("mock-connection-123");
        expect(connection.metadata).toEqual({ mockProvider: true });
      }));
    it("should disconnect successfully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield provider.connect();
        expect(provider.isConnected()).toBe(true);
        yield provider.disconnect();
        expect(provider.isConnected()).toBe(false);
      }));
    it("should notify connection state changes", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const connectionCallback = jest.fn();
        provider.onConnectionChange(connectionCallback);
        yield provider.connect();
        expect(connectionCallback).toHaveBeenCalledWith(true);
        yield provider.disconnect();
        expect(connectionCallback).toHaveBeenCalledWith(false);
      }));
  });
  describe("Account Management", () => {
    const mockAccounts = [
      {
        address: "stellar-address-123",
        publicKey: "stellar-pubkey-123",
        chainId: types_1.ChainId.STELLAR,
        derivationPath: "m/44'/148'/0'",
        metadata: { accountName: "Main Account" },
      },
      {
        address: "starknet-address-456",
        publicKey: "starknet-pubkey-456",
        chainId: types_1.ChainId.STARKNET,
        derivationPath: "m/44'/9004'/0'/0/0",
        metadata: { accountName: "Secondary Account" },
      },
    ];
    beforeEach(() => {
      provider.setMockAccounts(mockAccounts);
    });
    it("should return accounts for supported chains", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const stellarAccounts = yield provider.getAccounts(
          types_1.ChainId.STELLAR
        );
        expect(stellarAccounts).toEqual(mockAccounts);
        const starknetAccounts = yield provider.getAccounts(
          types_1.ChainId.STARKNET
        );
        expect(starknetAccounts).toEqual(mockAccounts);
      }));
    it("should throw error for unsupported chains", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield expect(
          provider.getAccounts(types_1.ChainId.BITCOIN)
        ).rejects.toThrow("Unsupported chain: bitcoin");
      }));
    it("should notify account changes", () => {
      const accountCallback = jest.fn();
      provider.onAccountChange(accountCallback);
      provider["notifyAccountChange"](mockAccounts);
      expect(accountCallback).toHaveBeenCalledWith(mockAccounts);
    });
  });
  describe("Transaction Signing", () => {
    it("should sign Stellar transactions", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const request = {
          transactionData: {
            chainId: types_1.ChainId.STELLAR,
            transaction: {
              sourceAccount: "GTEST123",
              fee: "100",
              sequenceNumber: "1",
              operations: [{ type: "payment" }],
            },
          },
          accountAddress: "stellar-address-123",
          metadata: { requestId: "req-123" },
        };
        const result = yield provider.signTransaction(request);
        expect(result.signature).toBe("mock-signature-123");
        expect(result.publicKey).toBe("mock-public-key-456");
        expect(result.signedTransaction).toEqual({ mockSigned: true });
        expect(result.metadata).toEqual({ mockSigning: true });
      }));
    it("should sign Starknet transactions", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const request = {
          transactionData: {
            chainId: types_1.ChainId.STARKNET,
            transaction: {
              contractAddress: "0x123",
              entrypoint: "transfer",
              calldata: ["0x456", "1000", "0"],
            },
          },
          accountAddress: "starknet-address-456",
        };
        const result = yield provider.signTransaction(request);
        expect(result).toBeDefined();
        expect(result.signature).toBeTruthy();
      }));
  });
  describe("Provider Capabilities", () => {
    it("should return correct capabilities", () => {
      const capabilities = provider.getCapabilities();
      expect(capabilities.supportedChains).toEqual([
        types_1.ChainId.STELLAR,
        types_1.ChainId.STARKNET,
      ]);
      expect(capabilities.supportsMultipleAccounts).toBe(true);
      expect(capabilities.requiresUserInteraction).toBe(false);
      expect(capabilities.supportsMessageSigning).toBe(true);
      expect(capabilities.maxConcurrentSignatures).toBe(5);
    });
  });
  describe("Error Handling in Callbacks", () => {
    it("should handle errors in connection callbacks gracefully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const errorCallback = jest.fn(() => {
          throw new Error("Callback error");
        });
        const goodCallback = jest.fn();
        provider.onConnectionChange(errorCallback);
        provider.onConnectionChange(goodCallback);
        // Should not throw despite callback error
        yield provider.connect();
        expect(errorCallback).toHaveBeenCalled();
        expect(goodCallback).toHaveBeenCalledWith(true);
      }));
    it("should handle errors in account callbacks gracefully", () => {
      const errorCallback = jest.fn(() => {
        throw new Error("Callback error");
      });
      const goodCallback = jest.fn();
      provider.onAccountChange(errorCallback);
      provider.onAccountChange(goodCallback);
      const mockAccounts = [];
      // Should not throw despite callback error
      provider["notifyAccountChange"](mockAccounts);
      expect(errorCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalledWith(mockAccounts);
    });
  });
});
