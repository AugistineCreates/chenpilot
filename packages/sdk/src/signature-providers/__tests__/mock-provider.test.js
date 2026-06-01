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
const mock_provider_1 = require("../mock-provider");
const errors_1 = require("../errors");
describe("MockSignatureProvider", () => {
  let mockProvider;
  // Helper functions for creating test requests
  const createBitcoinSigningRequest = () => ({
    transactionData: {
      chainId: types_1.ChainId.BITCOIN,
      transaction: {
        inputs: [{ txid: "test-txid", vout: 0 }],
        outputs: [{ value: 100000, scriptPubKey: "test-script" }],
      },
    },
    accountAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  });
  const createStellarSigningRequest = () => ({
    transactionData: {
      chainId: types_1.ChainId.STELLAR,
      transaction: {
        sourceAccount:
          "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
        fee: "100",
        sequenceNumber: "1",
        operations: [{ type: "payment" }],
      },
    },
    accountAddress: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
  });
  const createStarknetSigningRequest = () => ({
    transactionData: {
      chainId: types_1.ChainId.STARKNET,
      transaction: {
        contractAddress: "0x123",
        entrypoint: "transfer",
        calldata: ["0x456", "1000", "0"],
      },
    },
    accountAddress:
      "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  });
  beforeEach(() => {
    mockProvider = new mock_provider_1.MockSignatureProvider();
  });
  describe("Initialization and Configuration", () => {
    it("should initialize with default configuration", () => {
      expect(mockProvider.providerId).toBe("mock-provider");
      expect(mockProvider.metadata.name).toBe("Mock Signature Provider");
      expect(mockProvider.isConnected()).toBe(false);
    });
    it("should accept custom provider ID and metadata", () => {
      const customProvider = new mock_provider_1.MockSignatureProvider(
        "custom-mock",
        {
          name: "Custom Mock Provider",
          version: "2.0.0",
          description: "Custom mock for testing",
        }
      );
      expect(customProvider.providerId).toBe("custom-mock");
      expect(customProvider.metadata.name).toBe("Custom Mock Provider");
      expect(customProvider.metadata.version).toBe("2.0.0");
    });
    it("should accept custom configuration", () => {
      const config = {
        connectionDelay: 500,
        signingDelay: 1000,
        enableLogging: true,
      };
      const customProvider = new mock_provider_1.MockSignatureProvider(
        "test",
        undefined,
        config
      );
      expect(customProvider.getConfig().connectionDelay).toBe(500);
      expect(customProvider.getConfig().signingDelay).toBe(1000);
      expect(customProvider.getConfig().enableLogging).toBe(true);
    });
    it("should update configuration", () => {
      mockProvider.updateConfig({
        connectionDelay: 200,
        shouldFailConnection: true,
      });
      const config = mockProvider.getConfig();
      expect(config.connectionDelay).toBe(200);
      expect(config.shouldFailConnection).toBe(true);
    });
    it("should reset to default state", () => {
      mockProvider.updateConfig({ shouldFailConnection: true });
      mockProvider.reset();
      const config = mockProvider.getConfig();
      expect(config.shouldFailConnection).toBeUndefined();
      expect(mockProvider.isConnected()).toBe(false);
    });
  });
  describe("Connection Management", () => {
    it("should connect successfully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const connection = yield mockProvider.connect();
        expect(mockProvider.isConnected()).toBe(true);
        expect(connection.isConnected).toBe(true);
        expect(connection.connectionId).toMatch(/^mock-connection-/);
        expect(
          (_a = connection.metadata) === null || _a === void 0
            ? void 0
            : _a.mockProvider
        ).toBe(true);
      }));
    it("should simulate connection delay", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockProvider.updateConfig({ connectionDelay: 100 });
        const startTime = Date.now();
        yield mockProvider.connect();
        const endTime = Date.now();
        expect(endTime - startTime).toBeGreaterThanOrEqual(100);
      }));
    it("should fail connection when configured", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockProvider.updateConfig({ shouldFailConnection: true });
        yield expect(mockProvider.connect()).rejects.toThrow(
          errors_1.ConnectionError
        );
      }));
    it("should fail connection with custom error", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const customError = new errors_1.ConnectionError(
          "Custom connection error",
          "mock-provider"
        );
        mockProvider.updateConfig({
          shouldFailConnection: true,
          connectionError: customError,
        });
        yield expect(mockProvider.connect()).rejects.toThrow(
          "Custom connection error"
        );
      }));
    it("should disconnect successfully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield mockProvider.connect();
        expect(mockProvider.isConnected()).toBe(true);
        yield mockProvider.disconnect();
        expect(mockProvider.isConnected()).toBe(false);
      }));
    it("should notify connection state changes", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const connectionCallback = jest.fn();
        mockProvider.onConnectionChange(connectionCallback);
        yield mockProvider.connect();
        expect(connectionCallback).toHaveBeenCalledWith(true);
        yield mockProvider.disconnect();
        expect(connectionCallback).toHaveBeenCalledWith(false);
      }));
  });
  describe("Account Management", () => {
    it("should return default accounts for all chains", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const bitcoinAccounts = yield mockProvider.getAccounts(
          types_1.ChainId.BITCOIN
        );
        const stellarAccounts = yield mockProvider.getAccounts(
          types_1.ChainId.STELLAR
        );
        const starknetAccounts = yield mockProvider.getAccounts(
          types_1.ChainId.STARKNET
        );
        expect(bitcoinAccounts).toHaveLength(2);
        expect(stellarAccounts).toHaveLength(2);
        expect(starknetAccounts).toHaveLength(2);
        expect(bitcoinAccounts[0].chainId).toBe(types_1.ChainId.BITCOIN);
        expect(stellarAccounts[0].chainId).toBe(types_1.ChainId.STELLAR);
        expect(starknetAccounts[0].chainId).toBe(types_1.ChainId.STARKNET);
      }));
    it("should return custom accounts when configured", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const customAccounts = [
          {
            address: "custom-address",
            publicKey: "custom-pubkey",
            chainId: types_1.ChainId.STELLAR,
            metadata: { custom: true },
          },
        ];
        mockProvider.updateConfig({
          accounts: {
            [types_1.ChainId.BITCOIN]: [],
            [types_1.ChainId.STELLAR]: customAccounts,
            [types_1.ChainId.STARKNET]: [],
          },
        });
        const accounts = yield mockProvider.getAccounts(
          types_1.ChainId.STELLAR
        );
        expect(accounts).toEqual(customAccounts);
      }));
    it("should fail getting accounts when configured", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockProvider.updateConfig({ shouldFailGetAccounts: true });
        yield expect(
          mockProvider.getAccounts(types_1.ChainId.STELLAR)
        ).rejects.toThrow(errors_1.SigningError);
      }));
    it("should add mock accounts", () => {
      const newAccount = {
        address: "new-address",
        publicKey: "new-pubkey",
        chainId: types_1.ChainId.BITCOIN,
      };
      mockProvider.addMockAccounts(types_1.ChainId.BITCOIN, [newAccount]);
      const mockAccounts = mockProvider.getMockAccounts();
      expect(mockAccounts[types_1.ChainId.BITCOIN]).toContain(newAccount);
    });
    it("should clear mock accounts", () => {
      mockProvider.clearMockAccounts(types_1.ChainId.BITCOIN);
      const mockAccounts = mockProvider.getMockAccounts();
      expect(mockAccounts[types_1.ChainId.BITCOIN]).toHaveLength(0);
    });
  });
  describe("Transaction Signing", () => {
    it("should sign Bitcoin transactions", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        const request = createBitcoinSigningRequest();
        const result = yield mockProvider.signTransaction(request);
        expect(result.signature).toMatch(/^304402/); // Bitcoin signature format
        expect(result.publicKey).toMatch(/^02/); // Bitcoin public key format
        expect(result.signedTransaction).toHaveProperty("signatures");
        expect(
          (_a = result.metadata) === null || _a === void 0
            ? void 0
            : _a.mockProvider
        ).toBe(true);
        expect(
          (_b = result.metadata) === null || _b === void 0 ? void 0 : _b.chainId
        ).toBe(types_1.ChainId.BITCOIN);
      }));
    it("should sign Stellar transactions", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const request = createStellarSigningRequest();
        const result = yield mockProvider.signTransaction(request);
        expect(result.signature).toHaveLength(128); // Stellar signature length
        expect(result.publicKey).toMatch(/^G/); // Stellar public key format
        expect(result.signedTransaction).toHaveProperty("signatures");
        expect(
          (_a = result.metadata) === null || _a === void 0 ? void 0 : _a.chainId
        ).toBe(types_1.ChainId.STELLAR);
      }));
    it("should sign Starknet transactions", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const request = createStarknetSigningRequest();
        const result = yield mockProvider.signTransaction(request);
        expect(result.signature).toMatch(/^0x/); // Starknet signature format
        expect(result.publicKey).toMatch(/^0x/); // Starknet public key format
        expect(result.signedTransaction).toHaveProperty("signature");
        expect(
          (_a = result.metadata) === null || _a === void 0 ? void 0 : _a.chainId
        ).toBe(types_1.ChainId.STARKNET);
      }));
    it("should simulate signing delay", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockProvider.updateConfig({ signingDelay: 100 });
        const startTime = Date.now();
        yield mockProvider.signTransaction(createBitcoinSigningRequest());
        const endTime = Date.now();
        expect(endTime - startTime).toBeGreaterThanOrEqual(100);
      }));
    it("should fail signing when configured", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockProvider.updateConfig({ shouldFailSigning: true });
        yield expect(
          mockProvider.signTransaction(createBitcoinSigningRequest())
        ).rejects.toThrow(errors_1.SigningError);
      }));
    it("should simulate user rejection", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockProvider.updateConfig({ shouldRejectSigning: true });
        yield expect(
          mockProvider.signTransaction(createBitcoinSigningRequest())
        ).rejects.toThrow(errors_1.UserRejectedError);
      }));
    it("should simulate random user rejection", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockProvider.updateConfig({ rejectionRate: 1.0 }); // 100% rejection rate
        yield expect(
          mockProvider.signTransaction(createBitcoinSigningRequest())
        ).rejects.toThrow(errors_1.UserRejectedError);
      }));
    it("should validate transaction format", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const invalidRequest = {
          transactionData: {
            chainId: types_1.ChainId.BITCOIN,
            transaction: {
              inputs: [],
              outputs: [],
            }, // Invalid: no outputs
          },
          accountAddress: "test-address",
        };
        yield expect(
          mockProvider.signTransaction(invalidRequest)
        ).rejects.toThrow(errors_1.InvalidTransactionError);
      }));
    it("should increment signature counter", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        const result1 = yield mockProvider.signTransaction(
          createBitcoinSigningRequest()
        );
        const result2 = yield mockProvider.signTransaction(
          createStellarSigningRequest()
        );
        expect(
          (_a = result1.metadata) === null || _a === void 0
            ? void 0
            : _a.signatureCounter
        ).toBe(1);
        expect(
          (_b = result2.metadata) === null || _b === void 0
            ? void 0
            : _b.signatureCounter
        ).toBe(2);
      }));
  });
  describe("Message Signing", () => {
    it("should sign messages", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        const result = yield mockProvider.signMessage(
          "Hello, world!",
          "test-address",
          types_1.ChainId.STELLAR
        );
        expect(result.signature).toMatch(/^mock_msg_sig_/);
        expect(result.publicKey).toBeTruthy();
        expect(
          (_a = result.metadata) === null || _a === void 0
            ? void 0
            : _a.messageSignature
        ).toBe(true);
        expect(
          (_b = result.metadata) === null || _b === void 0 ? void 0 : _b.message
        ).toBe("Hello, world!");
      }));
    it("should fail message signing when configured", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockProvider.updateConfig({ shouldFailMessageSigning: true });
        yield expect(
          mockProvider.signMessage("test", "address", types_1.ChainId.STELLAR)
        ).rejects.toThrow(errors_1.SigningError);
      }));
  });
  describe("Capabilities", () => {
    it("should return default capabilities", () => {
      var _a;
      const capabilities = mockProvider.getCapabilities();
      expect(capabilities.supportedChains).toEqual([
        types_1.ChainId.BITCOIN,
        types_1.ChainId.STELLAR,
        types_1.ChainId.STARKNET,
      ]);
      expect(capabilities.supportsMultipleAccounts).toBe(true);
      expect(capabilities.requiresUserInteraction).toBe(false);
      expect(capabilities.supportsMessageSigning).toBe(true);
      expect(capabilities.maxConcurrentSignatures).toBe(10);
      expect(
        (_a = capabilities.metadata) === null || _a === void 0
          ? void 0
          : _a.mockProvider
      ).toBe(true);
    });
    it("should return custom capabilities when configured", () => {
      mockProvider.updateConfig({
        customCapabilities: {
          supportedChains: [types_1.ChainId.STELLAR],
          maxConcurrentSignatures: 5,
          requiresUserInteraction: true,
        },
      });
      const capabilities = mockProvider.getCapabilities();
      expect(capabilities.supportedChains).toEqual([types_1.ChainId.STELLAR]);
      expect(capabilities.maxConcurrentSignatures).toBe(5);
      expect(capabilities.requiresUserInteraction).toBe(true);
      expect(capabilities.supportsMessageSigning).toBe(true); // Should merge with defaults
    });
  });
  describe("Network Simulation", () => {
    it("should simulate network latency", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockProvider.updateConfig({ networkLatency: 100 });
        const startTime = Date.now();
        yield mockProvider.getAccounts(types_1.ChainId.STELLAR);
        const endTime = Date.now();
        expect(endTime - startTime).toBeGreaterThanOrEqual(100);
      }));
    it("should simulate network failures", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockProvider.updateConfig({ networkFailureRate: 1.0 }); // 100% failure rate
        yield expect(
          mockProvider.getAccounts(types_1.ChainId.STELLAR)
        ).rejects.toThrow(errors_1.NetworkError);
      }));
    it("should not fail with 0% network failure rate", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockProvider.updateConfig({ networkFailureRate: 0.0 });
        yield expect(
          mockProvider.getAccounts(types_1.ChainId.STELLAR)
        ).resolves.toBeDefined();
      }));
  });
  describe("Error Simulation", () => {
    it("should simulate specific errors", () => {
      const customError = new errors_1.ConnectionError(
        "Custom error",
        "mock-provider"
      );
      expect(() => mockProvider.simulateError(customError)).toThrow(
        "Custom error"
      );
    });
  });
  describe("Transaction Validation", () => {
    it("should validate Bitcoin transaction structure", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const invalidBitcoinRequest = {
          transactionData: {
            chainId: types_1.ChainId.BITCOIN,
            transaction: { outputs: [] }, // Missing inputs
          },
          accountAddress: "test-address",
        };
        yield expect(
          mockProvider.signTransaction(invalidBitcoinRequest)
        ).rejects.toThrow("Bitcoin transaction must have inputs");
      }));
    it("should validate Stellar transaction structure", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const invalidStellarRequest = {
          transactionData: {
            chainId: types_1.ChainId.STELLAR,
            transaction: { fee: "100" }, // Missing sourceAccount
          },
          accountAddress: "test-address",
        };
        yield expect(
          mockProvider.signTransaction(invalidStellarRequest)
        ).rejects.toThrow("Stellar transaction must have source account");
      }));
    it("should validate Starknet transaction structure", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const invalidStarknetRequest = {
          transactionData: {
            chainId: types_1.ChainId.STARKNET,
            transaction: { calldata: [] }, // Missing contractAddress
          },
          accountAddress: "test-address",
        };
        yield expect(
          mockProvider.signTransaction(invalidStarknetRequest)
        ).rejects.toThrow("Starknet transaction must have contract address");
      }));
  });
  describe("Logging", () => {
    it("should log when enabled", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const consoleSpy = jest.spyOn(console, "log").mockImplementation();
        mockProvider.updateConfig({ enableLogging: true });
        yield mockProvider.connect();
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("[MockSignatureProvider:mock-provider]"),
          expect.anything()
        );
        consoleSpy.mockRestore();
      }));
    it("should not log when disabled", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const consoleSpy = jest.spyOn(console, "log").mockImplementation();
        mockProvider.updateConfig({ enableLogging: false });
        yield mockProvider.connect();
        expect(consoleSpy).not.toHaveBeenCalled();
        consoleSpy.mockRestore();
      }));
  });
  describe("Signature Generation", () => {
    it("should generate unique signatures", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const request1 = createBitcoinSigningRequest();
        const request2 = createBitcoinSigningRequest();
        const result1 = yield mockProvider.signTransaction(request1);
        const result2 = yield mockProvider.signTransaction(request2);
        expect(result1.signature).not.toBe(result2.signature);
      }));
    it("should generate chain-appropriate signature formats", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const bitcoinResult = yield mockProvider.signTransaction(
          createBitcoinSigningRequest()
        );
        const stellarResult = yield mockProvider.signTransaction(
          createStellarSigningRequest()
        );
        const starknetResult = yield mockProvider.signTransaction(
          createStarknetSigningRequest()
        );
        // Bitcoin signatures start with specific format
        expect(bitcoinResult.signature).toMatch(/^304402/);
        // Stellar signatures are 128 characters
        expect(stellarResult.signature).toHaveLength(128);
        // Starknet signatures start with 0x
        expect(starknetResult.signature).toMatch(/^0x/);
      }));
  });
});
