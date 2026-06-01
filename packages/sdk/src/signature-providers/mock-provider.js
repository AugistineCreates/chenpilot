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
exports.MockSignatureProvider = void 0;
const types_1 = require("../types");
const interfaces_1 = require("./interfaces");
const errors_1 = require("./errors");
/**
 * Mock signature provider for testing and development.
 * Supports all chains and provides configurable behavior for various test scenarios.
 */
class MockSignatureProvider extends interfaces_1.BaseSignatureProvider {
  constructor(
    providerId = "mock-provider",
    metadata = {
      name: "Mock Signature Provider",
      version: "1.0.0",
      description: "Mock provider for testing and development",
      icon: "mock-icon.png",
    },
    config = {}
  ) {
    super(providerId, metadata);
    this.signatureCounter = 0;
    this.config = Object.assign(
      {
        connectionDelay: 100,
        signingDelay: 200,
        networkLatency: 50,
        rejectionRate: 0,
        networkFailureRate: 0,
        enableLogging: false,
      },
      config
    );
    this.mockAccounts = this.initializeDefaultAccounts();
    if (config.accounts) {
      this.mockAccounts = Object.assign(
        Object.assign({}, this.mockAccounts),
        config.accounts
      );
    }
  }
  /**
   * Update the mock provider configuration
   */
  updateConfig(newConfig) {
    this.config = Object.assign(Object.assign({}, this.config), newConfig);
    if (newConfig.accounts) {
      this.mockAccounts = Object.assign(
        Object.assign({}, this.mockAccounts),
        newConfig.accounts
      );
    }
  }
  /**
   * Reset the provider to default state
   */
  reset() {
    this.connectionState = null;
    this.signatureCounter = 0;
    this.config = {
      connectionDelay: 100,
      signingDelay: 200,
      networkLatency: 50,
      rejectionRate: 0,
      networkFailureRate: 0,
      enableLogging: false,
    };
    this.mockAccounts = this.initializeDefaultAccounts();
  }
  connect() {
    return __awaiter(this, void 0, void 0, function* () {
      this.log("Attempting to connect...");
      yield this.simulateDelay(this.config.connectionDelay);
      yield this.simulateNetworkConditions();
      if (this.config.shouldFailConnection) {
        const error =
          this.config.connectionError ||
          new errors_1.ConnectionError(
            "Mock connection failed",
            this.providerId
          );
        this.log("Connection failed:", error.message);
        throw error;
      }
      this.connectionState = {
        isConnected: true,
        connectionId: `mock-connection-${Date.now()}`,
        metadata: {
          mockProvider: true,
          connectedAt: new Date().toISOString(),
        },
      };
      this.log("Connected successfully");
      this.notifyConnectionChange(true);
      return this.connectionState;
    });
  }
  disconnect() {
    return __awaiter(this, void 0, void 0, function* () {
      this.log("Disconnecting...");
      yield this.simulateDelay(50);
      this.connectionState = null;
      this.log("Disconnected");
      this.notifyConnectionChange(false);
    });
  }
  getAccounts(chainId) {
    return __awaiter(this, void 0, void 0, function* () {
      this.log(`Getting accounts for chain: ${chainId}`);
      yield this.simulateDelay(this.config.networkLatency);
      yield this.simulateNetworkConditions();
      if (this.config.shouldFailGetAccounts) {
        const error =
          this.config.getAccountsError ||
          new errors_1.SigningError(
            "Mock get accounts failed",
            this.providerId,
            chainId
          );
        this.log("Get accounts failed:", error.message);
        throw error;
      }
      const accounts = this.mockAccounts[chainId] || [];
      this.log(`Found ${accounts.length} accounts for ${chainId}`);
      return accounts;
    });
  }
  signTransaction(request) {
    return __awaiter(this, void 0, void 0, function* () {
      this.log("Signing transaction:", request);
      yield this.simulateDelay(this.config.signingDelay);
      yield this.simulateNetworkConditions();
      // Simulate user rejection
      if (
        this.config.shouldRejectSigning ||
        Math.random() < (this.config.rejectionRate || 0)
      ) {
        const error = new errors_1.UserRejectedError(this.providerId);
        this.log("Transaction rejected by user");
        throw error;
      }
      // Simulate signing failure
      if (this.config.shouldFailSigning) {
        const error =
          this.config.signingError ||
          new errors_1.SigningError(
            "Mock signing failed",
            this.providerId,
            request.transactionData.chainId
          );
        this.log("Signing failed:", error.message);
        throw error;
      }
      // Validate transaction format
      this.validateTransaction(request.transactionData);
      // Generate mock signature
      const signature = this.generateMockSignature(request);
      const publicKey = this.generateMockPublicKey(
        request.accountAddress,
        request.transactionData.chainId
      );
      const signedTransaction = this.generateMockSignedTransaction(request);
      const result = {
        signature,
        publicKey,
        signedTransaction,
        metadata: {
          mockProvider: true,
          signatureCounter: ++this.signatureCounter,
          signedAt: new Date().toISOString(),
          chainId: request.transactionData.chainId,
        },
      };
      this.log("Transaction signed successfully:", result);
      return result;
    });
  }
  signMessage(message, accountAddress, chainId) {
    return __awaiter(this, void 0, void 0, function* () {
      this.log(`Signing message for ${chainId}:`, { message, accountAddress });
      yield this.simulateDelay(this.config.signingDelay);
      yield this.simulateNetworkConditions();
      if (this.config.shouldFailMessageSigning) {
        const error =
          this.config.messageSigningError ||
          new errors_1.SigningError(
            "Mock message signing failed",
            this.providerId,
            chainId
          );
        this.log("Message signing failed:", error.message);
        throw error;
      }
      const signature = this.generateMockMessageSignature(
        message,
        accountAddress,
        chainId
      );
      const publicKey = this.generateMockPublicKey(accountAddress, chainId);
      const result = {
        signature,
        publicKey,
        metadata: {
          mockProvider: true,
          messageSignature: true,
          signedAt: new Date().toISOString(),
          chainId,
          message,
        },
      };
      this.log("Message signed successfully:", result);
      return result;
    });
  }
  getCapabilities() {
    const defaultCapabilities = {
      supportedChains: [
        types_1.ChainId.BITCOIN,
        types_1.ChainId.STELLAR,
        types_1.ChainId.STARKNET,
      ],
      supportsMultipleAccounts: true,
      requiresUserInteraction: false,
      supportsMessageSigning: true,
      maxConcurrentSignatures: 10,
      metadata: {
        mockProvider: true,
        testingCapabilities: true,
      },
    };
    return Object.assign(
      Object.assign({}, defaultCapabilities),
      this.config.customCapabilities
    );
  }
  /**
   * Simulate specific error scenarios for testing
   */
  simulateError(error) {
    this.log("Simulating error:", error);
    throw error;
  }
  /**
   * Get current mock configuration
   */
  getConfig() {
    return Object.assign({}, this.config);
  }
  /**
   * Get mock accounts for all chains
   */
  getMockAccounts() {
    return Object.assign({}, this.mockAccounts);
  }
  /**
   * Add mock accounts for a specific chain
   */
  addMockAccounts(chainId, accounts) {
    if (!this.mockAccounts[chainId]) {
      this.mockAccounts[chainId] = [];
    }
    this.mockAccounts[chainId].push(...accounts);
    this.log(`Added ${accounts.length} mock accounts for ${chainId}`);
  }
  /**
   * Clear mock accounts for a specific chain
   */
  clearMockAccounts(chainId) {
    this.mockAccounts[chainId] = [];
    this.log(`Cleared mock accounts for ${chainId}`);
  }
  initializeDefaultAccounts() {
    return {
      [types_1.ChainId.BITCOIN]: [
        {
          address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
          publicKey:
            "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
          chainId: types_1.ChainId.BITCOIN,
          derivationPath: "m/84'/0'/0'/0/0",
          metadata: { accountName: "Bitcoin Account 1", balance: "0.001 BTC" },
        },
        {
          address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
          publicKey:
            "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81799",
          chainId: types_1.ChainId.BITCOIN,
          derivationPath: "m/84'/0'/0'/0/1",
          metadata: { accountName: "Bitcoin Account 2", balance: "0.005 BTC" },
        },
      ],
      [types_1.ChainId.STELLAR]: [
        {
          address: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
          publicKey: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
          chainId: types_1.ChainId.STELLAR,
          derivationPath: "m/44'/148'/0'",
          metadata: { accountName: "Stellar Account 1", balance: "100 XLM" },
        },
        {
          address: "GCKFBEIYTKP5RDBKIXFJ2HBMKQCGGFJJP5NKQRXQC4QLQZQZQZQZQZQZ",
          publicKey: "GCKFBEIYTKP5RDBKIXFJ2HBMKQCGGFJJP5NKQRXQC4QLQZQZQZQZQZQZ",
          chainId: types_1.ChainId.STELLAR,
          derivationPath: "m/44'/148'/1'",
          metadata: { accountName: "Stellar Account 2", balance: "250 XLM" },
        },
      ],
      [types_1.ChainId.STARKNET]: [
        {
          address:
            "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
          publicKey:
            "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
          chainId: types_1.ChainId.STARKNET,
          derivationPath: "m/44'/9004'/0'/0/0",
          metadata: { accountName: "Starknet Account 1", balance: "1.5 ETH" },
        },
        {
          address:
            "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          publicKey:
            "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          chainId: types_1.ChainId.STARKNET,
          derivationPath: "m/44'/9004'/0'/0/1",
          metadata: { accountName: "Starknet Account 2", balance: "0.8 ETH" },
        },
      ],
    };
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
        throw new errors_1.InvalidTransactionError(
          `Unsupported chain: ${chainId}`,
          this.providerId,
          chainId
        );
    }
  }
  validateBitcoinTransaction(tx) {
    if (!tx.inputs || !Array.isArray(tx.inputs) || tx.inputs.length === 0) {
      throw new errors_1.InvalidTransactionError(
        "Bitcoin transaction must have inputs",
        this.providerId,
        types_1.ChainId.BITCOIN
      );
    }
    if (!tx.outputs || !Array.isArray(tx.outputs) || tx.outputs.length === 0) {
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
    if (
      !tx.operations ||
      !Array.isArray(tx.operations) ||
      tx.operations.length === 0
    ) {
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
  generateMockSignature(request) {
    const { chainId } = request.transactionData;
    const timestamp = Date.now();
    const counter = this.signatureCounter;
    // Generate chain-specific mock signatures
    switch (chainId) {
      case types_1.ChainId.BITCOIN:
        return `304402${timestamp.toString(16).padStart(8, "0")}${counter.toString(16).padStart(4, "0")}`;
      case types_1.ChainId.STELLAR:
        return `${timestamp.toString(16).padStart(16, "0")}${counter.toString(16).padStart(8, "0")}`.padEnd(
          128,
          "0"
        );
      case types_1.ChainId.STARKNET:
        return `0x${timestamp.toString(16).padStart(16, "0")}${counter.toString(16).padStart(8, "0")}`.padEnd(
          66,
          "0"
        );
      default:
        return `mock_signature_${timestamp}_${counter}`;
    }
  }
  generateMockPublicKey(address, chainId) {
    // For mock purposes, derive public key from address
    const hash = this.simpleHash(address + chainId);
    switch (chainId) {
      case types_1.ChainId.BITCOIN:
        return `02${hash.substring(0, 62)}`;
      case types_1.ChainId.STELLAR:
        return address; // Stellar addresses are public keys
      case types_1.ChainId.STARKNET:
        return `0x${hash.substring(0, 62)}`;
      default:
        return `mock_pubkey_${hash.substring(0, 16)}`;
    }
  }
  generateMockSignedTransaction(request) {
    const { chainId, transaction } = request.transactionData;
    switch (chainId) {
      case types_1.ChainId.BITCOIN:
        return Object.assign(Object.assign({}, transaction), {
          signatures: [`mock_signature_${this.signatureCounter}`],
          txid: `mock_txid_${Date.now()}`,
        });
      case types_1.ChainId.STELLAR:
        return Object.assign(Object.assign({}, transaction), {
          signatures: [`mock_signature_${this.signatureCounter}`],
          hash: `mock_hash_${Date.now()}`,
        });
      case types_1.ChainId.STARKNET:
        return Object.assign(Object.assign({}, transaction), {
          signature: [
            `0x${this.signatureCounter.toString(16)}`,
            `0x${Date.now().toString(16)}`,
          ],
          transaction_hash: `0x${Date.now().toString(16)}`,
        });
      default:
        return Object.assign(Object.assign({}, transaction), {
          signature: `mock_signature_${this.signatureCounter}`,
        });
    }
  }
  generateMockMessageSignature(message, address, chainId) {
    const hash = this.simpleHash(message + address + chainId);
    return `mock_msg_sig_${hash.substring(0, 16)}`;
  }
  simulateDelay(ms) {
    return __awaiter(this, void 0, void 0, function* () {
      if (ms && ms > 0) {
        yield new Promise((resolve) => setTimeout(resolve, ms));
      }
    });
  }
  simulateNetworkConditions() {
    return __awaiter(this, void 0, void 0, function* () {
      // Simulate network latency
      if (this.config.networkLatency) {
        yield this.simulateDelay(this.config.networkLatency);
      }
      // Simulate network failures
      if (
        this.config.networkFailureRate &&
        Math.random() < this.config.networkFailureRate
      ) {
        throw new errors_1.NetworkError(
          "Simulated network failure",
          this.providerId
        );
      }
    });
  }
  simpleHash(input) {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, "0").repeat(8);
  }
  log(message, data) {
    if (this.config.enableLogging) {
      console.log(
        `[MockSignatureProvider:${this.providerId}] ${message}`,
        data || ""
      );
    }
  }
}
exports.MockSignatureProvider = MockSignatureProvider;
