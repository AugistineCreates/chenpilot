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
const ledger_provider_1 = require("../ledger-provider");
const albedo_provider_1 = require("../albedo-provider");
const error_recovery_1 = require("../error-recovery");
describe("Cross-Provider Integration Tests", () => {
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
  describe("Mixed Provider Multi-Signature", () => {
    it("should coordinate signatures across different provider types", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Create different types of providers
        const mockProvider = new mock_provider_1.MockSignatureProvider(
          "mixed-mock"
        );
        const ledgerProvider = new ledger_provider_1.LedgerSignatureProvider({
          enableDebugLogging: false,
        });
        const albedoProvider = new albedo_provider_1.AlbedoSignatureProvider({
          enableDebugLogging: false,
        });
        // Register all providers with coordinator
        coordinator.registerProvider(mockProvider);
        coordinator.registerProvider(ledgerProvider);
        coordinator.registerProvider(albedoProvider);
        // Connect all providers
        yield mockProvider.connect();
        yield ledgerProvider.connect();
        yield albedoProvider.connect();
        // Get accounts from each provider (all support Stellar)
        const mockAccounts = yield mockProvider.getAccounts(
          types_1.ChainId.STELLAR
        );
        const ledgerAccounts = yield ledgerProvider.getAccounts(
          types_1.ChainId.STELLAR
        );
        const albedoAccounts = yield albedoProvider.getAccounts(
          types_1.ChainId.STELLAR
        );
        // Setup mixed provider multi-signature
        const signers = [
          {
            providerId: "mixed-mock",
            accountAddress: mockAccounts[0].address,
            publicKey: mockAccounts[0].publicKey,
            required: true,
            metadata: { providerType: "mock" },
          },
          {
            providerId: "ledger-provider",
            accountAddress: ledgerAccounts[0].address,
            publicKey: ledgerAccounts[0].publicKey,
            required: true,
            metadata: { providerType: "ledger" },
          },
          {
            providerId: "albedo-provider",
            accountAddress: albedoAccounts[0].address,
            publicKey: albedoAccounts[0].publicKey,
            required: false,
            metadata: { providerType: "albedo" },
          },
        ];
        const config = {
          requiredSignatures: 2,
          totalSigners: 3,
          allowPartialSigning: true,
          continueOnError: true,
          description: "Mixed provider multi-signature test",
        };
        const transaction = {
          sourceAccount: mockAccounts[0].address,
          fee: "100",
          sequenceNumber: "1",
          operations: [
            {
              type: "payment",
              destination: "GMIXED123",
              asset: "native",
              amount: "250",
            },
          ],
        };
        // Track events
        const events = [];
        coordinator.addEventListener((event) => {
          events.push(event);
        });
        // Execute mixed provider workflow
        const workflowResult = yield coordinator.startWorkflow(
          { chainId: types_1.ChainId.STELLAR, transaction },
          signers,
          config
        );
        expect(workflowResult.status).toBe("completed");
        expect(workflowResult.requiredMet).toBe(true);
        // Verify we got signatures from different provider types
        const completedSignatures = workflowResult.signatures.filter(
          (s) => s.status === "completed"
        );
        expect(completedSignatures.length).toBeGreaterThanOrEqual(2);
        // Verify events were emitted for each provider
        const signatureStartedEvents = events.filter(
          (e) =>
            e.type ===
            multi_signature_coordinator_1.MultiSignatureEventType
              .SIGNATURE_STARTED
        );
        const signatureCompletedEvents = events.filter(
          (e) =>
            e.type ===
            multi_signature_coordinator_1.MultiSignatureEventType
              .SIGNATURE_COMPLETED
        );
        expect(signatureStartedEvents.length).toBe(3);
        expect(signatureCompletedEvents.length).toBeGreaterThanOrEqual(2);
        // Verify signatures from different providers
        for (const signature of completedSignatures) {
          const verification =
            yield signature_verification_1.SignatureVerificationUtils.verifySignature(
              {
                signature: signature.signature,
                publicKey: signature.signerInfo.publicKey,
                transactionData: {
                  chainId: types_1.ChainId.STELLAR,
                  transaction,
                },
                chainId: types_1.ChainId.STELLAR,
              }
            );
          expect(verification.chainId).toBe(types_1.ChainId.STELLAR);
        }
        // Cleanup
        yield mockProvider.disconnect();
        yield ledgerProvider.disconnect();
        yield albedoProvider.disconnect();
      }));
    it("should handle provider-specific failures in mixed workflow", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Create providers with different failure modes
        const mockProvider = new mock_provider_1.MockSignatureProvider(
          "reliable-mock"
        );
        const failingLedger = new mock_provider_1.MockSignatureProvider(
          "failing-ledger",
          undefined,
          {
            shouldFailSigning: true,
          }
        );
        const rejectingAlbedo = new mock_provider_1.MockSignatureProvider(
          "rejecting-albedo",
          undefined,
          {
            shouldRejectSigning: true,
          }
        );
        coordinator.registerProvider(mockProvider);
        coordinator.registerProvider(failingLedger);
        coordinator.registerProvider(rejectingAlbedo);
        yield mockProvider.connect();
        yield failingLedger.connect();
        yield rejectingAlbedo.connect();
        const mockAccounts = yield mockProvider.getAccounts(
          types_1.ChainId.STELLAR
        );
        const ledgerAccounts = yield failingLedger.getAccounts(
          types_1.ChainId.STELLAR
        );
        const albedoAccounts = yield rejectingAlbedo.getAccounts(
          types_1.ChainId.STELLAR
        );
        const signers = [
          {
            providerId: "reliable-mock",
            accountAddress: mockAccounts[0].address,
            required: true,
          },
          {
            providerId: "failing-ledger",
            accountAddress: ledgerAccounts[0].address,
            required: false, // Not required, so failure is OK
          },
          {
            providerId: "rejecting-albedo",
            accountAddress: albedoAccounts[0].address,
            required: false, // Not required, so rejection is OK
          },
        ];
        const config = {
          requiredSignatures: 1,
          totalSigners: 3,
          continueOnError: true,
        };
        const transaction = {
          sourceAccount: mockAccounts[0].address,
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
        expect(workflowResult.requiredMet).toBe(true);
        // Check that we have the expected failure types
        const completedSignatures = workflowResult.signatures.filter(
          (s) => s.status === "completed"
        );
        const failedSignatures = workflowResult.signatures.filter(
          (s) => s.status === "failed"
        );
        const rejectedSignatures = workflowResult.signatures.filter(
          (s) => s.status === "rejected"
        );
        expect(completedSignatures.length).toBe(1);
        expect(failedSignatures.length).toBe(1);
        expect(rejectedSignatures.length).toBe(1);
        // Cleanup
        yield mockProvider.disconnect();
        yield failingLedger.disconnect();
        yield rejectingAlbedo.disconnect();
      }));
  });
  describe("Provider Discovery and Selection", () => {
    it("should discover and select optimal providers for different scenarios", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Test discovery
        const discoveries = yield factory.discoverProviders();
        expect(discoveries.length).toBeGreaterThan(0);
        // Test chain-specific selection
        const stellarProviders = yield factory.createProvidersForChain(
          types_1.ChainId.STELLAR,
          {
            autoConnect: false,
          }
        );
        expect(stellarProviders.length).toBeGreaterThan(0);
        // Test best provider selection with preferences
        const hardwarePreferred = yield factory.getBestProviderForChain(
          types_1.ChainId.BITCOIN,
          {
            preferHardwareWallet: true,
          }
        );
        expect(hardwarePreferred).toBeDefined();
        const browserPreferred = yield factory.getBestProviderForChain(
          types_1.ChainId.STELLAR,
          {
            preferBrowserExtension: true,
          }
        );
        expect(browserPreferred).toBeDefined();
        // Verify different providers were selected based on preferences
        // (In our mock setup, this tests the scoring logic)
        expect(hardwarePreferred.providerId).toBeDefined();
        expect(browserPreferred.providerId).toBeDefined();
      }));
    it("should handle provider availability changes", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Initial discovery
        const initialDiscoveries = yield factory.discoverProviders();
        const initialCount = initialDiscoveries.filter(
          (d) => d.available
        ).length;
        // Clear cache and rediscover
        factory.clearDiscoveryCache();
        const newDiscoveries = yield factory.discoverProviders();
        expect(newDiscoveries.length).toBe(initialDiscoveries.length);
        // In a real scenario, availability might change
        // Here we test that the discovery system works consistently
        const newCount = newDiscoveries.filter((d) => d.available).length;
        expect(newCount).toBe(initialCount);
      }));
  });
  describe("Error Recovery Integration", () => {
    it("should recover from provider errors using error recovery system", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockProvider = new mock_provider_1.MockSignatureProvider(
          "recovery-test",
          undefined,
          {
            shouldFailSigning: true,
          }
        );
        yield mockProvider.connect();
        const accounts = yield mockProvider.getAccounts(
          types_1.ChainId.STELLAR
        );
        const transaction = {
          sourceAccount: accounts[0].address,
          fee: "100",
          sequenceNumber: "1",
          operations: [{ type: "payment" }],
        };
        const signatureRequest = {
          transactionData: { chainId: types_1.ChainId.STELLAR, transaction },
          accountAddress: accounts[0].address,
        };
        // Attempt signing (will fail)
        try {
          yield mockProvider.signTransaction(signatureRequest);
          fail("Expected signing to fail");
        } catch (error) {
          // Use error recovery system
          const recoveryContext = {
            providerId: mockProvider.providerId,
            chainId: types_1.ChainId.STELLAR,
            retryCount: 0,
            maxRetries: 3,
          };
          const recoveryResult =
            yield error_recovery_1.signatureProviderErrorRecovery.recover(
              error,
              recoveryContext
            );
          expect(recoveryResult.success).toBe(false);
          expect(recoveryResult.instructions).toBeDefined();
          expect(recoveryResult.instructions.length).toBeGreaterThan(0);
          // Test recovery instructions
          const instructions =
            error_recovery_1.signatureProviderErrorRecovery.getRecoveryInstructions(
              error
            );
          expect(instructions.length).toBeGreaterThan(0);
          // Test recoverability check
          const canRecover =
            error_recovery_1.signatureProviderErrorRecovery.canRecover(error);
          expect(typeof canRecover).toBe("boolean");
        }
        yield mockProvider.disconnect();
      }));
    it("should provide appropriate recovery strategies for different error types", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const testErrors = [
          new Error("Connection timeout"),
          new Error("User rejected"),
          new Error("Device not found"),
          new Error("Network error"),
        ];
        for (const error of testErrors) {
          const canRecover =
            error_recovery_1.signatureProviderErrorRecovery.canRecover(error);
          const instructions =
            error_recovery_1.signatureProviderErrorRecovery.getRecoveryInstructions(
              error
            );
          expect(typeof canRecover).toBe("boolean");
          expect(Array.isArray(instructions)).toBe(true);
          expect(instructions.length).toBeGreaterThan(0);
          if (canRecover) {
            const recoveryResult =
              yield error_recovery_1.signatureProviderErrorRecovery.recover(
                error
              );
            expect(recoveryResult).toBeDefined();
            expect(recoveryResult.instructions).toBeDefined();
          }
        }
      }));
  });
  describe("Performance and Stress Testing", () => {
    it("should handle high-volume multi-signature operations", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const numProviders = 5;
        const providers = [];
        // Create multiple providers
        for (let i = 0; i < numProviders; i++) {
          const provider = new mock_provider_1.MockSignatureProvider(
            `stress-provider-${i}`,
            undefined,
            {
              signingDelay: Math.random() * 100 + 50, // Random delay 50-150ms
            }
          );
          providers.push(provider);
          coordinator.registerProvider(provider);
          yield provider.connect();
        }
        // Setup signers
        const signers = [];
        for (let i = 0; i < numProviders; i++) {
          const accounts = yield providers[i].getAccounts(
            types_1.ChainId.STELLAR
          );
          signers.push({
            providerId: `stress-provider-${i}`,
            accountAddress: accounts[0].address,
            publicKey: accounts[0].publicKey,
            required: i < 3, // First 3 are required
          });
        }
        const config = {
          requiredSignatures: 3,
          totalSigners: numProviders,
          allowPartialSigning: true,
          continueOnError: true,
        };
        const transaction = {
          sourceAccount: signers[0].accountAddress,
          fee: "100",
          sequenceNumber: "1",
          operations: [{ type: "payment" }],
        };
        // Execute stress test
        const startTime = Date.now();
        const workflowResult = yield coordinator.startWorkflow(
          { chainId: types_1.ChainId.STELLAR, transaction },
          signers,
          config
        );
        const endTime = Date.now();
        expect(workflowResult.status).toBe("completed");
        expect(workflowResult.requiredMet).toBe(true);
        const completedSignatures = workflowResult.signatures.filter(
          (s) => s.status === "completed"
        );
        expect(completedSignatures.length).toBeGreaterThanOrEqual(3);
        console.log(
          `Stress test with ${numProviders} providers completed in ${endTime - startTime}ms`
        );
        // Cleanup
        for (const provider of providers) {
          yield provider.disconnect();
        }
      }));
    it("should handle concurrent multi-signature workflows", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const numWorkflows = 3;
        const workflowPromises = [];
        for (let i = 0; i < numWorkflows; i++) {
          const workflowPromise = (() =>
            __awaiter(void 0, void 0, void 0, function* () {
              const workflowCoordinator =
                new multi_signature_coordinator_1.MultiSignatureCoordinator();
              // Create providers for this workflow
              const provider1 = new mock_provider_1.MockSignatureProvider(
                `concurrent-1-${i}`
              );
              const provider2 = new mock_provider_1.MockSignatureProvider(
                `concurrent-2-${i}`
              );
              workflowCoordinator.registerProvider(provider1);
              workflowCoordinator.registerProvider(provider2);
              yield provider1.connect();
              yield provider2.connect();
              const accounts1 = yield provider1.getAccounts(
                types_1.ChainId.STELLAR
              );
              const accounts2 = yield provider2.getAccounts(
                types_1.ChainId.STELLAR
              );
              const signers = [
                {
                  providerId: `concurrent-1-${i}`,
                  accountAddress: accounts1[0].address,
                  required: true,
                },
                {
                  providerId: `concurrent-2-${i}`,
                  accountAddress: accounts2[0].address,
                  required: true,
                },
              ];
              const config = {
                requiredSignatures: 2,
                totalSigners: 2,
              };
              const transaction = {
                sourceAccount: accounts1[0].address,
                fee: "100",
                sequenceNumber: String(i + 1),
                operations: [{ type: "payment" }],
              };
              const result = yield workflowCoordinator.startWorkflow(
                { chainId: types_1.ChainId.STELLAR, transaction },
                signers,
                config
              );
              // Cleanup
              yield provider1.disconnect();
              yield provider2.disconnect();
              return result;
            }))();
          workflowPromises.push(workflowPromise);
        }
        // Execute all workflows concurrently
        const startTime = Date.now();
        const results = yield Promise.all(workflowPromises);
        const endTime = Date.now();
        expect(results.length).toBe(numWorkflows);
        expect(results.every((r) => r.status === "completed")).toBe(true);
        expect(results.every((r) => r.requiredMet)).toBe(true);
        console.log(
          `${numWorkflows} concurrent workflows completed in ${endTime - startTime}ms`
        );
      }));
  });
  describe("Real-World Scenarios", () => {
    it("should simulate treasury management workflow", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        // Simulate a treasury that requires 3-of-5 signatures
        const treasuryProviders = [];
        const treasurySigners = [];
        // Create 5 treasury signers (different provider types)
        for (let i = 0; i < 5; i++) {
          const provider = new mock_provider_1.MockSignatureProvider(
            `treasury-signer-${i}`,
            undefined,
            {
              signingDelay: Math.random() * 200 + 100, // Realistic signing delays
            }
          );
          treasuryProviders.push(provider);
          coordinator.registerProvider(provider);
          yield provider.connect();
          const accounts = yield provider.getAccounts(types_1.ChainId.STELLAR);
          treasurySigners.push({
            providerId: `treasury-signer-${i}`,
            accountAddress: accounts[0].address,
            publicKey: accounts[0].publicKey,
            required: false, // None are individually required
            metadata: {
              role: i < 2 ? "admin" : "member",
              department: i % 2 === 0 ? "finance" : "operations",
            },
          });
        }
        const treasuryConfig = {
          requiredSignatures: 3,
          totalSigners: 5,
          allowPartialSigning: false, // Must get required signatures
          continueOnError: true,
          description: "Treasury payment requiring 3-of-5 signatures",
        };
        // Large treasury payment
        const treasuryTransaction = {
          sourceAccount: treasurySigners[0].accountAddress,
          fee: "100",
          sequenceNumber: "1",
          operations: [
            {
              type: "payment",
              destination: "GVENDOR123",
              asset: "native",
              amount: "10000", // Large payment
            },
          ],
          memo: {
            type: "text",
            value: "Vendor payment - Invoice #12345",
          },
        };
        const treasuryResult = yield coordinator.startWorkflow(
          {
            chainId: types_1.ChainId.STELLAR,
            transaction: treasuryTransaction,
          },
          treasurySigners,
          treasuryConfig
        );
        expect(treasuryResult.status).toBe("completed");
        expect(treasuryResult.requiredMet).toBe(true);
        const completedSignatures = treasuryResult.signatures.filter(
          (s) => s.status === "completed"
        );
        expect(completedSignatures.length).toBeGreaterThanOrEqual(3);
        // Verify the final transaction has proper multi-signature structure
        expect(treasuryResult.finalTransaction).toBeDefined();
        expect(treasuryResult.finalTransaction.multiSignature).toBeDefined();
        expect(
          ((_a = treasuryResult.finalTransaction.multiSignature) === null ||
          _a === void 0
            ? void 0
            : _a.signatures.length) || 0
        ).toBeGreaterThanOrEqual(3);
        // Cleanup
        for (const provider of treasuryProviders) {
          yield provider.disconnect();
        }
      }));
    it("should simulate cross-chain bridge workflow", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Simulate a cross-chain bridge requiring signatures from different chains
        const bridgeProviders = [
          new mock_provider_1.MockSignatureProvider(
            "bridge-stellar",
            undefined,
            {
              customCapabilities: {
                supportedChains: [types_1.ChainId.STELLAR],
              },
            }
          ),
          new mock_provider_1.MockSignatureProvider(
            "bridge-bitcoin",
            undefined,
            {
              customCapabilities: {
                supportedChains: [types_1.ChainId.BITCOIN],
              },
            }
          ),
          new mock_provider_1.MockSignatureProvider(
            "bridge-starknet",
            undefined,
            {
              customCapabilities: {
                supportedChains: [types_1.ChainId.STARKNET],
              },
            }
          ),
        ];
        // Connect all bridge providers
        for (const provider of bridgeProviders) {
          coordinator.registerProvider(provider);
          yield provider.connect();
        }
        // For this test, we'll focus on Stellar side of the bridge
        const stellarAccounts = yield bridgeProviders[0].getAccounts(
          types_1.ChainId.STELLAR
        );
        const bridgeSigners = [
          {
            providerId: "bridge-stellar",
            accountAddress: stellarAccounts[0].address,
            publicKey: stellarAccounts[0].publicKey,
            required: true,
            metadata: { role: "bridge-validator", chain: "stellar" },
          },
        ];
        const bridgeConfig = {
          requiredSignatures: 1,
          totalSigners: 1,
          description: "Cross-chain bridge lock transaction",
        };
        // Bridge lock transaction
        const bridgeTransaction = {
          sourceAccount: stellarAccounts[0].address,
          fee: "100",
          sequenceNumber: "1",
          operations: [
            {
              type: "payment",
              destination: "GBRIDGE123", // Bridge contract
              asset: "native",
              amount: "500",
            },
          ],
          memo: {
            type: "hash",
            value: "bridge-lock-hash-123",
          },
        };
        const bridgeResult = yield coordinator.startWorkflow(
          { chainId: types_1.ChainId.STELLAR, transaction: bridgeTransaction },
          bridgeSigners,
          bridgeConfig
        );
        expect(bridgeResult.status).toBe("completed");
        expect(bridgeResult.requiredMet).toBe(true);
        // Cleanup
        for (const provider of bridgeProviders) {
          yield provider.disconnect();
        }
      }));
  });
});
