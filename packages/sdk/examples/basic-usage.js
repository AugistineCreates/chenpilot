"use strict";
/**
 * @fileoverview Basic usage examples for the SignatureProvider SDK
 * @example
 *
 * // Basic provider creation and usage
 * import { SignatureProviderSDK, ProviderType, ChainId } from '@chen-pilot/sdk-core';
 *
 * const sdk = new SignatureProviderSDK();
 * await sdk.initialize();
 *
 * const provider = await sdk.createProvider(ProviderType.MOCK);
 * const accounts = await provider.getAccounts(ChainId.STELLAR);
 * console.log('Available accounts:', accounts);
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
exports.basicUsageExample = basicUsageExample;
exports.multiSignatureExample = multiSignatureExample;
exports.providerDiscoveryExample = providerDiscoveryExample;
exports.signatureVerificationExample = signatureVerificationExample;
exports.errorHandlingExample = errorHandlingExample;
exports.sdkBuilderExample = sdkBuilderExample;
exports.registryManagementExample = registryManagementExample;
exports.runAllExamples = runAllExamples;
const src_1 = require("../src");
/**
 * Example 1: Basic SDK initialization and provider creation
 */
function basicUsageExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("=== Basic Usage Example ===");
    // Initialize SDK with default configuration
    const sdk = new src_1.SignatureProviderSDK({
      defaultProviders: [src_1.ProviderType.MOCK, src_1.ProviderType.LEDGER],
      autoDiscovery: true,
      enableMetrics: true,
      enableLogging: true,
    });
    yield sdk.initialize();
    console.log("SDK initialized successfully");
    // Create a mock provider for testing
    const mockProvider = yield sdk.createProvider(src_1.ProviderType.MOCK, {
      enableLogging: true,
    });
    console.log("Created provider:", mockProvider.providerId);
    console.log("Provider capabilities:", mockProvider.getCapabilities());
    // Get accounts for Stellar
    const accounts = yield mockProvider.getAccounts(src_1.ChainId.STELLAR);
    console.log("Available accounts:", accounts.length);
    // Sign a simple transaction
    const transaction = {
      sourceAccount: accounts[0].address,
      fee: "100",
      sequenceNumber: "1",
      operations: [
        {
          type: "payment",
          destination: "GEXAMPLE123",
          asset: "native",
          amount: "10",
        },
      ],
    };
    const signatureRequest = {
      transactionData: {
        chainId: src_1.ChainId.STELLAR,
        transaction,
      },
      accountAddress: accounts[0].address,
    };
    const result = yield mockProvider.signTransaction(signatureRequest);
    console.log("Transaction signed:", result.signature);
    // Cleanup
    yield sdk.dispose();
  });
}
/**
 * Example 2: Multi-signature workflow
 */
function multiSignatureExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("=== Multi-Signature Example ===");
    const coordinator = new src_1.MultiSignatureCoordinator();
    // Create multiple providers for multi-sig
    const provider1 = new src_1.MockSignatureProvider("multisig-1");
    const provider2 = new src_1.MockSignatureProvider("multisig-2");
    const provider3 = new src_1.MockSignatureProvider("multisig-3");
    // Register providers with coordinator
    coordinator.registerProvider(provider1);
    coordinator.registerProvider(provider2);
    coordinator.registerProvider(provider3);
    // Connect all providers
    yield provider1.connect();
    yield provider2.connect();
    yield provider3.connect();
    // Get accounts from each provider
    const accounts1 = yield provider1.getAccounts(src_1.ChainId.STELLAR);
    const accounts2 = yield provider2.getAccounts(src_1.ChainId.STELLAR);
    const accounts3 = yield provider3.getAccounts(src_1.ChainId.STELLAR);
    // Setup signers (2-of-3 multisig)
    const signers = [
      {
        providerId: "multisig-1",
        accountAddress: accounts1[0].address,
        publicKey: accounts1[0].publicKey,
        required: true,
      },
      {
        providerId: "multisig-2",
        accountAddress: accounts2[0].address,
        publicKey: accounts2[0].publicKey,
        required: true,
      },
      {
        providerId: "multisig-3",
        accountAddress: accounts3[0].address,
        publicKey: accounts3[0].publicKey,
        required: false, // Optional third signer
      },
    ];
    const config = {
      requiredSignatures: 2,
      totalSigners: 3,
      allowPartialSigning: true,
      continueOnError: true,
      description: "Example 2-of-3 multisig transaction",
    };
    const transaction = {
      sourceAccount: accounts1[0].address,
      fee: "100",
      sequenceNumber: "1",
      operations: [
        {
          type: "payment",
          destination: "GMULTISIG123",
          asset: "native",
          amount: "100",
        },
      ],
    };
    // Execute multi-signature workflow
    const workflowResult = yield coordinator.startWorkflow(
      { chainId: src_1.ChainId.STELLAR, transaction },
      signers,
      config
    );
    console.log("Multi-signature workflow completed:", workflowResult.status);
    console.log("Required signatures met:", workflowResult.requiredMet);
    console.log(
      "Total signatures collected:",
      workflowResult.signatures.length
    );
    // Cleanup
    yield provider1.disconnect();
    yield provider2.disconnect();
    yield provider3.disconnect();
  });
}
/**
 * Example 3: Provider discovery and selection
 */
function providerDiscoveryExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("=== Provider Discovery Example ===");
    const factory = new src_1.SignatureProviderFactory({
      enableLogging: true,
    });
    // Discover available providers
    const discoveries = yield factory.discoverProviders();
    console.log("Available providers:");
    discoveries.forEach((discovery) => {
      console.log(
        `- ${discovery.type}: ${discovery.available ? "Available" : "Not available"}`
      );
      if (discovery.error) {
        console.log(`  Error: ${discovery.error}`);
      }
    });
    // Get providers for specific chain
    const stellarProviders = yield factory.createProvidersForChain(
      src_1.ChainId.STELLAR,
      {
        autoConnect: true,
      }
    );
    console.log(`Found ${stellarProviders.length} providers for Stellar`);
    // Get the best provider for Bitcoin with preferences
    const bestBitcoinProvider = yield factory.getBestProviderForChain(
      src_1.ChainId.BITCOIN,
      {
        preferHardwareWallet: true,
      }
    );
    console.log("Best Bitcoin provider:", bestBitcoinProvider.providerId);
    // Cleanup
    yield factory.dispose();
  });
}
/**
 * Example 4: Signature verification
 */
function signatureVerificationExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("=== Signature Verification Example ===");
    const provider = new src_1.MockSignatureProvider("verification-test");
    yield provider.connect();
    const accounts = yield provider.getAccounts(src_1.ChainId.STELLAR);
    // Create and sign a transaction
    const transaction = {
      sourceAccount: accounts[0].address,
      fee: "100",
      sequenceNumber: "1",
      operations: [{ type: "payment", destination: "GTEST", amount: "50" }],
    };
    const signatureResult = yield provider.signTransaction({
      transactionData: { chainId: src_1.ChainId.STELLAR, transaction },
      accountAddress: accounts[0].address,
    });
    // Verify the signature
    const verificationResult =
      yield src_1.SignatureVerificationUtils.verifySignature({
        signature: signatureResult.signature,
        publicKey: signatureResult.publicKey,
        transactionData: { chainId: src_1.ChainId.STELLAR, transaction },
        chainId: src_1.ChainId.STELLAR,
      });
    console.log("Signature verification result:", verificationResult.isValid);
    console.log("Signature algorithm:", verificationResult.algorithm);
    yield provider.disconnect();
  });
}
/**
 * Example 5: Error handling and recovery
 */
function errorHandlingExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("=== Error Handling Example ===");
    const provider = new src_1.MockSignatureProvider("error-test", undefined, {
      shouldFailSigning: true,
    });
    yield provider.connect();
    const accounts = yield provider.getAccounts(src_1.ChainId.STELLAR);
    try {
      yield provider.signTransaction({
        transactionData: {
          chainId: src_1.ChainId.STELLAR,
          transaction: {
            sourceAccount: accounts[0].address,
            fee: "100",
            sequenceNumber: "1",
            operations: [{ type: "payment" }],
          },
        },
        accountAddress: accounts[0].address,
      });
    } catch (error) {
      console.log(
        "Signing failed as expected:",
        error instanceof Error ? error.message : error
      );
      // Check if error is recoverable
      const canRecover = src_1.signatureProviderErrorRecovery.canRecover(error);
      console.log("Error is recoverable:", canRecover);
      // Get recovery instructions
      const instructions =
        src_1.signatureProviderErrorRecovery.getRecoveryInstructions(error);
      console.log("Recovery instructions:", instructions);
      if (canRecover) {
        // Attempt recovery
        const recoveryResult =
          yield src_1.signatureProviderErrorRecovery.recover(error, {
            providerId: provider.providerId,
            chainId: src_1.ChainId.STELLAR,
            retryCount: 0,
            maxRetries: 3,
          });
        console.log("Recovery attempt result:", recoveryResult.success);
        if (recoveryResult.instructions) {
          console.log("Recovery instructions:", recoveryResult.instructions);
        }
      }
    }
    yield provider.disconnect();
  });
}
/**
 * Example 6: SDK Builder pattern
 */
function sdkBuilderExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("=== SDK Builder Example ===");
    // Use builder pattern for SDK configuration
    const sdk = yield (0, src_1.createSDKBuilder)()
      .withDefaultProviders([
        src_1.ProviderType.MOCK,
        src_1.ProviderType.LEDGER,
      ])
      .withAutoDiscovery(true)
      .withMetrics(true)
      .withLogging(true)
      .withErrorRecovery({
        enabled: true,
        maxRetries: 5,
        retryDelay: 2000,
      })
      .withRegistry({
        autoRegister: true,
        validateProviders: true,
      })
      .build();
    console.log("SDK built and initialized with builder pattern");
    console.log("SDK configuration:", sdk.getConfig());
    // Use SDK utilities for quick operations
    const provider = yield src_1.SDKUtils.quickCreateProvider(
      src_1.ProviderType.MOCK
    );
    console.log("Quick provider created:", provider.providerId);
    // Perform system health check
    const healthCheck = yield src_1.SDKUtils.performSystemHealthCheck();
    console.log("System health:", healthCheck);
    // Get system metrics
    const metrics = src_1.SDKUtils.getSystemMetrics();
    console.log("System metrics:", metrics);
    yield sdk.dispose();
  });
}
/**
 * Example 7: Registry management
 */
function registryManagementExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("=== Registry Management Example ===");
    const registry = new src_1.SignatureProviderRegistry();
    // Create providers
    const mockProvider = new src_1.MockSignatureProvider("registry-mock");
    const ledgerProvider = new src_1.LedgerSignatureProvider();
    // Set up event listeners
    registry.onProviderRegistered((providerId, provider) => {
      console.log(`Provider registered: ${providerId}`);
      console.log(
        `Capabilities: ${JSON.stringify(provider.getCapabilities())}`
      );
    });
    registry.onProviderUnregistered((providerId) => {
      console.log(`Provider unregistered: ${providerId}`);
    });
    // Register providers
    registry.register(mockProvider);
    registry.register(ledgerProvider);
    console.log(`Total providers: ${registry.getProviderCount()}`);
    // Find providers by chain
    const stellarProviders = registry.findProvidersForChain(
      src_1.ChainId.STELLAR
    );
    console.log(`Stellar providers: ${stellarProviders.length}`);
    const bitcoinProviders = registry.findProvidersForChain(
      src_1.ChainId.BITCOIN
    );
    console.log(`Bitcoin providers: ${bitcoinProviders.length}`);
    // Find multi-chain providers
    const multiChainProviders = registry.findMultiChainProviders([
      src_1.ChainId.STELLAR,
      src_1.ChainId.BITCOIN,
    ]);
    console.log(`Multi-chain providers: ${multiChainProviders.length}`);
    // Cleanup
    registry.clear();
  });
}
/**
 * Run all examples
 */
function runAllExamples() {
  return __awaiter(this, void 0, void 0, function* () {
    try {
      yield basicUsageExample();
      console.log("\n");
      yield multiSignatureExample();
      console.log("\n");
      yield providerDiscoveryExample();
      console.log("\n");
      yield signatureVerificationExample();
      console.log("\n");
      yield errorHandlingExample();
      console.log("\n");
      yield sdkBuilderExample();
      console.log("\n");
      yield registryManagementExample();
      console.log("\n=== All examples completed successfully! ===");
    } catch (error) {
      console.error("Example failed:", error);
      process.exit(1);
    }
  });
}
// Run examples if this file is executed directly
if (require.main === module) {
  runAllExamples().catch(console.error);
}
