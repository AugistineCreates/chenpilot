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
const albedo_provider_1 = require("../albedo-provider");
const errors_1 = require("../errors");
describe("AlbedoSignatureProvider", () => {
  let albedoProvider;
  beforeEach(() => {
    albedoProvider = new albedo_provider_1.AlbedoSignatureProvider();
  });
  describe("Initialization and Configuration", () => {
    it("should initialize with default configuration", () => {
      expect(albedoProvider.providerId).toBe("albedo-provider");
      expect(albedoProvider.metadata.name).toBe("Albedo Wallet");
      expect(albedoProvider.isConnected()).toBe(false);
    });
    it("should accept custom configuration", () => {
      const config = {
        network: "mainnet",
        connectionTimeout: 15000,
        enableDebugLogging: true,
      };
      const customProvider = new albedo_provider_1.AlbedoSignatureProvider(
        config
      );
      const providerConfig = customProvider.getConfig();
      expect(providerConfig.network).toBe("mainnet");
      expect(providerConfig.connectionTimeout).toBe(15000);
      expect(providerConfig.enableDebugLogging).toBe(true);
    });
    it("should update configuration", () => {
      albedoProvider.updateConfig({
        network: "mainnet",
        maxRetries: 5,
      });
      const config = albedoProvider.getConfig();
      expect(config.network).toBe("mainnet");
      expect(config.maxRetries).toBe(5);
    });
  });
  describe("Connection Management", () => {
    it("should connect successfully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        const connection = yield albedoProvider.connect();
        expect(albedoProvider.isConnected()).toBe(true);
        expect(connection.isConnected).toBe(true);
        expect(connection.connectionId).toMatch(/^albedo-/);
        expect(
          (_a = connection.metadata) === null || _a === void 0
            ? void 0
            : _a.albedoProvider
        ).toBe(true);
        expect(
          (_b = connection.metadata) === null || _b === void 0
            ? void 0
            : _b.publicKey
        ).toBeTruthy();
      }));
    it("should handle Albedo extension not found", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Mock the initializeAlbedoAPI to throw extension not found error
        const originalInitialize = albedoProvider.initializeAlbedoAPI;
        albedoProvider.initializeAlbedoAPI = jest
          .fn()
          .mockRejectedValue(new Error("Albedo extension not found"));
        yield expect(albedoProvider.connect()).rejects.toThrow(
          errors_1.ProviderNotFoundError
        );
        // Restore original method
        albedoProvider.initializeAlbedoAPI = originalInitialize;
      }));
    it("should handle user rejection during connection", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const originalInitialize = albedoProvider.initializeAlbedoAPI;
        albedoProvider.initializeAlbedoAPI = jest.fn().mockResolvedValue({
          publicKey: jest
            .fn()
            .mockRejectedValue(new Error("User rejected the request")),
        });
        yield expect(albedoProvider.connect()).rejects.toThrow(
          errors_1.UserRejectedError
        );
        albedoProvider.initializeAlbedoAPI = originalInitialize;
      }));
    it("should handle connection failure", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const originalInitialize = albedoProvider.initializeAlbedoAPI;
        albedoProvider.initializeAlbedoAPI = jest
          .fn()
          .mockRejectedValue(new Error("Connection failed"));
        yield expect(albedoProvider.connect()).rejects.toThrow(
          errors_1.ConnectionError
        );
        albedoProvider.initializeAlbedoAPI = originalInitialize;
      }));
    it("should disconnect successfully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield albedoProvider.connect();
        expect(albedoProvider.isConnected()).toBe(true);
        yield albedoProvider.disconnect();
        expect(albedoProvider.isConnected()).toBe(false);
      }));
    it("should notify connection state changes", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const connectionCallback = jest.fn();
        albedoProvider.onConnectionChange(connectionCallback);
        yield albedoProvider.connect();
        expect(connectionCallback).toHaveBeenCalledWith(true);
        yield albedoProvider.disconnect();
        expect(connectionCallback).toHaveBeenCalledWith(false);
      }));
  });
  describe("Account Management", () => {
    beforeEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield albedoProvider.connect();
      })
    );
    afterEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield albedoProvider.disconnect();
      })
    );
    it("should get Stellar accounts", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const accounts = yield albedoProvider.getAccounts(
          types_1.ChainId.STELLAR
        );
        expect(accounts).toHaveLength(1);
        expect(accounts[0].chainId).toBe(types_1.ChainId.STELLAR);
        expect(accounts[0].address).toMatch(/^G/); // Stellar address format
        expect(accounts[0].publicKey).toBe(accounts[0].address); // Stellar addresses are public keys
        expect(
          (_a = accounts[0].metadata) === null || _a === void 0
            ? void 0
            : _a.albedoProvider
        ).toBe(true);
      }));
    it("should throw error for unsupported chains", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield expect(
          albedoProvider.getAccounts(types_1.ChainId.BITCOIN)
        ).rejects.toThrow(errors_1.UnsupportedChainError);
        yield expect(
          albedoProvider.getAccounts(types_1.ChainId.STARKNET)
        ).rejects.toThrow(errors_1.UnsupportedChainError);
      }));
    it("should throw error when not connected", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield albedoProvider.disconnect();
        yield expect(
          albedoProvider.getAccounts(types_1.ChainId.STELLAR)
        ).rejects.toThrow(errors_1.ConnectionError);
      }));
    it("should cache accounts", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const accounts1 = yield albedoProvider.getAccounts(
          types_1.ChainId.STELLAR
        );
        const accounts2 = yield albedoProvider.getAccounts(
          types_1.ChainId.STELLAR
        );
        expect(accounts1).toBe(accounts2); // Should return cached instance
      }));
    it("should handle user rejection when getting accounts", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Mock the albedoAPI to reject
        const mockAPI = albedoProvider.albedoAPI;
        mockAPI.publicKey = jest
          .fn()
          .mockRejectedValue(new Error("User rejected the request"));
        yield expect(
          albedoProvider.getAccounts(types_1.ChainId.STELLAR)
        ).rejects.toThrow(errors_1.UserRejectedError);
      }));
  });
  describe("Transaction Signing", () => {
    const createStellarSigningRequest = () => ({
      transactionData: {
        chainId: types_1.ChainId.STELLAR,
        transaction: {
          sourceAccount:
            "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
          fee: "100",
          sequenceNumber: "1",
          operations: [
            {
              type: "payment",
              destination:
                "GCKFBEIYTKP5RDBKIXFJ2HBMKQCGGFJJP5NKQRXQC4QLQZQZQZQZQZQZ",
              asset: "native",
              amount: "10",
            },
          ],
        },
      },
      accountAddress:
        "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      metadata: {
        description: "Test payment transaction",
      },
    });
    beforeEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield albedoProvider.connect();
      })
    );
    afterEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield albedoProvider.disconnect();
      })
    );
    it("should sign Stellar transactions", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        const request = createStellarSigningRequest();
        const result = yield albedoProvider.signTransaction(request);
        expect(result.signature).toBeTruthy();
        expect(result.publicKey).toBe(request.accountAddress);
        expect(result.signedTransaction).toHaveProperty("signatures");
        expect(result.signedTransaction).toHaveProperty("envelope_xdr");
        expect(
          (_a = result.metadata) === null || _a === void 0
            ? void 0
            : _a.albedoProvider
        ).toBe(true);
        expect(
          (_b = result.metadata) === null || _b === void 0 ? void 0 : _b.network
        ).toBeTruthy();
      }));
    it("should throw error for unsupported chains", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const bitcoinRequest = {
          transactionData: {
            chainId: types_1.ChainId.BITCOIN,
            transaction: { inputs: [], outputs: [] },
          },
          accountAddress: "bc1qtest",
        };
        yield expect(
          albedoProvider.signTransaction(bitcoinRequest)
        ).rejects.toThrow(errors_1.UnsupportedChainError);
      }));
    it("should throw error when not connected", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield albedoProvider.disconnect();
        yield expect(
          albedoProvider.signTransaction(createStellarSigningRequest())
        ).rejects.toThrow(errors_1.ConnectionError);
      }));
    it("should handle user rejection", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockAPI = albedoProvider.albedoAPI;
        mockAPI.tx = jest
          .fn()
          .mockRejectedValue(new Error("User rejected the request"));
        yield expect(
          albedoProvider.signTransaction(createStellarSigningRequest())
        ).rejects.toThrow(errors_1.UserRejectedError);
      }));
    it("should validate transaction format", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const invalidRequest = {
          transactionData: {
            chainId: types_1.ChainId.STELLAR,
            transaction: {
              // Missing required fields
              fee: "100",
            },
          },
          accountAddress:
            "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
        };
        yield expect(
          albedoProvider.signTransaction(invalidRequest)
        ).rejects.toThrow(errors_1.InvalidTransactionError);
      }));
    it("should handle network errors", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockAPI = albedoProvider.albedoAPI;
        mockAPI.tx = jest
          .fn()
          .mockRejectedValue(new Error("Network error occurred"));
        yield expect(
          albedoProvider.signTransaction(createStellarSigningRequest())
        ).rejects.toThrow(errors_1.SigningError);
      }));
  });
  describe("Message Signing", () => {
    beforeEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield albedoProvider.connect();
      })
    );
    afterEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield albedoProvider.disconnect();
      })
    );
    it("should sign messages for Stellar", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        const result = yield albedoProvider.signMessage(
          "Hello, Stellar!",
          "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
          types_1.ChainId.STELLAR
        );
        expect(result.signature).toBeTruthy();
        expect(result.publicKey).toBeTruthy();
        expect(
          (_a = result.metadata) === null || _a === void 0
            ? void 0
            : _a.messageSignature
        ).toBe(true);
        expect(
          (_b = result.metadata) === null || _b === void 0 ? void 0 : _b.message
        ).toBe("Hello, Stellar!");
      }));
    it("should throw error for unsupported chains", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield expect(
          albedoProvider.signMessage("test", "address", types_1.ChainId.BITCOIN)
        ).rejects.toThrow(errors_1.UnsupportedChainError);
      }));
    it("should handle user rejection", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockAPI = albedoProvider.albedoAPI;
        mockAPI.publicKey = jest
          .fn()
          .mockRejectedValue(new Error("User rejected the request"));
        yield expect(
          albedoProvider.signMessage("test", "address", types_1.ChainId.STELLAR)
        ).rejects.toThrow(errors_1.UserRejectedError);
      }));
    it("should handle missing signature in response", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockAPI = albedoProvider.albedoAPI;
        mockAPI.publicKey = jest.fn().mockResolvedValue({
          pubkey: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
          // Missing message_signature
        });
        yield expect(
          albedoProvider.signMessage("test", "address", types_1.ChainId.STELLAR)
        ).rejects.toThrow(errors_1.SigningError);
      }));
  });
  describe("Payment Interface", () => {
    beforeEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield albedoProvider.connect();
      })
    );
    afterEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield albedoProvider.disconnect();
      })
    );
    it("should perform payments using simplified interface", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const paymentOptions = {
          destination:
            "GCKFBEIYTKP5RDBKIXFJ2HBMKQCGGFJJP5NKQRXQC4QLQZQZQZQZQZQZ",
          amount: "100",
          memo: "Test payment",
        };
        const result = yield albedoProvider.pay(paymentOptions);
        expect(result.signature).toBeTruthy();
        expect(result.signedTransaction).toHaveProperty("envelope_xdr");
        expect(result.signedTransaction).toHaveProperty("hash");
        expect(
          (_a = result.metadata) === null || _a === void 0
            ? void 0
            : _a.paymentTransaction
        ).toBe(true);
      }));
    it("should handle payment with custom asset", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const paymentOptions = {
          destination:
            "GCKFBEIYTKP5RDBKIXFJ2HBMKQCGGFJJP5NKQRXQC4QLQZQZQZQZQZQZ",
          amount: "50",
          assetCode: "USDC",
          assetIssuer:
            "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        };
        const result = yield albedoProvider.pay(paymentOptions);
        expect(result.signature).toBeTruthy();
        expect(
          (_a = result.metadata) === null || _a === void 0
            ? void 0
            : _a.paymentTransaction
        ).toBe(true);
      }));
    it("should handle payment rejection", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockAPI = albedoProvider.albedoAPI;
        mockAPI.pay = jest
          .fn()
          .mockRejectedValue(new Error("User rejected the request"));
        const paymentOptions = {
          destination: "GTEST",
          amount: "100",
        };
        yield expect(albedoProvider.pay(paymentOptions)).rejects.toThrow(
          errors_1.UserRejectedError
        );
      }));
    it("should throw error when not connected", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield albedoProvider.disconnect();
        const paymentOptions = {
          destination: "GTEST",
          amount: "100",
        };
        yield expect(albedoProvider.pay(paymentOptions)).rejects.toThrow(
          errors_1.ConnectionError
        );
      }));
  });
  describe("Capabilities", () => {
    it("should return correct capabilities", () => {
      var _a, _b;
      const capabilities = albedoProvider.getCapabilities();
      expect(capabilities.supportedChains).toEqual([types_1.ChainId.STELLAR]);
      expect(capabilities.supportsMultipleAccounts).toBe(false);
      expect(capabilities.requiresUserInteraction).toBe(true);
      expect(capabilities.supportsMessageSigning).toBe(true);
      expect(capabilities.maxConcurrentSignatures).toBe(1);
      expect(
        (_a = capabilities.metadata) === null || _a === void 0
          ? void 0
          : _a.browserExtension
      ).toBe(true);
      expect(
        (_b = capabilities.metadata) === null || _b === void 0
          ? void 0
          : _b.stellarSpecific
      ).toBe(true);
    });
  });
  describe("Extension Detection", () => {
    it("should check if Albedo is installed", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Mock window.albedo
        const originalWindow = global.window;
        global.window = { albedo: {} };
        const isInstalled = yield albedoProvider.isAlbedoInstalled();
        expect(isInstalled).toBe(true);
        // Restore original window
        global.window = originalWindow;
      }));
    it("should return false when Albedo is not installed", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const originalWindow = global.window;
        global.window = {};
        const isInstalled = yield albedoProvider.isAlbedoInstalled();
        expect(isInstalled).toBe(false);
        global.window = originalWindow;
      }));
  });
  describe("Transaction Validation", () => {
    beforeEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield albedoProvider.connect();
      })
    );
    afterEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield albedoProvider.disconnect();
      })
    );
    it("should validate source account", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const invalidRequest = {
          transactionData: {
            chainId: types_1.ChainId.STELLAR,
            transaction: {
              fee: "100",
              sequenceNumber: "1",
              operations: [{ type: "payment" }],
              // Missing sourceAccount
            },
          },
          accountAddress:
            "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
        };
        yield expect(
          albedoProvider.signTransaction(invalidRequest)
        ).rejects.toThrow("Stellar transaction must have source account");
      }));
    it("should validate operations", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const invalidRequest = {
          transactionData: {
            chainId: types_1.ChainId.STELLAR,
            transaction: {
              sourceAccount:
                "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
              fee: "100",
              sequenceNumber: "1",
              operations: [], // Empty operations
            },
          },
          accountAddress:
            "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
        };
        yield expect(
          albedoProvider.signTransaction(invalidRequest)
        ).rejects.toThrow("Stellar transaction must have operations");
      }));
    it("should validate fee", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const invalidRequest = {
          transactionData: {
            chainId: types_1.ChainId.STELLAR,
            transaction: {
              sourceAccount:
                "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
              sequenceNumber: "1",
              operations: [{ type: "payment" }],
              // Missing fee
            },
          },
          accountAddress:
            "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
        };
        yield expect(
          albedoProvider.signTransaction(invalidRequest)
        ).rejects.toThrow("Stellar transaction must have fee");
      }));
    it("should validate sequence number", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const invalidRequest = {
          transactionData: {
            chainId: types_1.ChainId.STELLAR,
            transaction: {
              sourceAccount:
                "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
              fee: "100",
              operations: [{ type: "payment" }],
              // Missing sequenceNumber
            },
          },
          accountAddress:
            "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
        };
        yield expect(
          albedoProvider.signTransaction(invalidRequest)
        ).rejects.toThrow("Stellar transaction must have sequence number");
      }));
  });
  describe("Logging", () => {
    it("should log when debug logging is enabled", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const consoleSpy = jest.spyOn(console, "log").mockImplementation();
        albedoProvider.updateConfig({ enableDebugLogging: true });
        yield albedoProvider.connect();
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("[AlbedoSignatureProvider]"),
          expect.anything()
        );
        consoleSpy.mockRestore();
      }));
    it("should not log when debug logging is disabled", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const consoleSpy = jest.spyOn(console, "log").mockImplementation();
        albedoProvider.updateConfig({ enableDebugLogging: false });
        yield albedoProvider.connect();
        expect(consoleSpy).not.toHaveBeenCalled();
        consoleSpy.mockRestore();
      }));
  });
});
