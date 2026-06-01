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
exports.MultiSignatureCoordinator =
  exports.MultiSignatureEventType =
  exports.SignatureStatus =
    void 0;
const errors_1 = require("./errors");
/**
 * Status of a signature in the multi-signature workflow
 */
var SignatureStatus;
(function (SignatureStatus) {
  SignatureStatus["PENDING"] = "pending";
  SignatureStatus["IN_PROGRESS"] = "in_progress";
  SignatureStatus["COMPLETED"] = "completed";
  SignatureStatus["FAILED"] = "failed";
  SignatureStatus["REJECTED"] = "rejected";
  SignatureStatus["TIMEOUT"] = "timeout";
})(SignatureStatus || (exports.SignatureStatus = SignatureStatus = {}));
/**
 * Event types for multi-signature workflow
 */
var MultiSignatureEventType;
(function (MultiSignatureEventType) {
  MultiSignatureEventType["WORKFLOW_STARTED"] = "workflow_started";
  MultiSignatureEventType["SIGNATURE_STARTED"] = "signature_started";
  MultiSignatureEventType["SIGNATURE_COMPLETED"] = "signature_completed";
  MultiSignatureEventType["SIGNATURE_FAILED"] = "signature_failed";
  MultiSignatureEventType["SIGNATURE_REJECTED"] = "signature_rejected";
  MultiSignatureEventType["THRESHOLD_MET"] = "threshold_met";
  MultiSignatureEventType["WORKFLOW_COMPLETED"] = "workflow_completed";
  MultiSignatureEventType["WORKFLOW_FAILED"] = "workflow_failed";
  MultiSignatureEventType["WORKFLOW_TIMEOUT"] = "workflow_timeout";
})(
  MultiSignatureEventType ||
    (exports.MultiSignatureEventType = MultiSignatureEventType = {})
);
/**
 * Multi-signature coordinator for managing complex signing workflows
 */
class MultiSignatureCoordinator {
  constructor() {
    this.providers = new Map();
    this.activeWorkflows = new Map();
    this.eventHandlers = [];
    this.workflowCounter = 0;
  }
  /**
   * Register a signature provider for use in multi-signature workflows
   */
  registerProvider(provider) {
    this.providers.set(provider.providerId, provider);
  }
  /**
   * Unregister a signature provider
   */
  unregisterProvider(providerId) {
    this.providers.delete(providerId);
  }
  /**
   * Get a registered provider
   */
  getProvider(providerId) {
    return this.providers.get(providerId);
  }
  /**
   * List all registered providers
   */
  listProviders() {
    return Array.from(this.providers.values());
  }
  /**
   * Add event handler for workflow events
   */
  addEventListener(handler) {
    this.eventHandlers.push(handler);
  }
  /**
   * Remove event handler
   */
  removeEventListener(handler) {
    const index = this.eventHandlers.indexOf(handler);
    if (index > -1) {
      this.eventHandlers.splice(index, 1);
    }
  }
  /**
   * Start a multi-signature workflow
   */
  startWorkflow(transactionData, signers, config) {
    return __awaiter(this, void 0, void 0, function* () {
      const transactionId = this.generateTransactionId();
      const startTime = new Date();
      // Validate configuration
      this.validateWorkflowConfig(config, signers);
      // Validate transaction
      this.validateTransaction(transactionData);
      // Initialize workflow result
      const workflowResult = {
        transactionId,
        config,
        signatures: signers.map((signer) => ({
          signerInfo: signer,
          status: SignatureStatus.PENDING,
          timestamp: new Date(),
        })),
        status: "partial",
        requiredMet: false,
        totalDuration: 0,
        startTime,
        endTime: startTime,
      };
      this.activeWorkflows.set(transactionId, workflowResult);
      // Emit workflow started event
      this.emitEvent({
        type: MultiSignatureEventType.WORKFLOW_STARTED,
        transactionId,
        workflow: workflowResult,
        timestamp: new Date(),
      });
      try {
        // Execute signing workflow
        if (config.requireSequentialSigning) {
          yield this.executeSequentialSigning(transactionData, workflowResult);
        } else {
          yield this.executeParallelSigning(transactionData, workflowResult);
        }
        // Finalize workflow
        yield this.finalizeWorkflow(workflowResult);
      } catch (error) {
        workflowResult.status = "failed";
        workflowResult.endTime = new Date();
        workflowResult.totalDuration =
          workflowResult.endTime.getTime() - workflowResult.startTime.getTime();
        this.emitEvent({
          type: MultiSignatureEventType.WORKFLOW_FAILED,
          transactionId,
          workflow: workflowResult,
          timestamp: new Date(),
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
        throw error;
      } finally {
        this.activeWorkflows.delete(transactionId);
      }
      return workflowResult;
    });
  }
  /**
   * Get status of an active workflow
   */
  getWorkflowStatus(transactionId) {
    return this.activeWorkflows.get(transactionId);
  }
  /**
   * Cancel an active workflow
   */
  cancelWorkflow(transactionId) {
    return __awaiter(this, void 0, void 0, function* () {
      const workflow = this.activeWorkflows.get(transactionId);
      if (!workflow) {
        throw new Error(`Workflow ${transactionId} not found`);
      }
      workflow.status = "failed";
      workflow.endTime = new Date();
      workflow.totalDuration =
        workflow.endTime.getTime() - workflow.startTime.getTime();
      this.emitEvent({
        type: MultiSignatureEventType.WORKFLOW_FAILED,
        transactionId,
        workflow,
        timestamp: new Date(),
        metadata: { reason: "cancelled" },
      });
      this.activeWorkflows.delete(transactionId);
    });
  }
  /**
   * List all active workflows
   */
  getActiveWorkflows() {
    return Array.from(this.activeWorkflows.values());
  }
  /**
   * Check if a workflow meets the signature threshold
   */
  isThresholdMet(workflow) {
    const completedSignatures = workflow.signatures.filter(
      (sig) => sig.status === SignatureStatus.COMPLETED
    ).length;
    return completedSignatures >= workflow.config.requiredSignatures;
  }
  /**
   * Get signing progress for a workflow
   */
  getSigningProgress(workflow) {
    const completed = workflow.signatures.filter(
      (sig) => sig.status === SignatureStatus.COMPLETED
    ).length;
    const required = workflow.config.requiredSignatures;
    const total = workflow.config.totalSigners;
    return {
      completed,
      required,
      total,
      percentage: (completed / required) * 100,
    };
  }
  validateWorkflowConfig(config, signers) {
    if (config.requiredSignatures <= 0) {
      throw new errors_1.InvalidTransactionError(
        "Required signatures must be greater than 0"
      );
    }
    if (config.requiredSignatures > config.totalSigners) {
      throw new errors_1.InvalidTransactionError(
        "Required signatures cannot exceed total signers"
      );
    }
    if (signers.length !== config.totalSigners) {
      throw new errors_1.InvalidTransactionError(
        "Number of signers must match total signers in config"
      );
    }
    const requiredSigners = signers.filter((s) => s.required).length;
    if (requiredSigners > config.requiredSignatures) {
      throw new errors_1.InvalidTransactionError(
        "Number of required signers cannot exceed required signatures"
      );
    }
    // Validate that all providers are registered
    for (const signer of signers) {
      if (!this.providers.has(signer.providerId)) {
        throw new errors_1.ConnectionError(
          `Provider ${signer.providerId} not registered`
        );
      }
    }
  }
  validateTransaction(transactionData) {
    if (
      !transactionData ||
      !transactionData.chainId ||
      !transactionData.transaction
    ) {
      throw new errors_1.InvalidTransactionError("Invalid transaction data");
    }
    // Chain-specific validation could be added here
  }
  executeSequentialSigning(transactionData, workflow) {
    return __awaiter(this, void 0, void 0, function* () {
      for (let i = 0; i < workflow.signatures.length; i++) {
        const signatureResult = workflow.signatures[i];
        if (
          this.isThresholdMet(workflow) &&
          !workflow.config.allowPartialSigning
        ) {
          break;
        }
        yield this.executeSignature(transactionData, signatureResult, workflow);
        if (
          signatureResult.status === SignatureStatus.FAILED &&
          !workflow.config.continueOnError
        ) {
          throw new errors_1.SigningError(
            `Sequential signing failed at signer ${i + 1}`
          );
        }
      }
    });
  }
  executeParallelSigning(transactionData, workflow) {
    return __awaiter(this, void 0, void 0, function* () {
      const signingPromises = workflow.signatures.map((signatureResult) =>
        this.executeSignature(transactionData, signatureResult, workflow)
      );
      // Wait for all signatures or until threshold is met
      if (workflow.config.allowPartialSigning) {
        yield Promise.allSettled(signingPromises);
      } else {
        yield Promise.all(signingPromises);
      }
    });
  }
  executeSignature(transactionData, signatureResult, workflow) {
    return __awaiter(this, void 0, void 0, function* () {
      const { signerInfo } = signatureResult;
      const provider = this.providers.get(signerInfo.providerId);
      if (!provider) {
        signatureResult.status = SignatureStatus.FAILED;
        signatureResult.error = new errors_1.ConnectionError(
          `Provider ${signerInfo.providerId} not found`
        );
        return;
      }
      signatureResult.status = SignatureStatus.IN_PROGRESS;
      signatureResult.timestamp = new Date();
      this.emitEvent({
        type: MultiSignatureEventType.SIGNATURE_STARTED,
        transactionId: workflow.transactionId,
        signerInfo,
        signature: signatureResult,
        timestamp: new Date(),
      });
      const startTime = Date.now();
      try {
        // Create signature request
        const request = {
          transactionData,
          accountAddress: signerInfo.accountAddress,
          metadata: Object.assign(
            Object.assign(
              {
                multiSignature: true,
                transactionId: workflow.transactionId,
                signerIndex: workflow.signatures.indexOf(signatureResult),
              },
              workflow.config.metadata
            ),
            signerInfo.metadata
          ),
        };
        // Execute signature with timeout
        const result = yield this.executeWithTimeout(
          provider.signTransaction(request),
          workflow.config.signatureTimeout || 30000
        );
        signatureResult.status = SignatureStatus.COMPLETED;
        signatureResult.signature = result.signature;
        signatureResult.signedTransaction = result.signedTransaction;
        signatureResult.duration = Date.now() - startTime;
        this.emitEvent({
          type: MultiSignatureEventType.SIGNATURE_COMPLETED,
          transactionId: workflow.transactionId,
          signerInfo,
          signature: signatureResult,
          timestamp: new Date(),
        });
        // Check if threshold is met
        if (this.isThresholdMet(workflow)) {
          this.emitEvent({
            type: MultiSignatureEventType.THRESHOLD_MET,
            transactionId: workflow.transactionId,
            workflow,
            timestamp: new Date(),
          });
        }
      } catch (error) {
        signatureResult.duration = Date.now() - startTime;
        if (error instanceof errors_1.UserRejectedError) {
          signatureResult.status = SignatureStatus.REJECTED;
          this.emitEvent({
            type: MultiSignatureEventType.SIGNATURE_REJECTED,
            transactionId: workflow.transactionId,
            signerInfo,
            signature: signatureResult,
            timestamp: new Date(),
          });
        } else if (
          error instanceof Error &&
          error.message.includes("timeout")
        ) {
          signatureResult.status = SignatureStatus.TIMEOUT;
        } else {
          signatureResult.status = SignatureStatus.FAILED;
        }
        signatureResult.error =
          error instanceof errors_1.SignatureProviderError
            ? error
            : new errors_1.SigningError(
                `Signature failed: ${error}`,
                signerInfo.providerId,
                transactionData.chainId
              );
        this.emitEvent({
          type: MultiSignatureEventType.SIGNATURE_FAILED,
          transactionId: workflow.transactionId,
          signerInfo,
          signature: signatureResult,
          timestamp: new Date(),
          metadata: { error: signatureResult.error.message },
        });
        if (signerInfo.required && !workflow.config.continueOnError) {
          throw signatureResult.error;
        }
      }
    });
  }
  finalizeWorkflow(workflow) {
    return __awaiter(this, void 0, void 0, function* () {
      workflow.endTime = new Date();
      workflow.totalDuration =
        workflow.endTime.getTime() - workflow.startTime.getTime();
      workflow.requiredMet = this.isThresholdMet(workflow);
      if (workflow.requiredMet) {
        workflow.status = "completed";
        workflow.finalTransaction = this.combineSignedTransactions(workflow);
        this.emitEvent({
          type: MultiSignatureEventType.WORKFLOW_COMPLETED,
          transactionId: workflow.transactionId,
          workflow,
          timestamp: new Date(),
        });
      } else {
        workflow.status = workflow.config.allowPartialSigning
          ? "partial"
          : "failed";
        if (workflow.status === "failed") {
          throw new errors_1.SigningError(
            `Multi-signature workflow failed: insufficient signatures (${this.getSigningProgress(workflow).completed}/${workflow.config.requiredSignatures})`
          );
        }
      }
    });
  }
  combineSignedTransactions(workflow) {
    const completedSignatures = workflow.signatures.filter(
      (sig) => sig.status === SignatureStatus.COMPLETED
    );
    if (completedSignatures.length === 0) {
      return null;
    }
    // For now, return the first signed transaction
    // In a real implementation, this would properly combine signatures
    // based on the specific blockchain's multi-signature format
    const firstSigned = completedSignatures[0].signedTransaction;
    return Object.assign(Object.assign({}, firstSigned), {
      multiSignature: {
        signatures: completedSignatures.map((sig) => ({
          signature: sig.signature,
          publicKey: sig.signerInfo.publicKey,
          providerId: sig.signerInfo.providerId,
        })),
        threshold: workflow.config.requiredSignatures,
        totalSigners: workflow.config.totalSigners,
      },
    });
  }
  executeWithTimeout(promise, timeoutMs) {
    return __awaiter(this, void 0, void 0, function* () {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Operation timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        promise
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
  generateTransactionId() {
    return `multisig_${Date.now()}_${++this.workflowCounter}`;
  }
  emitEvent(event) {
    this.eventHandlers.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        console.error("Error in multi-signature event handler:", error);
      }
    });
  }
}
exports.MultiSignatureCoordinator = MultiSignatureCoordinator;
