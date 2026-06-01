"use strict";
/**
 * @fileoverview Cross-Chain Bridge Example
 *
 * This example demonstrates how to implement a cross-chain bridge system
 * that coordinates signatures across multiple blockchain networks using
 * different signature providers for each chain.
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
exports.BridgeOperationType = exports.CrossChainBridge = void 0;
exports.crossChainBridgeExample = crossChainBridgeExample;
const src_1 = require("../src");
/**
 * Bridge operation types
 */
var BridgeOperationType;
(function (BridgeOperationType) {
  BridgeOperationType["LOCK"] = "lock";
  BridgeOperationType["UNLOCK"] = "unlock";
  BridgeOperationType["MINT"] = "mint";
  BridgeOperationType["BURN"] = "burn";
})(
  BridgeOperationType ||
    (exports.BridgeOperationType = BridgeOperationType = {})
);
/**
 * Cross-chain bridge coordinator
 */
class CrossChainBridge {
  constructor(minValidatorSignatures = 3) {
    this.coordinators = new Map();
    this.validators = new Map();
    this.bridgeContracts = new Map();
    this.minValidatorSignatures = minValidatorSignatures;
    this.sdk = new src_1.SignatureProviderSDK({
      enableMetrics: true,
      enableLogging: true,
    });
    // Initialize coordinators for each supported chain
    for (const chainId of [
      src_1.ChainId.BITCOIN,
      src_1.ChainId.STELLAR,
      src_1.ChainId.STARKNET,
    ]) {
      this.coordinators.set(chainId, new src_1.MultiSignatureCoordinator());
    }
    // Set bridge contract addresses (mock addresses)
    this.bridgeContracts.set(src_1.ChainId.BITCOIN, "bc1qbridge123example");
    this.bridgeContracts.set(
      src_1.ChainId.STELLAR,
      "GBRIDGECONTRACT123EXAMPLE"
    );
    this.bridgeContracts.set(
      src_1.ChainId.STARKNET,
      "0x1234567890abcdef1234567890abcdef12345678"
    );
  }
  /**
   * Initialize the bridge system
   */
  initialize() {
    return __awaiter(this, void 0, void 0, function* () {
      console.log("🌉 Initializing Cross-Chain Bridge...");
      yield this.sdk.initialize();
      // Setup event listeners for each chain coordinator
      for (const [chainId, coordinator] of this.coordinators) {
        coordinator.addEventListener((event) => {
          console.log(`🔗 [${chainId}] Bridge event: ${event.type}`);
        });
      }
      console.log("✅ Cross-chain bridge initialized");
    });
  }
  /**
   * Add a bridge validator
   */
  addValidator(validator) {
    return __awaiter(this, void 0, void 0, function* () {
      console.log(`👨‍⚖️ Adding bridge validator: ${validator.validatorId}`);
      // Create provider for validator
      const provider = new src_1.MockSignatureProvider(
        validator.providerId,
        undefined,
        {
          enableLogging: true,
          customCapabilities: {
            supportedChains: validator.supportedChains,
          },
        }
      );
      yield provider.connect();
      // Register provider with coordinators for supported chains
      for (const chainId of validator.supportedChains) {
        const coordinator = this.coordinators.get(chainId);
        if (coordinator) {
          coordinator.registerProvider(provider);
        }
      }
      this.validators.set(validator.validatorId, validator);
      console.log(
        `✅ Validator ${validator.validatorId} added for chains: ${validator.supportedChains.join(", ")}`
      );
    });
  }
  /**
   * Execute a cross-chain bridge operation
   */
  executeBridgeOperation(request) {
    return __awaiter(this, void 0, void 0, function* () {
      console.log(`🌉 Executing bridge operation: ${request.operationType}`);
      console.log(
        `   From: ${request.sourceChain} → To: ${request.destinationChain}`
      );
      console.log(`   Amount: ${request.amount}`);
      try {
        // Step 1: Execute source chain transaction
        const sourceResult = yield this.executeSourceChainTransaction(request);
        if (!sourceResult.success) {
          return {
            success: false,
            error: `Source chain transaction failed: ${sourceResult.error}`,
            signatures: [],
            validatorSignatures: 0,
            requiredSignatures: this.minValidatorSignatures,
          };
        }
        // Step 2: Generate bridge proof
        const bridgeProof = yield this.generateBridgeProof(
          request,
          sourceResult.transactionHash
        );
        // Step 3: Execute destination chain transaction
        const destinationResult = yield this.executeDestinationChainTransaction(
          request,
          bridgeProof
        );
        return {
          success: destinationResult.success,
          sourceTransactionHash: sourceResult.transactionHash,
          destinationTransactionHash: destinationResult.transactionHash,
          signatures: [
            ...sourceResult.signatures,
            ...destinationResult.signatures,
          ],
          validatorSignatures:
            sourceResult.validatorSignatures +
            destinationResult.validatorSignatures,
          requiredSignatures: this.minValidatorSignatures * 2, // Both chains
          bridgeProof,
          error: destinationResult.error,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          signatures: [],
          validatorSignatures: 0,
          requiredSignatures: this.minValidatorSignatures,
        };
      }
    });
  }
  /**
   * Get bridge statistics
   */
  getBridgeStats() {
    const validatorsByChain = {
      [src_1.ChainId.BITCOIN]: 0,
      [src_1.ChainId.STELLAR]: 0,
      [src_1.ChainId.STARKNET]: 0,
    };
    for (const validator of this.validators.values()) {
      for (const chainId of validator.supportedChains) {
        validatorsByChain[chainId]++;
      }
    }
    return {
      totalValidators: this.validators.size,
      validatorsByChain,
      supportedChains: Array.from(this.coordinators.keys()),
      minValidatorSignatures: this.minValidatorSignatures,
    };
  }
  /**
   * Verify bridge proof
   */
  verifyBridgeProof(proof, sourceChain, destinationChain, amount) {
    return __awaiter(this, void 0, void 0, function* () {
      console.log(
        `🔍 Verifying bridge proof for ${sourceChain} → ${destinationChain}`
      );
      try {
        // In a real implementation, this would verify cryptographic proofs
        // For this example, we'll do basic validation
        const proofData = JSON.parse(proof);
        return (
          proofData.sourceChain === sourceChain &&
          proofData.destinationChain === destinationChain &&
          proofData.amount === amount &&
          proofData.validatorSignatures >= this.minValidatorSignatures
        );
      } catch (_a) {
        return false;
      }
    });
  }
  /**
   * Cleanup bridge resources
   */
  dispose() {
    return __awaiter(this, void 0, void 0, function* () {
      console.log("🧹 Disposing bridge resources...");
      yield this.sdk.dispose();
      console.log("✅ Bridge disposed");
    });
  }
  executeSourceChainTransaction(request) {
    return __awaiter(this, void 0, void 0, function* () {
      console.log(
        `📤 Executing source chain transaction on ${request.sourceChain}`
      );
      const coordinator = this.coordinators.get(request.sourceChain);
      if (!coordinator) {
        return {
          success: false,
          error: `No coordinator for chain ${request.sourceChain}`,
          signatures: [],
          validatorSignatures: 0,
        };
      }
      // Get validators for source chain
      const validators = this.getValidatorsForChain(request.sourceChain);
      if (validators.length < this.minValidatorSignatures) {
        return {
          success: false,
          error: `Insufficient validators for ${request.sourceChain}`,
          signatures: [],
          validatorSignatures: 0,
        };
      }
      // Create signers
      const signers = validators.map((validator) => ({
        providerId: validator.providerId,
        accountAddress: request.sourceAddress,
        publicKey: validator.publicKey,
        required: true,
        metadata: {
          validatorId: validator.validatorId,
          stake: validator.stake,
          reputation: validator.reputation,
        },
      }));
      // Create multi-signature configuration
      const config = {
        requiredSignatures: this.minValidatorSignatures,
        totalSigners: validators.length,
        allowPartialSigning: false,
        continueOnError: true,
        timeout: 180000, // 3 minutes
        description: `Bridge ${request.operationType} on ${request.sourceChain}`,
      };
      // Create chain-specific transaction
      const transaction = this.createChainTransaction(
        request,
        request.sourceChain
      );
      try {
        const workflowResult = yield coordinator.startWorkflow(
          { chainId: request.sourceChain, transaction },
          signers,
          config
        );
        if (
          workflowResult.status === "completed" &&
          workflowResult.requiredMet
        ) {
          return {
            success: true,
            transactionHash: `${request.sourceChain}-tx-${Date.now()}`,
            signatures: workflowResult.signatures,
            validatorSignatures: workflowResult.signatures.filter(
              (s) => s.status === "completed"
            ).length,
          };
        } else {
          return {
            success: false,
            error: "Insufficient validator signatures",
            signatures: workflowResult.signatures,
            validatorSignatures: workflowResult.signatures.filter(
              (s) => s.status === "completed"
            ).length,
          };
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          signatures: [],
          validatorSignatures: 0,
        };
      }
    });
  }
  executeDestinationChainTransaction(request, bridgeProof) {
    return __awaiter(this, void 0, void 0, function* () {
      console.log(
        `📥 Executing destination chain transaction on ${request.destinationChain}`
      );
      const coordinator = this.coordinators.get(request.destinationChain);
      if (!coordinator) {
        return {
          success: false,
          error: `No coordinator for chain ${request.destinationChain}`,
          signatures: [],
          validatorSignatures: 0,
        };
      }
      // Verify bridge proof first
      const proofValid = yield this.verifyBridgeProof(
        bridgeProof,
        request.sourceChain,
        request.destinationChain,
        request.amount
      );
      if (!proofValid) {
        return {
          success: false,
          error: "Invalid bridge proof",
          signatures: [],
          validatorSignatures: 0,
        };
      }
      // Get validators for destination chain
      const validators = this.getValidatorsForChain(request.destinationChain);
      if (validators.length < this.minValidatorSignatures) {
        return {
          success: false,
          error: `Insufficient validators for ${request.destinationChain}`,
          signatures: [],
          validatorSignatures: 0,
        };
      }
      // Create destination transaction (mint/unlock)
      const destinationRequest = Object.assign(Object.assign({}, request), {
        operationType:
          request.operationType === BridgeOperationType.LOCK
            ? BridgeOperationType.MINT
            : BridgeOperationType.UNLOCK,
      });
      // Execute similar to source chain
      return this.executeSourceChainTransaction(destinationRequest);
    });
  }
  generateBridgeProof(request, sourceTransactionHash) {
    return __awaiter(this, void 0, void 0, function* () {
      console.log("🔐 Generating bridge proof...");
      // In a real implementation, this would create cryptographic proofs
      // For this example, we'll create a simple proof structure
      const proofData = {
        sourceChain: request.sourceChain,
        destinationChain: request.destinationChain,
        amount: request.amount,
        sourceTransactionHash,
        bridgeId: request.bridgeId,
        nonce: request.nonce,
        timestamp: Date.now(),
        validatorSignatures: this.minValidatorSignatures,
      };
      return JSON.stringify(proofData);
    });
  }
  getValidatorsForChain(chainId) {
    return Array.from(this.validators.values()).filter((validator) =>
      validator.supportedChains.includes(chainId)
    );
  }
  createChainTransaction(request, chainId) {
    const bridgeContract = this.bridgeContracts.get(chainId);
    switch (chainId) {
      case src_1.ChainId.BITCOIN:
        return {
          inputs: [{ txid: "source-utxo", vout: 0 }],
          outputs: [
            {
              value: parseInt(request.amount),
              scriptPubKey: bridgeContract,
            },
          ],
          metadata: {
            bridgeOperation: request.operationType,
            destinationChain: request.destinationChain,
            destinationAddress: request.destinationAddress,
          },
        };
      case src_1.ChainId.STELLAR:
        return {
          sourceAccount: request.sourceAddress,
          fee: "100",
          sequenceNumber: "1",
          operations: [
            {
              type:
                request.operationType === BridgeOperationType.LOCK
                  ? "payment"
                  : "create_account",
              destination: bridgeContract,
              asset: "native",
              amount: request.amount,
            },
          ],
          memo: {
            type: "text",
            value: `Bridge:${request.destinationChain}:${request.destinationAddress}`,
          },
        };
      case src_1.ChainId.STARKNET:
        return {
          contractAddress: bridgeContract,
          entrypoint: request.operationType,
          calldata: [
            request.destinationAddress,
            request.amount,
            request.nonce.toString(),
          ],
          metadata: {
            bridgeId: request.bridgeId,
            sourceChain: request.sourceChain,
          },
        };
      default:
        throw new Error(`Unsupported chain: ${chainId}`);
    }
  }
}
exports.CrossChainBridge = CrossChainBridge;
/**
 * Example usage of the Cross-Chain Bridge
 */
function crossChainBridgeExample() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("=== Cross-Chain Bridge Example ===\n");
    const bridge = new CrossChainBridge(3); // Require 3 validator signatures
    yield bridge.initialize();
    try {
      // Add bridge validators
      const validators = [
        {
          validatorId: "validator-1",
          supportedChains: [src_1.ChainId.BITCOIN, src_1.ChainId.STELLAR],
          providerId: "validator-1-provider",
          publicKey: "0x1234567890abcdef",
          stake: "10000",
          reputation: 95,
        },
        {
          validatorId: "validator-2",
          supportedChains: [src_1.ChainId.STELLAR, src_1.ChainId.STARKNET],
          providerId: "validator-2-provider",
          publicKey: "0xabcdef1234567890",
          stake: "15000",
          reputation: 98,
        },
        {
          validatorId: "validator-3",
          supportedChains: [src_1.ChainId.BITCOIN, src_1.ChainId.STARKNET],
          providerId: "validator-3-provider",
          publicKey: "0x567890abcdef1234",
          stake: "12000",
          reputation: 92,
        },
        {
          validatorId: "validator-4",
          supportedChains: [
            src_1.ChainId.BITCOIN,
            src_1.ChainId.STELLAR,
            src_1.ChainId.STARKNET,
          ],
          providerId: "validator-4-provider",
          publicKey: "0x90abcdef12345678",
          stake: "20000",
          reputation: 99,
        },
      ];
      for (const validator of validators) {
        yield bridge.addValidator(validator);
      }
      console.log("\n📊 Bridge Statistics:");
      const stats = bridge.getBridgeStats();
      console.log(`Total Validators: ${stats.totalValidators}`);
      console.log(`Supported Chains: ${stats.supportedChains.join(", ")}`);
      console.log("Validators by Chain:", stats.validatorsByChain);
      // Example 1: Bitcoin to Stellar bridge
      console.log("\n🌉 Example 1: Bitcoin → Stellar Bridge");
      const btcToStellarRequest = {
        operationType: BridgeOperationType.LOCK,
        sourceChain: src_1.ChainId.BITCOIN,
        destinationChain: src_1.ChainId.STELLAR,
        amount: "0.1",
        sourceAddress: "bc1quser123example",
        destinationAddress: "GUSER123EXAMPLE",
        bridgeId: "btc-stellar-bridge",
        nonce: 1,
      };
      const btcToStellarResult =
        yield bridge.executeBridgeOperation(btcToStellarRequest);
      console.log(
        "Bridge Result:",
        btcToStellarResult.success ? "✅ Success" : "❌ Failed"
      );
      if (btcToStellarResult.success) {
        console.log(`Source TX: ${btcToStellarResult.sourceTransactionHash}`);
        console.log(
          `Destination TX: ${btcToStellarResult.destinationTransactionHash}`
        );
        console.log(
          `Validator Signatures: ${btcToStellarResult.validatorSignatures}/${btcToStellarResult.requiredSignatures}`
        );
      } else {
        console.log(`Error: ${btcToStellarResult.error}`);
      }
      // Example 2: Stellar to Starknet bridge
      console.log("\n🌉 Example 2: Stellar → Starknet Bridge");
      const stellarToStarknetRequest = {
        operationType: BridgeOperationType.BURN,
        sourceChain: src_1.ChainId.STELLAR,
        destinationChain: src_1.ChainId.STARKNET,
        amount: "500",
        sourceAddress: "GUSER456EXAMPLE",
        destinationAddress: "0x1234567890abcdef1234567890abcdef12345678",
        tokenContract: "GTOKEN123EXAMPLE",
        bridgeId: "stellar-starknet-bridge",
        nonce: 2,
      };
      const stellarToStarknetResult = yield bridge.executeBridgeOperation(
        stellarToStarknetRequest
      );
      console.log(
        "Bridge Result:",
        stellarToStarknetResult.success ? "✅ Success" : "❌ Failed"
      );
      if (stellarToStarknetResult.success) {
        console.log(
          `Source TX: ${stellarToStarknetResult.sourceTransactionHash}`
        );
        console.log(
          `Destination TX: ${stellarToStarknetResult.destinationTransactionHash}`
        );
        console.log(
          `Validator Signatures: ${stellarToStarknetResult.validatorSignatures}/${stellarToStarknetResult.requiredSignatures}`
        );
      } else {
        console.log(`Error: ${stellarToStarknetResult.error}`);
      }
      // Example 3: Bridge proof verification
      console.log("\n🔍 Example 3: Bridge Proof Verification");
      if (btcToStellarResult.success && btcToStellarResult.bridgeProof) {
        const proofValid = yield bridge.verifyBridgeProof(
          btcToStellarResult.bridgeProof,
          src_1.ChainId.BITCOIN,
          src_1.ChainId.STELLAR,
          "0.1"
        );
        console.log(
          "Bridge Proof Valid:",
          proofValid ? "✅ Valid" : "❌ Invalid"
        );
      }
    } catch (error) {
      console.error("Bridge operation failed:", error);
    } finally {
      yield bridge.dispose();
    }
  });
}
// Run the example
if (require.main === module) {
  crossChainBridgeExample().catch(console.error);
}
