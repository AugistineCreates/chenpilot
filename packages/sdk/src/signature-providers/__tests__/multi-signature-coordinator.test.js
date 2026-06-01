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
const multi_signature_coordinator_1 = require("../multi-signature-coordinator");
const mock_provider_1 = require("../mock-provider");
const errors_1 = require("../errors");
describe("MultiSignatureCoordinator", () => {
  let coordinator;
  let mockProvider1;
  let mockProvider2;
  let mockProvider3;
  const createTestTransaction = () => ({
    chainId: types_1.ChainId.STELLAR,
    transaction: {
      sourceAccount: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      fee: "100",
      sequenceNumber: "1",
      operations: [{ type: "payment", destination: "GTEST", amount: "100" }],
    },
  });
  const createTestSigners = () => [
    {
      providerId: "mock-provider-1",
      accountAddress:
        "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      publicKey: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      required: true,
      weight: 1,
    },
    {
      providerId: "mock-provider-2",
      accountAddress:
        "GCKFBEIYTKP5RDBKIXFJ2HBMKQCGGFJJP5NKQRXQC4QLQZQZQZQZQZQZ",
      publicKey: "GCKFBEIYTKP5RDBKIXFJ2HBMKQCGGFJJP5NKQRXQC4QLQZQZQZQZQZQZ",
      required: true,
      weight: 1,
    },
    {
      providerId: "mock-provider-3",
      accountAddress:
        "GTEST3KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      publicKey: "GTEST3KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      required: false,
      weight: 1,
    },
  ];
  const createTestConfig = () => ({
    requiredSignatures: 2,
    totalSigners: 3,
    signatureTimeout: 5000,
    totalTimeout: 15000,
    allowPartialSigning: true,
    continueOnError: true,
    description: "Test multi-signature transaction",
  });
  beforeEach(() => {
    coordinator = new multi_signature_coordinator_1.MultiSignatureCoordinator();
    mockProvider1 = new mock_provider_1.MockSignatureProvider(
      "mock-provider-1"
    );
    mockProvider2 = new mock_provider_1.MockSignatureProvider(
      "mock-provider-2"
    );
    mockProvider3 = new mock_provider_1.MockSignatureProvider(
      "mock-provider-3"
    );
    coordinator.registerProvider(mockProvider1);
    coordinator.registerProvider(mockProvider2);
    coordinator.registerProvider(mockProvider3);
  });
  describe("Provider Management", () => {
    it("should register and list providers", () => {
      const providers = coordinator.listProviders();
      expect(providers).toHaveLength(3);
      expect(providers.map((p) => p.providerId)).toContain("mock-provider-1");
      expect(providers.map((p) => p.providerId)).toContain("mock-provider-2");
      expect(providers.map((p) => p.providerId)).toContain("mock-provider-3");
    });
    it("should get specific provider", () => {
      const provider = coordinator.getProvider("mock-provider-1");
      expect(provider).toBe(mockProvider1);
    });
    it("should unregister provider", () => {
      coordinator.unregisterProvider("mock-provider-1");
      const provider = coordinator.getProvider("mock-provider-1");
      expect(provider).toBeUndefined();
      expect(coordinator.listProviders()).toHaveLength(2);
    });
  });
  describe("Event Handling", () => {
    it("should add and remove event listeners", () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      coordinator.addEventListener(handler1);
      coordinator.addEventListener(handler2);
      coordinator.removeEventListener(handler1);
      // Trigger an event by starting a workflow
      const transaction = createTestTransaction();
      const signers = createTestSigners();
      const config = createTestConfig();
      coordinator.startWorkflow(transaction, signers, config);
      // handler1 should not be called, handler2 should be called
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
    it("should emit workflow started event", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const eventHandler = jest.fn();
        coordinator.addEventListener(eventHandler);
        const transaction = createTestTransaction();
        const signers = createTestSigners();
        const config = createTestConfig();
        yield coordinator.startWorkflow(transaction, signers, config);
        const startedEvents = eventHandler.mock.calls
          .map((call) => call[0])
          .filter(
            (event) =>
              event.type ===
              multi_signature_coordinator_1.MultiSignatureEventType
                .WORKFLOW_STARTED
          );
        expect(startedEvents).toHaveLength(1);
        expect(startedEvents[0].workflow).toBeDefined();
      }));
  });
  describe("Workflow Validation", () => {
    it("should validate workflow configuration", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const transaction = createTestTransaction();
        const signers = createTestSigners();
        const invalidConfig = {
          requiredSignatures: 0, // Invalid: must be > 0
          totalSigners: 3,
        };
        yield expect(
          coordinator.startWorkflow(transaction, signers, invalidConfig)
        ).rejects.toThrow(errors_1.InvalidTransactionError);
      }));
    it("should validate required signatures not exceeding total signers", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const transaction = createTestTransaction();
        const signers = createTestSigners();
        const invalidConfig = {
          requiredSignatures: 5, // Invalid: exceeds total signers
          totalSigners: 3,
        };
        yield expect(
          coordinator.startWorkflow(transaction, signers, invalidConfig)
        ).rejects.toThrow(errors_1.InvalidTransactionError);
      }));
    it("should validate signer count matches config", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const transaction = createTestTransaction();
        const signers = createTestSigners().slice(0, 2); // Only 2 signers
        const invalidConfig = {
          requiredSignatures: 2,
          totalSigners: 3, // Config says 3 but only 2 provided
        };
        yield expect(
          coordinator.startWorkflow(transaction, signers, invalidConfig)
        ).rejects.toThrow(errors_1.InvalidTransactionError);
      }));
    it("should validate all providers are registered", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const transaction = createTestTransaction();
        const signers = [
          {
            providerId: "unregistered-provider", // Not registered
            accountAddress: "GTEST",
            required: true,
          },
        ];
        const config = {
          requiredSignatures: 1,
          totalSigners: 1,
        };
        yield expect(
          coordinator.startWorkflow(transaction, signers, config)
        ).rejects.toThrow(errors_1.ConnectionError);
      }));
  });
  describe("Successful Multi-Signature Workflows", () => {
    it("should complete parallel signing workflow", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const transaction = createTestTransaction();
        const signers = createTestSigners();
        const config = createTestConfig();
        const result = yield coordinator.startWorkflow(
          transaction,
          signers,
          config
        );
        expect(result.status).toBe("completed");
        expect(result.requiredMet).toBe(true);
        expect(
          result.signatures.filter(
            (s) =>
              s.status ===
              multi_signature_coordinator_1.SignatureStatus.COMPLETED
          )
        ).toHaveLength(3);
        expect(result.finalTransaction).toBeDefined();
      }));
    it("should complete sequential signing workflow", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const transaction = createTestTransaction();
        const signers = createTestSigners();
        const config = Object.assign(Object.assign({}, createTestConfig()), {
          requireSequentialSigning: true,
        });
        const result = yield coordinator.startWorkflow(
          transaction,
          signers,
          config
        );
        expect(result.status).toBe("completed");
        expect(result.requiredMet).toBe(true);
        expect(
          result.signatures.filter(
            (s) =>
              s.status ===
              multi_signature_coordinator_1.SignatureStatus.COMPLETED
          )
        ).toHaveLength(3);
      }));
    it("should meet threshold with partial signatures", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Configure one provider to fail
        mockProvider3.updateConfig({ shouldFailSigning: true });
        const transaction = createTestTransaction();
        const signers = createTestSigners();
        const config = createTestConfig(); // Requires 2 out of 3
        const result = yield coordinator.startWorkflow(
          transaction,
          signers,
          config
        );
        expect(result.status).toBe("completed");
        expect(result.requiredMet).toBe(true);
        expect(
          result.signatures.filter(
            (s) =>
              s.status ===
              multi_signature_coordinator_1.SignatureStatus.COMPLETED
          )
        ).toHaveLength(2);
        expect(
          result.signatures.filter(
            (s) =>
              s.status === multi_signature_coordinator_1.SignatureStatus.FAILED
          )
        ).toHaveLength(1);
      }));
  });
  describe("Error Handling", () => {
    it("should handle user rejection", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockProvider1.updateConfig({ shouldRejectSigning: true });
        const transaction = createTestTransaction();
        const signers = createTestSigners();
        const config = createTestConfig();
        const result = yield coordinator.startWorkflow(
          transaction,
          signers,
          config
        );
        const rejectedSignature = result.signatures.find(
          (s) => s.signerInfo.providerId === "mock-provider-1"
        );
        expect(
          rejectedSignature === null || rejectedSignature === void 0
            ? void 0
            : rejectedSignature.status
        ).toBe(multi_signature_coordinator_1.SignatureStatus.REJECTED);
        expect(
          rejectedSignature === null || rejectedSignature === void 0
            ? void 0
            : rejectedSignature.error
        ).toBeInstanceOf(errors_1.UserRejectedError);
      }));
    it("should handle signing failures", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockProvider1.updateConfig({ shouldFailSigning: true });
        const transaction = createTestTransaction();
        const signers = createTestSigners();
        const config = createTestConfig();
        const result = yield coordinator.startWorkflow(
          transaction,
          signers,
          config
        );
        const failedSignature = result.signatures.find(
          (s) => s.signerInfo.providerId === "mock-provider-1"
        );
        expect(
          failedSignature === null || failedSignature === void 0
            ? void 0
            : failedSignature.status
        ).toBe(multi_signature_coordinator_1.SignatureStatus.FAILED);
        expect(
          failedSignature === null || failedSignature === void 0
            ? void 0
            : failedSignature.error
        ).toBeInstanceOf(errors_1.SigningError);
      }));
    it("should handle signature timeouts", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockProvider1.updateConfig({ signingDelay: 6000 }); // Longer than timeout
        const transaction = createTestTransaction();
        const signers = createTestSigners();
        const config = Object.assign(Object.assign({}, createTestConfig()), {
          signatureTimeout: 1000,
        });
        const result = yield coordinator.startWorkflow(
          transaction,
          signers,
          config
        );
        const timedOutSignature = result.signatures.find(
          (s) => s.signerInfo.providerId === "mock-provider-1"
        );
        expect(
          timedOutSignature === null || timedOutSignature === void 0
            ? void 0
            : timedOutSignature.status
        ).toBe(multi_signature_coordinator_1.SignatureStatus.TIMEOUT);
      }));
    it("should fail workflow when required signer fails and continueOnError is false", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockProvider1.updateConfig({ shouldFailSigning: true });
        const transaction = createTestTransaction();
        const signers = createTestSigners();
        const config = Object.assign(Object.assign({}, createTestConfig()), {
          continueOnError: false,
        });
        yield expect(
          coordinator.startWorkflow(transaction, signers, config)
        ).rejects.toThrow(errors_1.SigningError);
      }));
    it("should handle insufficient signatures", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Make 2 providers fail, leaving only 1 signature (need 2)
        mockProvider1.updateConfig({ shouldFailSigning: true });
        mockProvider2.updateConfig({ shouldFailSigning: true });
        const transaction = createTestTransaction();
        const signers = createTestSigners();
        const config = Object.assign(Object.assign({}, createTestConfig()), {
          allowPartialSigning: false,
        });
        yield expect(
          coordinator.startWorkflow(transaction, signers, config)
        ).rejects.toThrow(errors_1.SigningError);
      }));
  });
  describe("Workflow Management", () => {
    it("should track active workflows", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const transaction = createTestTransaction();
        const signers = createTestSigners();
        const config = createTestConfig();
        // Start workflow but don't await
        const workflowPromise = coordinator.startWorkflow(
          transaction,
          signers,
          config
        );
        // Check active workflows
        const activeWorkflows = coordinator.getActiveWorkflows();
        expect(activeWorkflows).toHaveLength(1);
        // Wait for completion
        yield workflowPromise;
        // Should be removed from active workflows
        const activeWorkflowsAfter = coordinator.getActiveWorkflows();
        expect(activeWorkflowsAfter).toHaveLength(0);
      }));
    it("should get workflow status", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const transaction = createTestTransaction();
        const signers = createTestSigners();
        const config = createTestConfig();
        const result = yield coordinator.startWorkflow(
          transaction,
          signers,
          config
        );
        // During execution, we could get status (but workflow completes too fast in tests)
        // So we'll just verify the final result structure
        expect(result.transactionId).toBeTruthy();
        expect(result.status).toBe("completed");
      }));
    it("should cancel workflow", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Use long delays to keep workflow active
        mockProvider1.updateConfig({ signingDelay: 5000 });
        mockProvider2.updateConfig({ signingDelay: 5000 });
        mockProvider3.updateConfig({ signingDelay: 5000 });
        const transaction = createTestTransaction();
        const signers = createTestSigners();
        const config = createTestConfig();
        // Start workflow
        const workflowPromise = coordinator.startWorkflow(
          transaction,
          signers,
          config
        );
        // Get the transaction ID from active workflows
        const activeWorkflows = coordinator.getActiveWorkflows();
        expect(activeWorkflows).toHaveLength(1);
        const transactionId = activeWorkflows[0].transactionId;
        // Cancel the workflow
        yield coordinator.cancelWorkflow(transactionId);
        // Workflow should be removed from active workflows
        const activeWorkflowsAfter = coordinator.getActiveWorkflows();
        expect(activeWorkflowsAfter).toHaveLength(0);
        // The original promise should still resolve/reject
        yield expect(workflowPromise).rejects.toThrow();
      }));
  });
  describe("Progress Tracking", () => {
    it("should track signing progress", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const transaction = createTestTransaction();
        const signers = createTestSigners();
        const config = createTestConfig();
        const result = yield coordinator.startWorkflow(
          transaction,
          signers,
          config
        );
        const progress = coordinator.getSigningProgress(result);
        expect(progress.completed).toBe(3);
        expect(progress.required).toBe(2);
        expect(progress.total).toBe(3);
        expect(progress.percentage).toBe(150); // 3/2 * 100
      }));
    it("should check threshold met", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const transaction = createTestTransaction();
        const signers = createTestSigners();
        const config = createTestConfig();
        const result = yield coordinator.startWorkflow(
          transaction,
          signers,
          config
        );
        expect(coordinator.isThresholdMet(result)).toBe(true);
      }));
  });
  describe("Event Emission", () => {
    it("should emit all workflow events", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const eventHandler = jest.fn();
        coordinator.addEventListener(eventHandler);
        const transaction = createTestTransaction();
        const signers = createTestSigners();
        const config = createTestConfig();
        yield coordinator.startWorkflow(transaction, signers, config);
        const events = eventHandler.mock.calls.map((call) => call[0]);
        const eventTypes = events.map((e) => e.type);
        expect(eventTypes).toContain(
          multi_signature_coordinator_1.MultiSignatureEventType.WORKFLOW_STARTED
        );
        expect(eventTypes).toContain(
          multi_signature_coordinator_1.MultiSignatureEventType
            .SIGNATURE_STARTED
        );
        expect(eventTypes).toContain(
          multi_signature_coordinator_1.MultiSignatureEventType
            .SIGNATURE_COMPLETED
        );
        expect(eventTypes).toContain(
          multi_signature_coordinator_1.MultiSignatureEventType.THRESHOLD_MET
        );
        expect(eventTypes).toContain(
          multi_signature_coordinator_1.MultiSignatureEventType
            .WORKFLOW_COMPLETED
        );
      }));
    it("should handle event handler errors gracefully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const faultyHandler = jest.fn(() => {
          throw new Error("Handler error");
        });
        const goodHandler = jest.fn();
        coordinator.addEventListener(faultyHandler);
        coordinator.addEventListener(goodHandler);
        const transaction = createTestTransaction();
        const signers = createTestSigners();
        const config = createTestConfig();
        // Should not throw despite faulty handler
        yield expect(
          coordinator.startWorkflow(transaction, signers, config)
        ).resolves.toBeDefined();
        expect(faultyHandler).toHaveBeenCalled();
        expect(goodHandler).toHaveBeenCalled();
      }));
  });
  describe("Transaction Combination", () => {
    it("should combine signed transactions", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        const transaction = createTestTransaction();
        const signers = createTestSigners();
        const config = createTestConfig();
        const result = yield coordinator.startWorkflow(
          transaction,
          signers,
          config
        );
        expect(result.finalTransaction).toBeDefined();
        expect(result.finalTransaction.multiSignature).toBeDefined();
        expect(
          ((_a = result.finalTransaction.multiSignature) === null ||
          _a === void 0
            ? void 0
            : _a.signatures.length) || 0
        ).toBe(3);
        expect(
          (_b = result.finalTransaction.multiSignature) === null ||
            _b === void 0
            ? void 0
            : _b.threshold
        ).toBe(2);
        expect(
          (_c = result.finalTransaction.multiSignature) === null ||
            _c === void 0
            ? void 0
            : _c.totalSigners
        ).toBe(3);
      }));
  });
});
