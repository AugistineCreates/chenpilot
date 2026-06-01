"use strict";
/**
 * @fileoverview Hardware Wallet Integration Example
 *
 * This example demonstrates comprehensive hardware wallet integration
 * including device management, app switching, derivation paths,
 * and error handling for Ledger devices.
 */
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
exports.HardwareWalletManager = void 0;
exports.hardwareWalletExample = hardwareWalletExample;
const src_1 = require("../src");
/**
 * Hardware wallet manager for comprehensive device integration
 */
class HardwareWalletManager {
  constructor() {
    this.ledgerProvider = null;
    this.deviceInfo = null;
    this.derivationConfigs = new Map();
    this.sdk = new src_1.SignatureProviderSDK({
      enableLogging: true,
      enableMetrics: true,
    });
    // Setup default derivation paths
    this.setupDefaultDerivationPaths();
  }
  /**
   * Initialize the hardware wallet manager
   */
  initialize() {
    return __awaiter(this, void 0, void 0, function* () {
      console.log("🔌 Initializing Hardware Wallet Manager...");
      yield this.sdk.initialize();
      console.log("✅ Hardware wallet manager initialized");
    });
  }
  /**
   * Connect to Ledger device with comprehensive error handling
   */
  connectLedger(config) {
    return __awaiter(this, void 0, void 0, function* () {
      console.log("🔗 Connecting to Ledger device...");
      const ledgerConfig = Object.assign(
        {
          connectionTimeout: 15000,
          devicePollingInterval: 1000,
          maxConnectionRetries: 5,
          autoOpenApps: false,
          enableDebugLogging: true,
        },
        config
      );
      try {
        this.ledgerProvider = new src_1.LedgerSignatureProvider(ledgerConfig);
        // Attempt connection with retry logic
        yield this.connectWithRetry();
        // Get device information
        this.deviceInfo = yield this.getDeviceInfo();
        console.log("✅ Ledger connected successfully");
        console.log(`   Device: ${this.deviceInfo.productName}`);
        console.log(`   Firmware: ${this.deviceInfo.firmwareVersion}`);
        console.log(
          `   Current App: ${this.deviceInfo.currentApp || "Dashboard"}`
        );
        return this.deviceInfo;
      } catch (error) {
        console.error("❌ Failed to connect to Ledger:", error);
        yield this.handleConnectionError(error);
        throw error;
      }
    });
  }
  /**
   * Switch to specific app on Ledger device
   */
  switchToApp(chainId) {
    return __awaiter(this, void 0, void 0, function* () {
      if (!this.ledgerProvider) {
        throw new Error("Ledger not connected");
      }
      const appName = this.getRequiredApp(chainId);
      console.log(`📱 Switching to ${appName} app for ${chainId}...`);
      try {
        // Check if correct app is already open
        const isCorrectApp = yield this.ledgerProvider.isAppOpen(chainId);
        if (isCorrectApp) {
          console.log(`✅ ${appName} app already open`);
          return true;
        }
        // In a real implementation, this would guide the user to open the app
        console.log(`👆 Please open the ${appName} app on your Ledger device`);
        // Simulate waiting for user to open app
        yield this.waitForAppOpen(chainId, 30000); // 30 second timeout
        console.log(`✅ ${appName} app opened successfully`);
        return true;
      } catch (error) {
        console.error(`❌ Failed to switch to ${appName} app:`, error);
        return false;
      }
    });
  }
  /**
   * Get accounts for specific chain with custom derivation
   */
  getAccountsForChain(chainId, customDerivation) {
    return __awaiter(this, void 0, void 0, function* () {
      if (!this.ledgerProvider) {
        throw new Error("Ledger not connected");
      }
      console.log(`👛 Getting accounts for ${chainId}...`);
      try {
        // Ensure correct app is open
        yield this.switchToApp(chainId);
        // Use custom derivation or default
        const derivationConfig =
          customDerivation || this.derivationConfigs.get(chainId);
        if (derivationConfig) {
          this.updateDerivationPath(chainId, derivationConfig.derivationPath);
        }
        // Get accounts from provider
        const accounts = yield this.ledgerProvider.getAccounts(chainId);
        console.log(`✅ Found ${accounts.length} accounts for ${chainId}`);
        // Enhance accounts with additional information
        const enhancedAccounts = yield Promise.all(
          accounts.map((account) =>
            __awaiter(this, void 0, void 0, function* () {
              return {
                address: account.address,
                publicKey: account.publicKey,
                derivationPath: account.derivationPath,
                balance: yield this.getAccountBalance(chainId, account.address),
              };
            })
          )
        );
        return enhancedAccounts;
      } catch (error) {
        console.error(`❌ Failed to get accounts for ${chainId}:`, error);
        throw error;
      }
    });
  }
  /**
   * Sign transaction with comprehensive error handling
   */
  signTransaction(chainId, transaction, accountAddress) {
    return __awaiter(this, void 0, void 0, function* () {
      var _a;
      if (!this.ledgerProvider) {
        throw new Error("Ledger not connected");
      }
      console.log(`✍️  Signing ${chainId} transaction...`);
      console.log(`   Account: ${accountAddress}`);
      try {
        // Ensure correct app is open
        yield this.switchToApp(chainId);
        // Validate transaction format
        this.validateTransactionFormat(chainId, transaction);
        // Create signature request
        const signatureRequest = {
          transactionData: { chainId, transaction },
          accountAddress,
          metadata: {
            hardwareWallet: true,
            deviceId:
              (_a = this.deviceInfo) === null || _a === void 0
                ? void 0
                : _a.deviceId,
            timestamp: new Date().toISOString(),
          },
        };
        console.log(
          "👆 Please confirm the transaction on your Ledger device..."
        );
        // Sign with timeout and user guidance
        const result = yield this.signWithUserGuidance(signatureRequest);
        console.log("✅ Transaction signed successfully");
        console.log(`   Signature: ${result.signature.substring(0, 20)}...`);
        return {
          signature: result.signature,
          publicKey: result.publicKey,
          signedTransaction: result.signedTransaction,
          deviceConfirmation: true,
        };
      } catch (error) {
        console.error("❌ Transaction signing failed:", error);
        yield this.handleSigningError(error, chainId);
        throw error;
      }
    });
  }
  /**
   * Batch sign multiple transactions
   */
  batchSignTransactions(requests) {
    return __awaiter(this, void 0, void 0, function* () {
      console.log(`📝 Batch signing ${requests.length} transactions...`);
      const results = [];
      for (let i = 0; i < requests.length; i++) {
        const request = requests[i];
        console.log(`\n📄 Signing transaction ${i + 1}/${requests.length}`);
        try {
          const result = yield this.signTransaction(
            request.chainId,
            request.transaction,
            request.accountAddress
          );
          results.push({
            success: true,
            signature: result.signature,
            transactionIndex: i,
          });
          console.log(`✅ Transaction ${i + 1} signed successfully`);
        } catch (error) {
          results.push({
            success: false,
            error: error instanceof Error ? error.message : String(error),
            transactionIndex: i,
          });
          console.log(`❌ Transaction ${i + 1} failed: ${error}`);
          // Ask user if they want to continue with remaining transactions
          const shouldContinue = yield this.askUserToContinue(
            i + 1,
            requests.length
          );
          if (!shouldContinue) {
            console.log("🛑 Batch signing cancelled by user");
            break;
          }
        }
      }
      console.log(
        `\n📊 Batch signing completed: ${results.filter((r) => r.success).length}/${requests.length} successful`
      );
      return results;
    });
  }
  /**
   * Get device health and status
   */
  getDeviceHealth() {
    return __awaiter(this, void 0, void 0, function* () {
      if (!this.ledgerProvider || !this.deviceInfo) {
        return {
          connected: false,
          locked: true,
          currentApp: "Unknown",
          firmwareUpToDate: false,
          lastActivity: new Date(),
        };
      }
      try {
        const isConnected = this.ledgerProvider.isConnected();
        return {
          connected: isConnected,
          locked: this.deviceInfo.isLocked,
          currentApp: this.deviceInfo.currentApp || "Dashboard",
          batteryLevel: undefined, // Not available in mock implementation
          firmwareUpToDate: true, // Assume up to date for example
          lastActivity: new Date(),
        };
      } catch (error) {
        console.error("Failed to get device health:", error);
        return {
          connected: false,
          locked: true,
          currentApp: "Unknown",
          firmwareUpToDate: false,
          lastActivity: new Date(),
        };
      }
    });
  }
  /**
   * Disconnect from hardware wallet
   */
  disconnect() {
    return __awaiter(this, void 0, void 0, function* () {
      console.log("🔌 Disconnecting from hardware wallet...");
      if (this.ledgerProvider) {
        try {
          yield this.ledgerProvider.disconnect();
          console.log("✅ Hardware wallet disconnected");
        } catch (error) {
          console.error("Error during disconnect:", error);
        }
      }
      this.ledgerProvider = null;
      this.deviceInfo = null;
    });
  }
  /**
   * Cleanup resources
   */
  dispose() {
    return __awaiter(this, void 0, void 0, function* () {
      yield this.disconnect();
      yield this.sdk.dispose();
      console.log("🧹 Hardware wallet manager disposed");
    });
  }
  setupDefaultDerivationPaths() {
    // Standard derivation paths for each chain
    this.derivationConfigs.set(src_1.ChainId.BITCOIN, {
      chainId: src_1.ChainId.BITCOIN,
      derivationPath: "m/84'/0'/0'/0/0", // Native SegWit
      accountIndex: 0,
      addressIndex: 0,
    });
    this.derivationConfigs.set(src_1.ChainId.STELLAR, {
      chainId: src_1.ChainId.STELLAR,
      derivationPath: "m/44'/148'/0'", // Stellar standard
      accountIndex: 0,
    });
    this.derivationConfigs.set(src_1.ChainId.STARKNET, {
      chainId: src_1.ChainId.STARKNET,
      derivationPath: "m/44'/9004'/0'/0/0", // Starknet standard
      accountIndex: 0,
      addressIndex: 0,
    });
  }
  connectWithRetry() {
    return __awaiter(this, void 0, void 0, function* () {
      const maxRetries = 3;
      let lastError;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`🔄 Connection attempt ${attempt}/${maxRetries}...`);
          yield this.ledgerProvider.connect();
          return; // Success
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          console.log(`❌ Attempt ${attempt} failed: ${lastError.message}`);
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            console.log(`⏳ Waiting ${delay}ms before retry...`);
            yield new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }
      throw lastError || new Error("Connection failed after all retries");
    });
  }
  getDeviceInfo() {
    return __awaiter(this, void 0, void 0, function* () {
      // In a real implementation, this would query the actual device
      return {
        deviceId: "ledger-nano-s-plus-123",
        productName: "Ledger Nano S Plus",
        firmwareVersion: "1.0.3",
        supportedApps: ["Bitcoin", "Stellar", "Starknet", "Ethereum"],
        currentApp: "Dashboard",
        isLocked: false,
      };
    });
  }
  getRequiredApp(chainId) {
    switch (chainId) {
      case src_1.ChainId.BITCOIN:
        return "Bitcoin";
      case src_1.ChainId.STELLAR:
        return "Stellar";
      case src_1.ChainId.STARKNET:
        return "Starknet";
      default:
        throw new Error(`Unsupported chain: ${chainId}`);
    }
  }
  waitForAppOpen(chainId, timeoutMs) {
    return __awaiter(this, void 0, void 0, function* () {
      const startTime = Date.now();
      const pollInterval = 2000; // Check every 2 seconds
      while (Date.now() - startTime < timeoutMs) {
        try {
          const isOpen = yield this.ledgerProvider.isAppOpen(chainId);
          if (isOpen) {
            return;
          }
        } catch (_a) {
          // Continue polling
        }
        yield new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
      throw new Error(
        `Timeout waiting for ${this.getRequiredApp(chainId)} app to open`
      );
    });
  }
  updateDerivationPath(chainId, derivationPath) {
    const config = this.derivationConfigs.get(chainId);
    if (config) {
      config.derivationPath = derivationPath;
      this.derivationConfigs.set(chainId, config);
    }
  }
  getAccountBalance(chainId, _address) {
    return __awaiter(this, void 0, void 0, function* () {
      void _address;
      void _address;
      // Mock balance lookup - in real implementation, query blockchain
      const mockBalances = {
        [src_1.ChainId.BITCOIN]: "0.05432100",
        [src_1.ChainId.STELLAR]: "1,234.567890",
        [src_1.ChainId.STARKNET]: "0.123456789",
      };
      return mockBalances[chainId] || "0";
    });
  }
  validateTransactionFormat(chainId, transaction) {
    switch (chainId) {
      case src_1.ChainId.BITCOIN:
        if (!transaction.inputs || !transaction.outputs) {
          throw new Error(
            "Invalid Bitcoin transaction: missing inputs or outputs"
          );
        }
        break;
      case src_1.ChainId.STELLAR:
        if (!transaction.sourceAccount || !transaction.operations) {
          throw new Error(
            "Invalid Stellar transaction: missing sourceAccount or operations"
          );
        }
        break;
      case src_1.ChainId.STARKNET:
        if (!transaction.contractAddress || !transaction.entrypoint) {
          throw new Error(
            "Invalid Starknet transaction: missing contractAddress or entrypoint"
          );
        }
        break;
    }
  }
  signWithUserGuidance(request) {
    return __awaiter(this, void 0, void 0, function* () {
      const timeout = 60000; // 1 minute timeout for user confirmation
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(
            new Error("Transaction signing timed out - user did not confirm")
          );
        }, timeout);
        this.ledgerProvider
          .signTransaction(request)
          .then((result) => {
            clearTimeout(timer);
            resolve(result);
          })
          .catch((error) => {
            clearTimeout(timer);
            reject(error);
          });
      });
    });
  }
  handleConnectionError(error) {
    return __awaiter(this, void 0, void 0, function* () {
      const _recoveryContext = {
        providerId: "ledger-provider",
        chainId: src_1.ChainId.BITCOIN, // Default chain for connection errors
        retryCount: 0,
        maxRetries: 3,
      };
      void _recoveryContext;
      void error;
      void _recoveryContext;
      void error;
      const instructions =
        src_1.signatureProviderErrorRecovery.getRecoveryInstructions(error);
      console.log("\n🔧 Recovery Instructions:");
      instructions.forEach((instruction, index) => {
        console.log(`   ${index + 1}. ${instruction}`);
      });
      const canRecover = src_1.signatureProviderErrorRecovery.canRecover(error);
      if (canRecover) {
        console.log(
          "\n💡 This error may be recoverable. Please follow the instructions above."
        );
      }
    });
  }
  handleSigningError(error, chainId) {
    return __awaiter(this, void 0, void 0, function* () {
      const _recoveryContext = {
        providerId: "ledger-provider",
        chainId,
        retryCount: 0,
        maxRetries: 3,
      };
      const instructions =
        src_1.signatureProviderErrorRecovery.getRecoveryInstructions(error);
      console.log("\n🔧 Signing Error Recovery Instructions:");
      instructions.forEach((instruction, index) => {
        console.log(`   ${index + 1}. ${instruction}`);
      });
      // Attempt automatic recovery
      try {
        const recoveryResult =
          yield src_1.signatureProviderErrorRecovery.recover(
            error,
            _recoveryContext
          );
        if (recoveryResult.shouldRetry) {
          console.log(
            `🔄 Automatic recovery suggests retry after ${recoveryResult.retryAfterMs}ms`
          );
        }
      } catch (_recoveryError) {
        void _recoveryError;
        console.log("❌ Automatic recovery failed");
      }
    });
  }
  askUserToContinue(currentIndex, totalCount) {
    return __awaiter(this, void 0, void 0, function* () {
      // In a real implementation, this would prompt the user
      // For this example, we'll continue with remaining transactions
      console.log(
        `❓ Continue with remaining ${totalCount - currentIndex} transactions? (Assuming yes for example)`
      );
      return true;
    });
  }
}
exports.HardwareWalletManager = HardwareWalletManager;
/**
 * Example usage of Hardware Wallet Integration
 */
function hardwareWalletExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("=== Hardware Wallet Integration Example ===\n");
    const walletManager = new HardwareWalletManager();
    yield walletManager.initialize();
    try {
      // Connect to Ledger device
      const deviceInfo = yield walletManager.connectLedger({
        connectionTimeout: 20000,
        autoOpenApps: false,
      });
      console.log("\n📱 Device Information:");
      console.log(`   Product: ${deviceInfo.productName}`);
      console.log(`   Firmware: ${deviceInfo.firmwareVersion}`);
      console.log(`   Supported Apps: ${deviceInfo.supportedApps.join(", ")}`);
      // Get device health
      const health = yield walletManager.getDeviceHealth();
      console.log("\n🏥 Device Health:");
      console.log(`   Connected: ${health.connected ? "✅" : "❌"}`);
      console.log(`   Locked: ${health.locked ? "🔒" : "🔓"}`);
      console.log(`   Current App: ${health.currentApp}`);
      // Get accounts for different chains
      console.log("\n👛 Getting Accounts...");
      // Bitcoin accounts
      const bitcoinAccounts = yield walletManager.getAccountsForChain(
        src_1.ChainId.BITCOIN
      );
      console.log(`\n₿ Bitcoin Accounts (${bitcoinAccounts.length}):`);
      bitcoinAccounts.forEach((account, index) => {
        console.log(`   ${index + 1}. ${account.address}`);
        console.log(`      Balance: ${account.balance} BTC`);
        console.log(`      Path: ${account.derivationPath}`);
      });
      // Stellar accounts
      const stellarAccounts = yield walletManager.getAccountsForChain(
        src_1.ChainId.STELLAR
      );
      console.log(`\n⭐ Stellar Accounts (${stellarAccounts.length}):`);
      stellarAccounts.forEach((account, index) => {
        console.log(`   ${index + 1}. ${account.address}`);
        console.log(`      Balance: ${account.balance} XLM`);
        console.log(`      Path: ${account.derivationPath}`);
      });
      // Sign individual transactions
      console.log("\n✍️  Signing Individual Transactions...");
      // Bitcoin transaction
      const bitcoinTx = {
        inputs: [{ txid: "example-txid", vout: 0 }],
        outputs: [
          { value: 50000, scriptPubKey: "bc1qrecipient123example" },
          { value: 49000, scriptPubKey: bitcoinAccounts[0].address }, // Change
        ],
      };
      const _bitcoinResult = yield walletManager.signTransaction(
        src_1.ChainId.BITCOIN,
        bitcoinTx,
        bitcoinAccounts[0].address
      );
      void _bitcoinResult;
      console.log("✅ Bitcoin transaction signed");
      // Stellar transaction
      const stellarTx = {
        sourceAccount: stellarAccounts[0].address,
        fee: "100",
        sequenceNumber: "1",
        operations: [
          {
            type: "payment",
            destination: "GRECIPIENT123EXAMPLE",
            asset: "native",
            amount: "25.50",
          },
        ],
      };
      const _stellarResult = yield walletManager.signTransaction(
        src_1.ChainId.STELLAR,
        stellarTx,
        stellarAccounts[0].address
      );
      void _stellarResult;
      console.log("✅ Stellar transaction signed");
      // Batch signing example
      console.log("\n📝 Batch Signing Example...");
      const batchRequests = [
        {
          chainId: src_1.ChainId.STELLAR,
          transaction: {
            sourceAccount: stellarAccounts[0].address,
            fee: "100",
            sequenceNumber: "2",
            operations: [
              { type: "payment", destination: "GBATCH1", amount: "10" },
            ],
          },
          accountAddress: stellarAccounts[0].address,
        },
        {
          chainId: src_1.ChainId.STELLAR,
          transaction: {
            sourceAccount: stellarAccounts[0].address,
            fee: "100",
            sequenceNumber: "3",
            operations: [
              { type: "payment", destination: "GBATCH2", amount: "20" },
            ],
          },
          accountAddress: stellarAccounts[0].address,
        },
      ];
      const batchResults =
        yield walletManager.batchSignTransactions(batchRequests);
      console.log(
        `\n📊 Batch Results: ${batchResults.filter((r) => r.success).length}/${batchResults.length} successful`
      );
    } catch (error) {
      console.error("Hardware wallet operation failed:", error);
    } finally {
      yield walletManager.dispose();
    }
  });
}
// Run the example
if (require.main === module) {
  hardwareWalletExample().catch(console.error);
}
