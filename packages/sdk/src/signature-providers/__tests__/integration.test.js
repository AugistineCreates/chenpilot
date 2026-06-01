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
const provider_factory_1 = require("../provider-factory");
const multi_signature_coordinator_1 = require("../multi-signature-coordinator");
const signature_verification_1 = require("../signature-verification");
const mock_provider_1 = require("../mock-provider");
const errors_1 = require("../errors");
describe("SignatureProvider Integration Tests", () => {
  let registry;
  let factory;
  let coordinator;
  beforeEach(() => {
    registry = new registry_1.SignatureProviderRegistry();
    factory = new provider_factory_1.SignatureProviderFactory({
      defaultRegistry: registry,
      enableLogging: false,
    });
    coordinator = new multi_signature_coordinator_1.MultiSignatureCoordinator();
  });
  afterEach(() =>
    __awaiter(void 0, void 0, void 0, function* () {
      yield factory.dispose();
      registry.clear();
    })
  );
  describe("End-to-End Provider Workflow", () => {
    it("should complete full provider lifecycle", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // 1. Discover available providers
        const discoveries = yield factory.discoverProviders();
        expect(discoveries.length).toBeGreaterThan(0);
        // 2. Create providers for Stellar chain
        const providers = yield factory.createProvidersForChain(
          types_1.ChainId.STELLAR,
          {
            autoConnect: true,
            autoRegister: true,
          }
        );
        expect(providers.length).toBeGreaterThan(0);
        // 3. Verify providers are registered
        const registeredProviders = registry.listProviders();
        expect(registeredProviders.length).toBe(providers.length);
        // 4. Get accounts from first provider
        const provider = providers[0];
        const accounts = yield provider.getAccounts(types_1.ChainId.STELLAR);
        expect(accounts.length).toBeGreaterThan(0);
        // 5. Sign a transaction
        const transaction = {
          sourceAccount: accounts[0].address,
          fee: "100",
          sequenceNumber: "1",
          operations: [
            {
              type: "payment",
              destination: "GTEST123",
              asset: "native",
              amount: "10",
            },
          ],
        };
        const signatureRequest = {
          transactionData: {
            chainId: types_1.ChainId.STELLAR,
            transaction,
          },
          accountAddress: accounts[0].address,
        };
        const result = yield provider.signTransaction(signatureRequest);
        expect(result.signature).toBeTruthy();
        expect(result.publicKey).toBeTruthy();
        // 6. Verify the signature
        const verificationRequest = {
          signature: result.signature,
          publicKey: result.publicKey,
          transactionData: signatureRequest.transactionData,
          chainId: types_1.ChainId.STELLAR,
        };
        const verification =
          yield signature_verification_1.SignatureVerificationUtils.verifySignature(
            verificationRequest
          );
        expect(verification.chainId).toBe(types_1.ChainId.STELLAR);
        // 7. Disconnect and cleanup
        yield provider.disconnect();
        expect(provider.isConnected()).toBe(false);
      }));
    it("should handle multi-chain workflow", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Create providers for different chains
        const bitcoinProviders = yield factory.createProvidersForChain(
          types_1.ChainId.BITCOIN,
          {
            autoConnect: true,
            autoRegister: true,
          }
        );
        const stellarProviders = yield factory.createProvidersForChain(
          types_1.ChainId.STELLAR,
          {
            autoConnect: true,
            autoRegister: true,
          }
        );
        const starknetProviders = yield factory.createProvidersForChain(
          types_1.ChainId.STARKNET,
          {
            autoConnect: true,
            autoRegister: true,
          }
        );
        expect(bitcoinProviders.length).toBeGreaterThan(0);
        expect(stellarProviders.length).toBeGreaterThan(0);
        expect(starknetProviders.length).toBeGreaterThan(0);
        // Test signing on each chain
        const chains = [
          { chainId: types_1.ChainId.BITCOIN, providers: bitcoinProviders },
          { chainId: types_1.ChainId.STELLAR, providers: stellarProviders },
          { chainId: types_1.ChainId.STARKNET, providers: starknetProviders },
        ];
        for (const { chainId, providers } of chains) {
          const provider = providers[0];
          const accounts = yield provider.getAccounts(chainId);
          expect(accounts.length).toBeGreaterThan(0);
          const transaction = createTestTransaction(
            chainId,
            accounts[0].address
          );
          const signatureRequest = {
            transactionData: { chainId, transaction },
            accountAddress: accounts[0].address,
          };
          const result = yield provider.signTransaction(signatureRequest);
          expect(result.signature).toBeTruthy();
          expect(result.publicKey).toBeTruthy();
        }
      }));
  });
  describe("Multi-Signature Integration", () => {
    it("should complete multi-signature workflow", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Create multiple providers for multi-sig
        const mockProvider1 = new mock_provider_1.MockSignatureProvider(
          "multisig-provider-1"
        );
        const mockProvider2 = new mock_provider_1.MockSignatureProvider(
          "multisig-provider-2"
        );
        const mockProvider3 = new mock_provider_1.MockSignatureProvider(
          "multisig-provider-3"
        );
        coordinator.registerProvider(mockProvider1);
        coordinator.registerProvider(mockProvider2);
        coordinator.registerProvider(mockProvider3);
        // Connect all providers
        yield mockProvider1.connect();
        yield mockProvider2.connect();
        yield mockProvider3.connect();
        // Get accounts from each provider
        const accounts1 = yield mockProvider1.getAccounts(
          types_1.ChainId.STELLAR
        );
        const accounts2 = yield mockProvider2.getAccounts(
          types_1.ChainId.STELLAR
        );
        const accounts3 = yield mockProvider3.getAccounts(
          types_1.ChainId.STELLAR
        );
        // Setup multi-signature configuration
        const signers = [
          {
            providerId: "multisig-provider-1",
            accountAddress: accounts1[0].address,
            publicKey: accounts1[0].publicKey,
            required: true,
          },
          {
            providerId: "multisig-provider-2",
            accountAddress: accounts2[0].address,
            publicKey: accounts2[0].publicKey,
            required: true,
          },
          {
            providerId: "multisig-provider-3",
            accountAddress: accounts3[0].address,
            publicKey: accounts3[0].publicKey,
            required: false,
          },
        ];
        const config = {
          requiredSignatures: 2,
          totalSigners: 3,
          allowPartialSigning: true,
          continueOnError: true,
        };
        // Create transaction
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
        const transactionData = {
          chainId: types_1.ChainId.STELLAR,
          transaction,
        };
        // Execute multi-signature workflow
        const workflowResult = yield coordinator.startWorkflow(
          transactionData,
          signers,
          config
        );
        expect(workflowResult.status).toBe("completed");
        expect(workflowResult.requiredMet).toBe(true);
        expect(
          workflowResult.signatures.filter(
            (s) =>
              s.status ===
              multi_signature_coordinator_1.SignatureStatus.COMPLETED
          ).length
        ).toBeGreaterThanOrEqual(2);
        expect(workflowResult.finalTransaction).toBeDefined();
        // Verify multi-signature result
        const completedSignatures = workflowResult.signatures.filter(
          (s) =>
            s.status === multi_signature_coordinator_1.SignatureStatus.COMPLETED
        );
        const multiSigVerification =
          yield signature_verification_1.SignatureVerificationUtils.verifyMultiSignature(
            completedSignatures.map((s) => ({
              signature: s.signature,
              publicKey: s.signerInfo.publicKey,
            })),
            transactionData,
            types_1.ChainId.STELLAR,
            config.requiredSignatures
          );
        expect(multiSigVerification.thresholdMet).toBe(true);
        expect(
          multiSigVerification.validSignatures.length
        ).toBeGreaterThanOrEqual(config.requiredSignatures);
        // Cleanup
        yield mockProvider1.disconnect();
        yield mockProvider2.disconnect();
        yield mockProvider3.disconnect();
      }));
    it("should handle multi-signature with failures", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Create providers with one that will fail
        const mockProvider1 = new mock_provider_1.MockSignatureProvider(
          "fail-provider-1"
        );
        const mockProvider2 = new mock_provider_1.MockSignatureProvider(
          "fail-provider-2",
          undefined,
          {
            shouldFailSigning: true,
          }
        );
        const mockProvider3 = new mock_provider_1.MockSignatureProvider(
          "fail-provider-3"
        );
        coordinator.registerProvider(mockProvider1);
        coordinator.registerProvider(mockProvider2);
        coordinator.registerProvider(mockProvider3);
        yield mockProvider1.connect();
        yield mockProvider2.connect();
        yield mockProvider3.connect();
        const accounts1 = yield mockProvider1.getAccounts(
          types_1.ChainId.STELLAR
        );
        const accounts2 = yield mockProvider2.getAccounts(
          types_1.ChainId.STELLAR
        );
        const accounts3 = yield mockProvider3.getAccounts(
          types_1.ChainId.STELLAR
        );
        const signers = [
          {
            providerId: "fail-provider-1",
            accountAddress: accounts1[0].address,
            publicKey: accounts1[0].publicKey,
            required: true,
          },
          {
            providerId: "fail-provider-2",
            accountAddress: accounts2[0].address,
            publicKey: accounts2[0].publicKey,
            required: false, // Not required, so failure is OK
          },
          {
            providerId: "fail-provider-3",
            accountAddress: accounts3[0].address,
            publicKey: accounts3[0].publicKey,
            required: true,
          },
        ];
        const config = {
          requiredSignatures: 2,
          totalSigners: 3,
          allowPartialSigning: true,
          continueOnError: true,
        };
        const transaction = {
          sourceAccount: accounts1[0].address,
          fee: "100",
          sequenceNumber: "1",
          operations: [{ type: "payment", destination: "GTEST", amount: "50" }],
        };
        const workflowResult = yield coordinator.startWorkflow(
          { chainId: types_1.ChainId.STELLAR, transaction },
          signers,
          config
        );
        expect(workflowResult.status).toBe("completed");
        expect(workflowResult.requiredMet).toBe(true);
        const completedSignatures = workflowResult.signatures.filter(
          (s) =>
            s.status === multi_signature_coordinator_1.SignatureStatus.COMPLETED
        );
        const failedSignatures = workflowResult.signatures.filter(
          (s) =>
            s.status === multi_signature_coordinator_1.SignatureStatus.FAILED
        );
        expect(completedSignatures.length).toBe(2);
        expect(failedSignatures.length).toBe(1);
        // Cleanup
        yield mockProvider1.disconnect();
        yield mockProvider2.disconnect();
        yield mockProvider3.disconnect();
      }));
  });
  describe("Provider Registry Integration", () => {
    it("should manage provider lifecycle through registry", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Create providers using factory
        const providers = yield factory.createProviders(
          [
            { type: provider_factory_1.ProviderType.MOCK },
            { type: provider_factory_1.ProviderType.LEDGER },
            { type: provider_factory_1.ProviderType.ALBEDO },
          ],
          {
            autoConnect: true,
            autoRegister: true,
          }
        );
        expect(providers.length).toBe(3);
        expect(registry.getProviderCount()).toBe(3);
        // Test provider discovery through registry
        const stellarProviders = registry.findProvidersForChain(
          types_1.ChainId.STELLAR
        );
        expect(stellarProviders.length).toBeGreaterThan(0);
        const bitcoinProviders = registry.findProvidersForChain(
          types_1.ChainId.BITCOIN
        );
        expect(bitcoinProviders.length).toBeGreaterThan(0);
        // Test multi-chain provider discovery
        const multiChainProviders = registry.findMultiChainProviders([
          types_1.ChainId.STELLAR,
          types_1.ChainId.BITCOIN,
        ]);
        expect(multiChainProviders.length).toBeGreaterThan(0);
        // Test provider removal
        const providerId = providers[0].providerId;
        registry.unregister(providerId);
        expect(registry.hasProvider(providerId)).toBe(false);
        expect(registry.getProviderCount()).toBe(2);
      }));
    it("should handle provider registration events", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const registrationEvents = [];
        const unregistrationEvents = [];
        registry.onProviderRegistered((providerId) => {
          registrationEvents.push(providerId);
        });
        registry.onProviderUnregistered((providerId) => {
          unregistrationEvents.push(providerId);
        });
        // Create and register providers
        const provider1 = yield factory.createProvider(
          { type: provider_factory_1.ProviderType.MOCK },
          {
            autoRegister: true,
          }
        );
        const provider2 = yield factory.createProvider(
          { type: provider_factory_1.ProviderType.LEDGER },
          {
            autoRegister: true,
          }
        );
        expect(registrationEvents).toContain(provider1.providerId);
        expect(registrationEvents).toContain(provider2.providerId);
        // Unregister providers
        registry.unregister(provider1.providerId);
        registry.unregister(provider2.providerId);
        expect(unregistrationEvents).toContain(provider1.providerId);
        expect(unregistrationEvents).toContain(provider2.providerId);
      }));
  });
  describe("Error Handling Integration", () => {
    it("should handle provider connection failures gracefully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Create provider that will fail to connect
        const provider = new mock_provider_1.MockSignatureProvider(
          "failing-provider",
          undefined,
          {
            shouldFailConnection: true,
          }
        );
        yield expect(provider.connect()).rejects.toThrow(
          errors_1.ConnectionError
        );
        // Registry should handle failed providers
        expect(() => registry.register(provider)).not.toThrow();
        expect(registry.hasProvider("failing-provider")).toBe(true);
      }));
    it("should handle signing failures in multi-signature workflow", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockProvider1 = new mock_provider_1.MockSignatureProvider(
          "error-provider-1"
        );
        const mockProvider2 = new mock_provider_1.MockSignatureProvider(
          "error-provider-2",
          undefined,
          {
            shouldRejectSigning: true,
          }
        );
        coordinator.registerProvider(mockProvider1);
        coordinator.registerProvider(mockProvider2);
        yield mockProvider1.connect();
        yield mockProvider2.connect();
        const accounts1 = yield mockProvider1.getAccounts(
          types_1.ChainId.STELLAR
        );
        const accounts2 = yield mockProvider2.getAccounts(
          types_1.ChainId.STELLAR
        );
        const signers = [
          {
            providerId: "error-provider-1",
            accountAddress: accounts1[0].address,
            required: true,
          },
          {
            providerId: "error-provider-2",
            accountAddress: accounts2[0].address,
            required: false,
          },
        ];
        const config = {
          requiredSignatures: 1,
          totalSigners: 2,
          continueOnError: true,
        };
        const transaction = {
          sourceAccount: accounts1[0].address,
          fee: "100",
          sequenceNumber: "1",
          operations: [{ type: "payment" }],
        };
        const workflowResult = yield coordinator.startWorkflow(
          { chainId: types_1.ChainId.STELLAR, transaction },
          signers,
          config
        );
        expect(workflowResult.status).toBe("completed");
        const rejectedSignatures = workflowResult.signatures.filter(
          (s) =>
            s.status === multi_signature_coordinator_1.SignatureStatus.REJECTED
        );
        expect(rejectedSignatures.length).toBe(1);
        expect(rejectedSignatures[0].error).toBeInstanceOf(
          errors_1.UserRejectedError
        );
        // Cleanup
        yield mockProvider1.disconnect();
        yield mockProvider2.disconnect();
      }));
  });
  describe("Performance and Scalability", () => {
    it("should handle multiple concurrent operations", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Create multiple providers
        const providers = yield factory.createProviders(
          [
            {
              type: provider_factory_1.ProviderType.MOCK,
              config: { signingDelay: 100 },
            },
            {
              type: provider_factory_1.ProviderType.MOCK,
              config: { signingDelay: 150 },
            },
            {
              type: provider_factory_1.ProviderType.MOCK,
              config: { signingDelay: 200 },
            },
          ],
          {
            autoConnect: true,
          }
        );
        // Perform concurrent signing operations
        const signingPromises = providers.map((provider, index) =>
          __awaiter(void 0, void 0, void 0, function* () {
            const accounts = yield provider.getAccounts(
              types_1.ChainId.STELLAR
            );
            const transaction = {
              sourceAccount: accounts[0].address,
              fee: "100",
              sequenceNumber: String(index + 1),
              operations: [{ type: "payment" }],
            };
            return provider.signTransaction({
              transactionData: {
                chainId: types_1.ChainId.STELLAR,
                transaction,
              },
              accountAddress: accounts[0].address,
            });
          })
        );
        const startTime = Date.now();
        const results = yield Promise.all(signingPromises);
        const endTime = Date.now();
        expect(results.length).toBe(3);
        expect(results.every((r) => r.signature)).toBe(true);
        // Should complete faster than sequential execution
        expect(endTime - startTime).toBeLessThan(600); // Less than sum of delays
      }));
    it("should handle batch signature verification", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const provider = new mock_provider_1.MockSignatureProvider(
          "batch-provider"
        );
        yield provider.connect();
        const accounts = yield provider.getAccounts(types_1.ChainId.STELLAR);
        const verificationRequests = [];
        // Create multiple signature verification requests
        for (let i = 0; i < 10; i++) {
          const transaction = {
            sourceAccount: accounts[0].address,
            fee: "100",
            sequenceNumber: String(i + 1),
            operations: [{ type: "payment" }],
          };
          const signatureResult = yield provider.signTransaction({
            transactionData: { chainId: types_1.ChainId.STELLAR, transaction },
            accountAddress: accounts[0].address,
          });
          verificationRequests.push({
            signature: signatureResult.signature,
            publicKey: signatureResult.publicKey,
            transactionData: { chainId: types_1.ChainId.STELLAR, transaction },
            chainId: types_1.ChainId.STELLAR,
          });
        }
        // Batch verify all signatures
        const startTime = Date.now();
        const verificationResults =
          yield signature_verification_1.SignatureVerificationUtils.batchVerifySignatures(
            verificationRequests
          );
        const endTime = Date.now();
        expect(verificationResults.length).toBe(10);
        expect(
          verificationResults.every(
            (r) => r.chainId === types_1.ChainId.STELLAR
          )
        ).toBe(true);
        console.log(
          `Batch verification of 10 signatures took ${endTime - startTime}ms`
        );
        yield provider.disconnect();
      }));
  });
  // Helper function to create test transactions for different chains
  function createTestTransaction(chainId, sourceAccount) {
    switch (chainId) {
      case types_1.ChainId.BITCOIN:
        return {
          inputs: [{ txid: "test-txid", vout: 0 }],
          outputs: [{ value: 100000, scriptPubKey: "test-script" }],
        };
      case types_1.ChainId.STELLAR:
        return {
          sourceAccount,
          fee: "100",
          sequenceNumber: "1",
          operations: [{ type: "payment", destination: "GTEST", amount: "10" }],
        };
      case types_1.ChainId.STARKNET:
        return {
          contractAddress: "0x123",
          entrypoint: "transfer",
          calldata: ["0x456", "1000", "0"],
        };
      default:
        throw new Error(`Unsupported chain: ${chainId}`);
    }
  }
});
