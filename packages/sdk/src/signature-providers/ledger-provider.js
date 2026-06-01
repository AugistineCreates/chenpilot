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
exports.LedgerSignatureProvider = void 0;
const types_1 = require("../types");
const interfaces_1 = require("./interfaces");
const errors_1 = require("./errors");
/**
 * Mock Ledger transport implementation for development and testing
 */
class MockLedgerTransport {
  constructor() {
    this.isOpen = true;
    this.currentApp = "Dashboard";
    this.deviceLocked = false;
    this.deviceBusy = false;
  }
  send(cla, ins, _p1, _p2, _data) {
    return __awaiter(this, void 0, void 0, function* () {
      if (!this.isOpen) {
        throw new Error("Transport is closed");
      }
      if (this.deviceBusy) {
        throw new Error("Device is busy");
      }
      if (this.deviceLocked) {
        throw new Error("Device is locked");
      }
      // Simulate device responses based on APDU commands
      return this.simulateAPDUResponse(cla, ins, _p1, _p2, _data);
    });
  }
  close() {
    return __awaiter(this, void 0, void 0, function* () {
      this.isOpen = false;
    });
  }
  setScrambleKey(_key) {
    void _key;
    // Mock implementation
  }
  // Mock control methods for testing
  setDeviceLocked(locked) {
    this.deviceLocked = locked;
  }
  setDeviceBusy(busy) {
    this.deviceBusy = busy;
  }
  setCurrentApp(app) {
    this.currentApp = app;
  }
  simulateAPDUResponse(_cla, ins, _p1, _p2, _data) {
    return __awaiter(this, void 0, void 0, function* () {
      void _cla;
      void _p1;
      void _p2;
      void _data;
      // Simulate various APDU responses
      if (ins === 0x01) {
        // Get app info
        return Buffer.concat([
          Buffer.from(this.currentApp, "ascii"),
          Buffer.from([0x01, 0x00, 0x00]), // Version 1.0.0
          Buffer.from([0x90, 0x00]), // Success
        ]);
      }
      if (ins === 0x02) {
        // Get public key
        return Buffer.concat([
          Buffer.from(
            "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
            "hex"
          ),
          Buffer.from([0x90, 0x00]), // Success
        ]);
      }
      if (ins === 0x04) {
        // Sign transaction
        // Simulate user confirmation delay
        yield new Promise((resolve) => setTimeout(resolve, 1000));
        // Mock signature
        return Buffer.concat([
          Buffer.from(
            "304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            "hex"
          ),
          Buffer.from([0x90, 0x00]), // Success
        ]);
      }
      // Default success response
      return Buffer.from([0x90, 0x00]);
    });
  }
}
/**
 * Ledger hardware wallet signature provider implementation
 */
class LedgerSignatureProvider extends interfaces_1.BaseSignatureProvider {
  constructor(config = {}) {
    super("ledger-provider", {
      name: "Ledger Hardware Wallet",
      version: "1.0.0",
      description:
        "Ledger hardware wallet integration for secure transaction signing",
      icon: "ledger-icon.png",
      website: "https://www.ledger.com",
    });
    this.transport = null;
    this.deviceInfo = null;
    this.currentApp = null;
    this.cachedAccounts = new Map();
    this.config = Object.assign(
      {
        connectionTimeout: 10000,
        devicePollingInterval: 1000,
        maxConnectionRetries: 3,
        requiredApps: {
          [types_1.ChainId.BITCOIN]: "Bitcoin",
          [types_1.ChainId.STELLAR]: "Stellar",
          [types_1.ChainId.STARKNET]: "Starknet",
        },
        autoOpenApps: false,
        defaultDerivationPaths: {
          [types_1.ChainId.BITCOIN]: "m/84'/0'/0'/0/0",
          [types_1.ChainId.STELLAR]: "m/44'/148'/0'",
          [types_1.ChainId.STARKNET]: "m/44'/9004'/0'/0/0",
        },
        enableDebugLogging: false,
      },
      config
    );
  }
  connect() {
    return __awaiter(this, void 0, void 0, function* () {
      this.log("Attempting to connect to Ledger device...");
      try {
        // In a real implementation, this would use @ledgerhq/hw-transport-webusb
        // For now, we'll use a mock transport for development
        this.transport = yield this.createTransport();
        // Get device information
        this.deviceInfo = yield this.getDeviceInfo();
        // Get current app info
        this.currentApp = yield this.getAppInfo();
        this.connectionState = {
          isConnected: true,
          connectionId: `ledger-${this.deviceInfo.serialNumber || Date.now()}`,
          metadata: {
            deviceInfo: this.deviceInfo,
            currentApp: this.currentApp,
            connectedAt: new Date().toISOString(),
          },
        };
        this.log("Successfully connected to Ledger device");
        this.notifyConnectionChange(true);
        return this.connectionState;
      } catch (error) {
        this.log("Failed to connect to Ledger device:", error);
        if (error instanceof Error) {
          if (error.message.includes("No device found")) {
            throw new errors_1.DeviceNotFoundError(this.providerId);
          }
          if (error.message.includes("locked")) {
            throw new errors_1.DeviceLockedError(this.providerId);
          }
          if (error.message.includes("busy")) {
            throw new errors_1.DeviceBusyError(this.providerId);
          }
        }
        throw new errors_1.ConnectionError(
          `Failed to connect to Ledger: ${error}`,
          this.providerId
        );
      }
    });
  }
  disconnect() {
    return __awaiter(this, void 0, void 0, function* () {
      this.log("Disconnecting from Ledger device...");
      if (this.transport) {
        try {
          yield this.transport.close();
        } catch (error) {
          this.log("Error closing transport:", error);
        }
        this.transport = null;
      }
      this.deviceInfo = null;
      this.currentApp = null;
      this.connectionState = null;
      this.cachedAccounts.clear();
      this.log("Disconnected from Ledger device");
      this.notifyConnectionChange(false);
    });
  }
  getAccounts(chainId) {
    return __awaiter(this, void 0, void 0, function* () {
      var _a;
      this.log(`Getting accounts for chain: ${chainId}`);
      if (!this.isConnected() || !this.transport) {
        throw new errors_1.ConnectionError(
          "Ledger device not connected",
          this.providerId
        );
      }
      // Check if we have cached accounts
      const cacheKey = chainId;
      if (this.cachedAccounts.has(cacheKey)) {
        return this.cachedAccounts.get(cacheKey);
      }
      try {
        // Ensure correct app is open
        yield this.ensureAppOpen(chainId);
        // Get accounts based on chain
        const accounts = yield this.getAccountsForChain(chainId);
        // Cache the accounts
        this.cachedAccounts.set(cacheKey, accounts);
        this.log(`Found ${accounts.length} accounts for ${chainId}`);
        return accounts;
      } catch (error) {
        this.log(`Failed to get accounts for ${chainId}:`, error);
        if (error instanceof Error && error.message.includes("App not open")) {
          throw new errors_1.HardwareWalletError(
            `Please open the ${(_a = this.config.requiredApps) === null || _a === void 0 ? void 0 : _a[chainId]} app on your Ledger device`,
            this.providerId
          );
        }
        throw error;
      }
    });
  }
  signTransaction(request) {
    return __awaiter(this, void 0, void 0, function* () {
      this.log("Signing transaction:", request);
      if (!this.isConnected() || !this.transport) {
        throw new errors_1.ConnectionError(
          "Ledger device not connected",
          this.providerId
        );
      }
      const { chainId } = request.transactionData;
      try {
        // Ensure correct app is open
        yield this.ensureAppOpen(chainId);
        // Validate transaction
        this.validateTransaction(request.transactionData);
        // Sign based on chain
        const signature = yield this.signTransactionForChain(request);
        const publicKey = yield this.getPublicKeyForAccount(
          request.accountAddress,
          chainId
        );
        const result = {
          signature,
          publicKey,
          signedTransaction: this.buildSignedTransaction(request, signature),
          metadata: {
            ledgerProvider: true,
            chainId,
            deviceInfo: this.deviceInfo,
            signedAt: new Date().toISOString(),
          },
        };
        this.log("Transaction signed successfully");
        return result;
      } catch (error) {
        this.log("Failed to sign transaction:", error);
        if (error instanceof Error) {
          if (error.message.includes("User rejected")) {
            throw new errors_1.UserRejectedError(this.providerId);
          }
          if (error.message.includes("locked")) {
            throw new errors_1.DeviceLockedError(this.providerId);
          }
          if (error.message.includes("busy")) {
            throw new errors_1.DeviceBusyError(this.providerId);
          }
        }
        throw new errors_1.SigningError(
          `Failed to sign transaction: ${error}`,
          this.providerId,
          chainId
        );
      }
    });
  }
  getCapabilities() {
    return {
      supportedChains: [
        types_1.ChainId.BITCOIN,
        types_1.ChainId.STELLAR,
        types_1.ChainId.STARKNET,
      ],
      supportsMultipleAccounts: true,
      requiresUserInteraction: true,
      supportsMessageSigning: false, // Ledger typically doesn't support arbitrary message signing
      maxConcurrentSignatures: 1, // Hardware wallets handle one operation at a time
      metadata: {
        hardwareWallet: true,
        requiresPhysicalConfirmation: true,
        secureElement: true,
      },
    };
  }
  /**
   * Update provider configuration
   */
  updateConfig(newConfig) {
    this.config = Object.assign(Object.assign({}, this.config), newConfig);
  }
  /**
   * Get current configuration
   */
  getConfig() {
    return Object.assign({}, this.config);
  }
  /**
   * Check if a specific app is currently open on the device
   */
  isAppOpen(chainId) {
    return __awaiter(this, void 0, void 0, function* () {
      var _a;
      if (!this.transport || !this.currentApp) {
        return false;
      }
      const requiredApp =
        (_a = this.config.requiredApps) === null || _a === void 0
          ? void 0
          : _a[chainId];
      return this.currentApp.name === requiredApp;
    });
  }
  createTransport() {
    return __awaiter(this, void 0, void 0, function* () {
      // In a real implementation, this would be:
      // return await TransportWebUSB.create();
      // For development, return mock transport
      return new MockLedgerTransport();
    });
  }
  getDeviceInfo() {
    return __awaiter(this, void 0, void 0, function* () {
      // Mock device info for development
      return {
        productId: 0x0001,
        vendorId: 0x2c97,
        productName: "Ledger Nano S Plus",
        manufacturerName: "Ledger",
        serialNumber: "mock-serial-123",
      };
    });
  }
  getAppInfo() {
    return __awaiter(this, void 0, void 0, function* () {
      if (!this.transport) {
        throw new Error("Transport not available");
      }
      try {
        const _response = yield this.transport.send(0xb0, 0x01, 0x00, 0x00);
        void _response;
        // Parse response (mock implementation)
        return {
          name: "Dashboard",
          version: "1.0.0",
          flags: 0,
        };
      } catch (error) {
        throw new errors_1.HardwareWalletError(
          `Failed to get app info: ${error}`,
          this.providerId
        );
      }
    });
  }
  ensureAppOpen(chainId) {
    return __awaiter(this, void 0, void 0, function* () {
      var _a;
      const requiredApp =
        (_a = this.config.requiredApps) === null || _a === void 0
          ? void 0
          : _a[chainId];
      if (!requiredApp) {
        throw new errors_1.UnsupportedChainError(chainId, this.providerId);
      }
      if (yield this.isAppOpen(chainId)) {
        return;
      }
      if (this.config.autoOpenApps) {
        // In a real implementation, this would attempt to open the app
        // For now, we'll simulate the app being opened
        this.currentApp = { name: requiredApp, version: "1.0.0", flags: 0 };
      } else {
        throw new errors_1.HardwareWalletError(
          `Please open the ${requiredApp} app on your Ledger device`,
          this.providerId
        );
      }
    });
  }
  getAccountsForChain(chainId) {
    return __awaiter(this, void 0, void 0, function* () {
      var _a;
      const derivationPath =
        (_a = this.config.defaultDerivationPaths) === null || _a === void 0
          ? void 0
          : _a[chainId];
      if (!derivationPath) {
        throw new errors_1.UnsupportedChainError(chainId, this.providerId);
      }
      // Get public key for the derivation path
      const publicKey = yield this.getPublicKey(derivationPath, chainId);
      const address = this.deriveAddressFromPublicKey(publicKey, chainId);
      return [
        {
          address,
          publicKey,
          chainId,
          derivationPath,
          metadata: {
            hardwareWallet: true,
            deviceInfo: this.deviceInfo,
          },
        },
      ];
    });
  }
  getPublicKey(_derivationPath, _chainId) {
    return __awaiter(this, void 0, void 0, function* () {
      void _derivationPath;
      void _chainId;
      if (!this.transport) {
        throw new Error("Transport not available");
      }
      try {
        // In a real implementation, this would send the appropriate APDU command
        // for the specific chain to get the public key
        const _response = yield this.transport.send(0xe0, 0x02, 0x00, 0x00);
        void _response;
        // Mock public key extraction
        return "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798";
      } catch (error) {
        throw new errors_1.HardwareWalletError(
          `Failed to get public key: ${error}`,
          this.providerId
        );
      }
    });
  }
  deriveAddressFromPublicKey(_publicKey, chainId) {
    // Mock address derivation - in real implementation, this would use proper crypto
    switch (chainId) {
      case types_1.ChainId.BITCOIN:
        return "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
      case types_1.ChainId.STELLAR:
        return "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
      case types_1.ChainId.STARKNET:
        return "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
      default:
        throw new errors_1.UnsupportedChainError(chainId, this.providerId);
    }
  }
  getPublicKeyForAccount(_address, chainId) {
    return __awaiter(this, void 0, void 0, function* () {
      var _a;
      // In a real implementation, this would derive the public key for the specific account
      // For mock purposes, return a consistent public key
      return this.getPublicKey(
        ((_a = this.config.defaultDerivationPaths) === null || _a === void 0
          ? void 0
          : _a[chainId]) || "",
        chainId
      );
    });
  }
  validateTransaction(transactionData) {
    const { chainId, transaction } = transactionData;
    switch (chainId) {
      case types_1.ChainId.BITCOIN:
        this.validateBitcoinTransaction(transaction);
        break;
      case types_1.ChainId.STELLAR:
        this.validateStellarTransaction(transaction);
        break;
      case types_1.ChainId.STARKNET:
        this.validateStarknetTransaction(transaction);
        break;
      default:
        throw new errors_1.UnsupportedChainError(chainId, this.providerId);
    }
  }
  validateBitcoinTransaction(tx) {
    if (!tx.inputs || tx.inputs.length === 0) {
      throw new errors_1.InvalidTransactionError(
        "Bitcoin transaction must have inputs",
        this.providerId,
        types_1.ChainId.BITCOIN
      );
    }
    if (!tx.outputs || tx.outputs.length === 0) {
      throw new errors_1.InvalidTransactionError(
        "Bitcoin transaction must have outputs",
        this.providerId,
        types_1.ChainId.BITCOIN
      );
    }
  }
  validateStellarTransaction(tx) {
    if (!tx.sourceAccount) {
      throw new errors_1.InvalidTransactionError(
        "Stellar transaction must have source account",
        this.providerId,
        types_1.ChainId.STELLAR
      );
    }
    if (!tx.operations || tx.operations.length === 0) {
      throw new errors_1.InvalidTransactionError(
        "Stellar transaction must have operations",
        this.providerId,
        types_1.ChainId.STELLAR
      );
    }
  }
  validateStarknetTransaction(tx) {
    if (!tx.contractAddress) {
      throw new errors_1.InvalidTransactionError(
        "Starknet transaction must have contract address",
        this.providerId,
        types_1.ChainId.STARKNET
      );
    }
    if (!tx.entrypoint) {
      throw new errors_1.InvalidTransactionError(
        "Starknet transaction must have entrypoint",
        this.providerId,
        types_1.ChainId.STARKNET
      );
    }
  }
  signTransactionForChain(request) {
    return __awaiter(this, void 0, void 0, function* () {
      if (!this.transport) {
        throw new Error("Transport not available");
      }
      const { chainId } = request.transactionData;
      void chainId;
      try {
        // In a real implementation, this would send chain-specific APDU commands
        const _response = yield this.transport.send(0xe0, 0x04, 0x00, 0x00);
        void _response;
        // Extract signature from response (mock implementation)
        return "304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef02201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
      } catch (error) {
        if (error instanceof Error && error.message.includes("User rejected")) {
          throw new errors_1.UserRejectedError(this.providerId);
        }
        throw new errors_1.SigningError(
          `Failed to sign ${chainId} transaction: ${error}`,
          this.providerId,
          chainId
        );
      }
    });
  }
  buildSignedTransaction(request, signature) {
    const { chainId, transaction } = request.transactionData;
    switch (chainId) {
      case types_1.ChainId.BITCOIN:
        return Object.assign(Object.assign({}, transaction), {
          signatures: [signature],
          txid: `ledger_signed_${Date.now()}`,
        });
      case types_1.ChainId.STELLAR:
        return Object.assign(Object.assign({}, transaction), {
          signatures: [signature],
          hash: `ledger_hash_${Date.now()}`,
        });
      case types_1.ChainId.STARKNET:
        return Object.assign(Object.assign({}, transaction), {
          signature: [signature],
          transaction_hash: `0x${Date.now().toString(16)}`,
        });
      default:
        return {
          signature,
        };
    }
  }
  log(message, data) {
    if (this.config.enableDebugLogging) {
      console.log(`[LedgerSignatureProvider] ${message}`, data || "");
    }
  }
}
exports.LedgerSignatureProvider = LedgerSignatureProvider;
