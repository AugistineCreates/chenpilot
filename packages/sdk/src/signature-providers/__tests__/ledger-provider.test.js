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
const ledger_provider_1 = require("../ledger-provider");
const errors_1 = require("../errors");
// Mock the transport for testing
jest.mock("../ledger-provider", () => {
  const actual = jest.requireActual("../ledger-provider");
  class MockLedgerTransport {
    constructor() {
      this.isOpen = true;
      this.currentApp = "Dashboard";
      this.deviceLocked = false;
      this.deviceBusy = false;
      this.shouldFailConnection = false;
      this.shouldRejectSigning = false;
    }
    send(cla, ins, _p1, _p2, _data) {
      return __awaiter(this, void 0, void 0, function* () {
        void cla;
        void ins;
        void _p1;
        void _p2;
        void _data;
        if (!this.isOpen) {
          throw new Error("Transport is closed");
        }
        if (this.shouldFailConnection) {
          throw new Error("No device found");
        }
        if (this.deviceBusy) {
          throw new Error("Device is busy");
        }
        if (this.deviceLocked) {
          throw new Error("Device is locked");
        }
        if (this.shouldRejectSigning && ins === 0x04) {
          throw new Error("User rejected");
        }
        // Simulate device responses
        if (ins === 0x01) {
          // Get app info
          return Buffer.concat([
            Buffer.from(this.currentApp, "ascii"),
            Buffer.from([0x01, 0x00, 0x00]),
            Buffer.from([0x90, 0x00]),
          ]);
        }
        if (ins === 0x02) {
          // Get public key
          return Buffer.concat([
            Buffer.from(
              "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
              "hex"
            ),
            Buffer.from([0x90, 0x00]),
          ]);
        }
        if (ins === 0x04) {
          // Sign transaction
          yield new Promise((resolve) => setTimeout(resolve, 100));
          return Buffer.concat([
            Buffer.from(
              "304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
              "hex"
            ),
            Buffer.from([0x90, 0x00]),
          ]);
        }
        return Buffer.from([0x90, 0x00]);
      });
    }
    close() {
      return __awaiter(this, void 0, void 0, function* () {
        this.isOpen = false;
      });
    }
    setScrambleKey(_key) {
      void _key;
    }
    // Test control methods
    setDeviceLocked(locked) {
      this.deviceLocked = locked;
    }
    setDeviceBusy(busy) {
      this.deviceBusy = busy;
    }
    setCurrentApp(app) {
      this.currentApp = app;
    }
    setShouldFailConnection(fail) {
      this.shouldFailConnection = fail;
    }
    setShouldRejectSigning(reject) {
      this.shouldRejectSigning = reject;
    }
  }
  return Object.assign(Object.assign({}, actual), { MockLedgerTransport });
});
describe("LedgerSignatureProvider", () => {
  let ledgerProvider;
  let _mockTransport;
  beforeEach(() => {
    ledgerProvider = new ledger_provider_1.LedgerSignatureProvider();
    void _mockTransport;
    // Access the mock transport through the provider's private methods
    // In a real test, we'd mock the transport creation
  });
  describe("Initialization and Configuration", () => {
    it("should initialize with default configuration", () => {
      expect(ledgerProvider.providerId).toBe("ledger-provider");
      expect(ledgerProvider.metadata.name).toBe("Ledger Hardware Wallet");
      expect(ledgerProvider.isConnected()).toBe(false);
    });
    it("should accept custom configuration", () => {
      const config = {
        connectionTimeout: 5000,
        autoOpenApps: true,
        enableDebugLogging: true,
      };
      const customProvider = new ledger_provider_1.LedgerSignatureProvider(
        config
      );
      const providerConfig = customProvider.getConfig();
      expect(providerConfig.connectionTimeout).toBe(5000);
      expect(providerConfig.autoOpenApps).toBe(true);
      expect(providerConfig.enableDebugLogging).toBe(true);
    });
    it("should update configuration", () => {
      ledgerProvider.updateConfig({
        connectionTimeout: 15000,
        autoOpenApps: true,
      });
      const config = ledgerProvider.getConfig();
      expect(config.connectionTimeout).toBe(15000);
      expect(config.autoOpenApps).toBe(true);
    });
  });
  describe("Connection Management", () => {
    it("should connect successfully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        const connection = yield ledgerProvider.connect();
        expect(ledgerProvider.isConnected()).toBe(true);
        expect(connection.isConnected).toBe(true);
        expect(connection.connectionId).toMatch(/^ledger-/);
        expect(
          (_a = connection.metadata) === null || _a === void 0
            ? void 0
            : _a.deviceInfo
        ).toBeDefined();
        expect(
          (_b = connection.metadata) === null || _b === void 0
            ? void 0
            : _b.currentApp
        ).toBeDefined();
      }));
    it("should handle device not found error", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Mock transport creation to fail
        const originalCreateTransport = ledgerProvider.createTransport;
        ledgerProvider.createTransport = jest
          .fn()
          .mockRejectedValue(new Error("No device found"));
        yield expect(ledgerProvider.connect()).rejects.toThrow(
          errors_1.DeviceNotFoundError
        );
        // Restore original method
        ledgerProvider.createTransport = originalCreateTransport;
      }));
    it("should handle device locked error", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const originalCreateTransport = ledgerProvider.createTransport;
        ledgerProvider.createTransport = jest
          .fn()
          .mockRejectedValue(new Error("Device is locked"));
        yield expect(ledgerProvider.connect()).rejects.toThrow(
          errors_1.DeviceLockedError
        );
        ledgerProvider.createTransport = originalCreateTransport;
      }));
    it("should handle device busy error", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const originalCreateTransport = ledgerProvider.createTransport;
        ledgerProvider.createTransport = jest
          .fn()
          .mockRejectedValue(new Error("Device is busy"));
        yield expect(ledgerProvider.connect()).rejects.toThrow(
          errors_1.DeviceBusyError
        );
        ledgerProvider.createTransport = originalCreateTransport;
      }));
    it("should disconnect successfully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield ledgerProvider.connect();
        expect(ledgerProvider.isConnected()).toBe(true);
        yield ledgerProvider.disconnect();
        expect(ledgerProvider.isConnected()).toBe(false);
      }));
    it("should notify connection state changes", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const connectionCallback = jest.fn();
        ledgerProvider.onConnectionChange(connectionCallback);
        yield ledgerProvider.connect();
        expect(connectionCallback).toHaveBeenCalledWith(true);
        yield ledgerProvider.disconnect();
        expect(connectionCallback).toHaveBeenCalledWith(false);
      }));
  });
  describe("Account Management", () => {
    beforeEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield ledgerProvider.connect();
      })
    );
    afterEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield ledgerProvider.disconnect();
      })
    );
    it("should get Bitcoin accounts", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        // Mock the app to be Bitcoin
        ledgerProvider.currentApp = {
          name: "Bitcoin",
          version: "1.0.0",
          flags: 0,
        };
        const accounts = yield ledgerProvider.getAccounts(
          types_1.ChainId.BITCOIN
        );
        expect(accounts).toHaveLength(1);
        expect(accounts[0].chainId).toBe(types_1.ChainId.BITCOIN);
        expect(accounts[0].address).toMatch(/^bc1/);
        expect(accounts[0].derivationPath).toBe("m/84'/0'/0'/0/0");
        expect(
          (_a = accounts[0].metadata) === null || _a === void 0
            ? void 0
            : _a.hardwareWallet
        ).toBe(true);
      }));
    it("should get Stellar accounts", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        ledgerProvider.currentApp = {
          name: "Stellar",
          version: "1.0.0",
          flags: 0,
        };
        const accounts = yield ledgerProvider.getAccounts(
          types_1.ChainId.STELLAR
        );
        expect(accounts).toHaveLength(1);
        expect(accounts[0].chainId).toBe(types_1.ChainId.STELLAR);
        expect(accounts[0].address).toMatch(/^G/);
        expect(accounts[0].derivationPath).toBe("m/44'/148'/0'");
      }));
    it("should get Starknet accounts", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        ledgerProvider.currentApp = {
          name: "Starknet",
          version: "1.0.0",
          flags: 0,
        };
        const accounts = yield ledgerProvider.getAccounts(
          types_1.ChainId.STARKNET
        );
        expect(accounts).toHaveLength(1);
        expect(accounts[0].chainId).toBe(types_1.ChainId.STARKNET);
        expect(accounts[0].address).toMatch(/^0x/);
        expect(accounts[0].derivationPath).toBe("m/44'/9004'/0'/0/0");
      }));
    it("should cache accounts", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        ledgerProvider.currentApp = {
          name: "Bitcoin",
          version: "1.0.0",
          flags: 0,
        };
        const accounts1 = yield ledgerProvider.getAccounts(
          types_1.ChainId.BITCOIN
        );
        const accounts2 = yield ledgerProvider.getAccounts(
          types_1.ChainId.BITCOIN
        );
        expect(accounts1).toBe(accounts2); // Should return cached instance
      }));
    it("should throw error when device not connected", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield ledgerProvider.disconnect();
        yield expect(
          ledgerProvider.getAccounts(types_1.ChainId.BITCOIN)
        ).rejects.toThrow(errors_1.ConnectionError);
      }));
    it("should throw error when wrong app is open", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        ledgerProvider.currentApp = {
          name: "Dashboard",
          version: "1.0.0",
          flags: 0,
        };
        yield expect(
          ledgerProvider.getAccounts(types_1.ChainId.BITCOIN)
        ).rejects.toThrow(errors_1.HardwareWalletError);
      }));
  });
  describe("Transaction Signing", () => {
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
      accountAddress:
        "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
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
    beforeEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield ledgerProvider.connect();
      })
    );
    afterEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield ledgerProvider.disconnect();
      })
    );
    it("should sign Bitcoin transactions", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b;
        ledgerProvider.currentApp = {
          name: "Bitcoin",
          version: "1.0.0",
          flags: 0,
        };
        const request = createBitcoinSigningRequest();
        const result = yield ledgerProvider.signTransaction(request);
        expect(result.signature).toMatch(/^304402/); // DER signature format
        expect(result.publicKey).toBeTruthy();
        expect(result.signedTransaction).toHaveProperty("signatures");
        expect(
          (_a = result.metadata) === null || _a === void 0
            ? void 0
            : _a.ledgerProvider
        ).toBe(true);
        expect(
          (_b = result.metadata) === null || _b === void 0 ? void 0 : _b.chainId
        ).toBe(types_1.ChainId.BITCOIN);
      }));
    it("should sign Stellar transactions", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        ledgerProvider.currentApp = {
          name: "Stellar",
          version: "1.0.0",
          flags: 0,
        };
        const request = createStellarSigningRequest();
        const result = yield ledgerProvider.signTransaction(request);
        expect(result.signature).toBeTruthy();
        expect(result.publicKey).toBeTruthy();
        expect(result.signedTransaction).toHaveProperty("signatures");
        expect(
          (_a = result.metadata) === null || _a === void 0 ? void 0 : _a.chainId
        ).toBe(types_1.ChainId.STELLAR);
      }));
    it("should sign Starknet transactions", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        ledgerProvider.currentApp = {
          name: "Starknet",
          version: "1.0.0",
          flags: 0,
        };
        const request = createStarknetSigningRequest();
        const result = yield ledgerProvider.signTransaction(request);
        expect(result.signature).toBeTruthy();
        expect(result.publicKey).toBeTruthy();
        expect(result.signedTransaction).toHaveProperty("signature");
        expect(
          (_a = result.metadata) === null || _a === void 0 ? void 0 : _a.chainId
        ).toBe(types_1.ChainId.STARKNET);
      }));
    it("should throw error when device not connected", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield ledgerProvider.disconnect();
        yield expect(
          ledgerProvider.signTransaction(createBitcoinSigningRequest())
        ).rejects.toThrow(errors_1.ConnectionError);
      }));
    it("should handle user rejection", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        ledgerProvider.currentApp = {
          name: "Bitcoin",
          version: "1.0.0",
          flags: 0,
        };
        // Mock transport to simulate user rejection
        const originalTransport = ledgerProvider.transport;
        ledgerProvider.transport = {
          send: jest.fn().mockRejectedValue(new Error("User rejected")),
        };
        yield expect(
          ledgerProvider.signTransaction(createBitcoinSigningRequest())
        ).rejects.toThrow(errors_1.UserRejectedError);
        ledgerProvider.transport = originalTransport;
      }));
    it("should validate transaction format", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        ledgerProvider.currentApp = {
          name: "Bitcoin",
          version: "1.0.0",
          flags: 0,
        };
        const invalidRequest = {
          transactionData: {
            chainId: types_1.ChainId.BITCOIN,
            transaction: { inputs: [] }, // Invalid: no outputs
          },
          accountAddress: "test-address",
        };
        yield expect(
          ledgerProvider.signTransaction(invalidRequest)
        ).rejects.toThrow(errors_1.InvalidTransactionError);
      }));
    it("should handle device locked during signing", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        ledgerProvider.currentApp = {
          name: "Bitcoin",
          version: "1.0.0",
          flags: 0,
        };
        const originalTransport = ledgerProvider.transport;
        ledgerProvider.transport = {
          send: jest.fn().mockRejectedValue(new Error("Device is locked")),
        };
        yield expect(
          ledgerProvider.signTransaction(createBitcoinSigningRequest())
        ).rejects.toThrow(errors_1.DeviceLockedError);
        ledgerProvider.transport = originalTransport;
      }));
    it("should handle device busy during signing", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        ledgerProvider.currentApp = {
          name: "Bitcoin",
          version: "1.0.0",
          flags: 0,
        };
        const originalTransport = ledgerProvider.transport;
        ledgerProvider.transport = {
          send: jest.fn().mockRejectedValue(new Error("Device is busy")),
        };
        yield expect(
          ledgerProvider.signTransaction(createBitcoinSigningRequest())
        ).rejects.toThrow(errors_1.DeviceBusyError);
        ledgerProvider.transport = originalTransport;
      }));
  });
  describe("Capabilities", () => {
    it("should return correct capabilities", () => {
      var _a, _b, _c;
      const capabilities = ledgerProvider.getCapabilities();
      expect(capabilities.supportedChains).toEqual([
        types_1.ChainId.BITCOIN,
        types_1.ChainId.STELLAR,
        types_1.ChainId.STARKNET,
      ]);
      expect(capabilities.supportsMultipleAccounts).toBe(true);
      expect(capabilities.requiresUserInteraction).toBe(true);
      expect(capabilities.supportsMessageSigning).toBe(false);
      expect(capabilities.maxConcurrentSignatures).toBe(1);
      expect(
        (_a = capabilities.metadata) === null || _a === void 0
          ? void 0
          : _a.hardwareWallet
      ).toBe(true);
      expect(
        (_b = capabilities.metadata) === null || _b === void 0
          ? void 0
          : _b.requiresPhysicalConfirmation
      ).toBe(true);
      expect(
        (_c = capabilities.metadata) === null || _c === void 0
          ? void 0
          : _c.secureElement
      ).toBe(true);
    });
  });
  describe("App Management", () => {
    beforeEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield ledgerProvider.connect();
      })
    );
    afterEach(() =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield ledgerProvider.disconnect();
      })
    );
    it("should check if app is open", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        ledgerProvider.currentApp = {
          name: "Bitcoin",
          version: "1.0.0",
          flags: 0,
        };
        const isBitcoinOpen = yield ledgerProvider.isAppOpen(
          types_1.ChainId.BITCOIN
        );
        const isStellarOpen = yield ledgerProvider.isAppOpen(
          types_1.ChainId.STELLAR
        );
        expect(isBitcoinOpen).toBe(true);
        expect(isStellarOpen).toBe(false);
      }));
    it("should handle auto-open apps when enabled", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        ledgerProvider.updateConfig({ autoOpenApps: true });
        ledgerProvider.currentApp = {
          name: "Dashboard",
          version: "1.0.0",
          flags: 0,
        };
        // This should not throw when autoOpenApps is enabled
        const accounts = yield ledgerProvider.getAccounts(
          types_1.ChainId.BITCOIN
        );
        expect(accounts).toBeDefined();
      }));
  });
  describe("Error Handling", () => {
    it("should handle transport errors gracefully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield ledgerProvider.connect();
        const originalTransport = ledgerProvider.transport;
        ledgerProvider.transport = {
          send: jest.fn().mockRejectedValue(new Error("Transport error")),
        };
        yield expect(
          ledgerProvider.getAccounts(types_1.ChainId.BITCOIN)
        ).rejects.toThrow();
        ledgerProvider.transport = originalTransport;
      }));
    it("should handle unsupported chains", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield ledgerProvider.connect();
        yield expect(
          ledgerProvider.getAccounts("unsupported-chain")
        ).rejects.toThrow(errors_1.UnsupportedChainError);
      }));
    it("should clear cache on disconnect", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield ledgerProvider.connect();
        ledgerProvider.currentApp = {
          name: "Bitcoin",
          version: "1.0.0",
          flags: 0,
        };
        // Get accounts to populate cache
        yield ledgerProvider.getAccounts(types_1.ChainId.BITCOIN);
        expect(ledgerProvider.cachedAccounts.size).toBe(1);
        yield ledgerProvider.disconnect();
        expect(ledgerProvider.cachedAccounts.size).toBe(0);
      }));
  });
  describe("Logging", () => {
    it("should log when debug logging is enabled", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const consoleSpy = jest.spyOn(console, "log").mockImplementation();
        ledgerProvider.updateConfig({ enableDebugLogging: true });
        yield ledgerProvider.connect();
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("[LedgerSignatureProvider]"),
          expect.anything()
        );
        consoleSpy.mockRestore();
      }));
    it("should not log when debug logging is disabled", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const consoleSpy = jest.spyOn(console, "log").mockImplementation();
        ledgerProvider.updateConfig({ enableDebugLogging: false });
        yield ledgerProvider.connect();
        expect(consoleSpy).not.toHaveBeenCalled();
        consoleSpy.mockRestore();
      }));
  });
});
