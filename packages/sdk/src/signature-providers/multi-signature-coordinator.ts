import { SignatureProvider } from "./interfaces";
import { SignatureRequest, ChainTransaction } from "./types";
import {
  SignatureProviderError,
  SigningError,
  InvalidTransactionError,
  ConnectionError,
  UserRejectedError,
} from "./errors";

/**
 * Configuration for multi-signature operations
 */
export interface MultiSignatureConfig {
  // Signature requirements
  requiredSignatures: number;
  totalSigners: number;

  // Timeout settings
  signatureTimeout?: number; // Timeout for individual signatures
  totalTimeout?: number; // Total timeout for all signatures

  // Coordination settings
  allowPartialSigning?: boolean;
  requireSequentialSigning?: boolean;

  // Error handling
  maxRetries?: number;
  continueOnError?: boolean;

  // Metadata
  description?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Information about a signer in a multi-signature workflow
 */
export interface SignerInfo {
  providerId: string;
  accountAddress: string;
  publicKey?: string;
  required: boolean;
  weight?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Status of a signature in the multi-signature workflow
 */
export enum SignatureStatus {
  PENDING = "pending",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  FAILED = "failed",
  REJECTED = "rejected",
  TIMEOUT = "timeout",
}

/**
 * Individual signature result in multi-signature workflow
 */
export interface MultiSignatureResult {
  signerInfo: SignerInfo;
  status: SignatureStatus;
  signature?: string;
  signedTransaction?: unknown;
  error?: SignatureProviderError;
  timestamp: Date;
  duration?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Complete multi-signature workflow result
 */
export interface MultiSignatureWorkflowResult {
  transactionId: string;
  config: MultiSignatureConfig;
  signatures: MultiSignatureResult[];
  finalTransaction?: unknown;
  status: "completed" | "partial" | "failed";
  requiredMet: boolean;
  totalDuration: number;
  startTime: Date;
  endTime: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Event types for multi-signature workflow
 */
export enum MultiSignatureEventType {
  WORKFLOW_STARTED = "workflow_started",
  SIGNATURE_STARTED = "signature_started",
  SIGNATURE_COMPLETED = "signature_completed",
  SIGNATURE_FAILED = "signature_failed",
  SIGNATURE_REJECTED = "signature_rejected",
  THRESHOLD_MET = "threshold_met",
  WORKFLOW_COMPLETED = "workflow_completed",
  WORKFLOW_FAILED = "workflow_failed",
  WORKFLOW_TIMEOUT = "workflow_timeout",
}

/**
 * Event data for multi-signature workflow events
 */
export interface MultiSignatureEvent {
  type: MultiSignatureEventType;
  transactionId: string;
  signerInfo?: SignerInfo;
  signature?: MultiSignatureResult;
  workflow?: MultiSignatureWorkflowResult;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Event handler for multi-signature workflow events
 */
export type MultiSignatureEventHandler = (event: MultiSignatureEvent) => void;

/**
 * Multi-signature coordinator for managing complex signing workflows
 */
export class MultiSignatureCoordinator {
  private providers: Map<string, SignatureProvider> = new Map();
  private activeWorkflows: Map<string, MultiSignatureWorkflowResult> =
    new Map();
  private eventHandlers: MultiSignatureEventHandler[] = [];
  private workflowCounter = 0;

  /**
   * Register a signature provider for use in multi-signature workflows
   */
  registerProvider(provider: SignatureProvider): void {
    this.providers.set(provider.providerId, provider);
  }

  /**
   * Unregister a signature provider
   */
  unregisterProvider(providerId: string): void {
    this.providers.delete(providerId);
  }

  /**
   * Get a registered provider
   */
  getProvider(providerId: string): SignatureProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * List all registered providers
   */
  listProviders(): SignatureProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Add event handler for workflow events
   */
  addEventListener(handler: MultiSignatureEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Remove event handler
   */
  removeEventListener(handler: MultiSignatureEventHandler): void {
    const index = this.eventHandlers.indexOf(handler);
    if (index > -1) {
      this.eventHandlers.splice(index, 1);
    }
  }

  /**
   * Start a multi-signature workflow
   */
  async startWorkflow(
    transactionData: ChainTransaction,
    signers: SignerInfo[],
    config: MultiSignatureConfig
  ): Promise<MultiSignatureWorkflowResult> {
    const transactionId = this.generateTransactionId();
    const startTime = new Date();

    // Validate configuration
    this.validateWorkflowConfig(config, signers);

    // Validate transaction
    this.validateTransaction(transactionData);

    // Initialize workflow result
    const workflowResult: MultiSignatureWorkflowResult = {
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
        await this.executeSequentialSigning(transactionData, workflowResult);
      } else {
        await this.executeParallelSigning(transactionData, workflowResult);
      }

      // Finalize workflow
      await this.finalizeWorkflow(workflowResult);
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
  }

  /**
   * Get status of an active workflow
   */
  getWorkflowStatus(
    transactionId: string
  ): MultiSignatureWorkflowResult | undefined {
    return this.activeWorkflows.get(transactionId);
  }

  /**
   * Cancel an active workflow
   */
  async cancelWorkflow(transactionId: string): Promise<void> {
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
  }

  /**
   * List all active workflows
   */
  getActiveWorkflows(): MultiSignatureWorkflowResult[] {
    return Array.from(this.activeWorkflows.values());
  }

  /**
   * Check if a workflow meets the signature threshold
   */
  isThresholdMet(workflow: MultiSignatureWorkflowResult): boolean {
    const completedSignatures = workflow.signatures.filter(
      (sig) => sig.status === SignatureStatus.COMPLETED
    ).length;

    return completedSignatures >= workflow.config.requiredSignatures;
  }

  /**
   * Get signing progress for a workflow
   */
  getSigningProgress(workflow: MultiSignatureWorkflowResult): {
    completed: number;
    required: number;
    total: number;
    percentage: number;
  } {
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

  private validateWorkflowConfig(
    config: MultiSignatureConfig,
    signers: SignerInfo[]
  ): void {
    if (config.requiredSignatures <= 0) {
      throw new InvalidTransactionError(
        "Required signatures must be greater than 0"
      );
    }

    if (config.requiredSignatures > config.totalSigners) {
      throw new InvalidTransactionError(
        "Required signatures cannot exceed total signers"
      );
    }

    if (signers.length !== config.totalSigners) {
      throw new InvalidTransactionError(
        "Number of signers must match total signers in config"
      );
    }

    const requiredSigners = signers.filter((s) => s.required).length;
    if (requiredSigners > config.requiredSignatures) {
      throw new InvalidTransactionError(
        "Number of required signers cannot exceed required signatures"
      );
    }

    // Validate that all providers are registered
    for (const signer of signers) {
      if (!this.providers.has(signer.providerId)) {
        throw new ConnectionError(
          `Provider ${signer.providerId} not registered`
        );
      }
    }
  }

  private validateTransaction(transactionData: ChainTransaction): void {
    if (
      !transactionData ||
      !transactionData.chainId ||
      !transactionData.transaction
    ) {
      throw new InvalidTransactionError("Invalid transaction data");
    }

    // Chain-specific validation could be added here
  }

  private async executeSequentialSigning(
    transactionData: ChainTransaction,
    workflow: MultiSignatureWorkflowResult
  ): Promise<void> {
    for (let i = 0; i < workflow.signatures.length; i++) {
      const signatureResult = workflow.signatures[i];

      if (
        this.isThresholdMet(workflow) &&
        !workflow.config.allowPartialSigning
      ) {
        break;
      }

      await this.executeSignature(transactionData, signatureResult, workflow);

      if (
        signatureResult.status === SignatureStatus.FAILED &&
        !workflow.config.continueOnError
      ) {
        throw new SigningError(`Sequential signing failed at signer ${i + 1}`);
      }
    }
  }

  private async executeParallelSigning(
    transactionData: ChainTransaction,
    workflow: MultiSignatureWorkflowResult
  ): Promise<void> {
    const signingPromises = workflow.signatures.map((signatureResult) =>
      this.executeSignature(transactionData, signatureResult, workflow)
    );

    // Wait for all signatures or until threshold is met
    if (workflow.config.allowPartialSigning) {
      await Promise.allSettled(signingPromises);
    } else {
      await Promise.all(signingPromises);
    }
  }

  private async executeSignature(
    transactionData: ChainTransaction,
    signatureResult: MultiSignatureResult,
    workflow: MultiSignatureWorkflowResult
  ): Promise<void> {
    const { signerInfo } = signatureResult;
    const provider = this.providers.get(signerInfo.providerId);

    if (!provider) {
      signatureResult.status = SignatureStatus.FAILED;
      signatureResult.error = new ConnectionError(
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
      const request: SignatureRequest = {
        transactionData,
        accountAddress: signerInfo.accountAddress,
        metadata: {
          multiSignature: true,
          transactionId: workflow.transactionId,
          signerIndex: workflow.signatures.indexOf(signatureResult),
          ...workflow.config.metadata,
          ...signerInfo.metadata,
        },
      };

      // Execute signature with timeout
      const result = await this.executeWithTimeout(
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

      if (error instanceof UserRejectedError) {
        signatureResult.status = SignatureStatus.REJECTED;
        this.emitEvent({
          type: MultiSignatureEventType.SIGNATURE_REJECTED,
          transactionId: workflow.transactionId,
          signerInfo,
          signature: signatureResult,
          timestamp: new Date(),
        });
      } else if (error instanceof Error && error.message.includes("timeout")) {
        signatureResult.status = SignatureStatus.TIMEOUT;
      } else {
        signatureResult.status = SignatureStatus.FAILED;
      }

      signatureResult.error =
        error instanceof SignatureProviderError
          ? error
          : new SigningError(
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
  }

  private async finalizeWorkflow(
    workflow: MultiSignatureWorkflowResult
  ): Promise<void> {
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
        throw new SigningError(
          `Multi-signature workflow failed: insufficient signatures (${this.getSigningProgress(workflow).completed}/${workflow.config.requiredSignatures})`
        );
      }
    }
  }

  private combineSignedTransactions(
    workflow: MultiSignatureWorkflowResult
  ): unknown {
    const completedSignatures = workflow.signatures.filter(
      (sig) => sig.status === SignatureStatus.COMPLETED
    );

    if (completedSignatures.length === 0) {
      return null;
    }

    // For now, return the first signed transaction
    // In a real implementation, this would properly combine signatures
    const firstSigned = completedSignatures[0].signedTransaction;
    const baseObj =
      typeof firstSigned === "object" && firstSigned !== null
        ? (firstSigned as Record<string, unknown>)
        : { raw: firstSigned };

    return {
      ...baseObj,
      multiSignature: {
        signatures: completedSignatures.map((sig) => ({
          signature: sig.signature,
          publicKey: sig.signerInfo.publicKey,
          providerId: sig.signerInfo.providerId,
        })),
        threshold: workflow.config.requiredSignatures,
        totalSigners: workflow.config.totalSigners,
      },
    };
  }

  private async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
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
  }

  private generateTransactionId(): string {
    return `multisig_${Date.now()}_${++this.workflowCounter}`;
  }

  private emitEvent(event: MultiSignatureEvent): void {
    this.eventHandlers.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        console.error("Error in multi-signature event handler:", error);
      }
    });
  }
}
