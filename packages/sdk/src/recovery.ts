import {
  RecoveryContext,
  RecoveryEngineOptions,
  RecoveryResult,
  RecoveryAction,
  RetryHandler,
  RefundHandler,
  FailureType,
  RetryGuidance,
  RecoveryInstructions,
  FailureAnalysis,
} from "./types";
import type { AbortSignalLike } from "./types";
import { abortableSleep, isAbortError } from "./abort";
import {
  SignatureProviderErrorRecovery,
  signatureProviderErrorRecovery,
  ErrorRecoveryContext,
  ErrorRecoveryResult,
} from "./signature-providers";

/**
 * Engine responsible for handling recovery and cleanup of cross-chain operations.
 * It manages retrying steps or refunding locked assets upon failures.
 */
export class RecoveryEngine {
  private maxRetries: number;
  private retryDelayMs: number;
  private retryHandler?: RetryHandler;
  private refundHandler?: RefundHandler;
  private errorRecovery: SignatureProviderErrorRecovery;
  private defaultSignal?: AbortSignalLike;

  constructor(options?: RecoveryEngineOptions) {
    this.maxRetries = options?.maxRetries ?? 3;
    this.retryDelayMs = options?.retryDelayMs ?? 2000;
    this.retryHandler = options?.retryHandler;
    this.refundHandler = options?.refundHandler;
    this.errorRecovery = signatureProviderErrorRecovery;
    this.defaultSignal = options?.signal;
  }

  /**
   * Analyzes a failure and provides structured guidance
   */
  analyzeFailure(error: unknown, context?: ErrorRecoveryContext): FailureAnalysis {
    const isRecoverable = this.errorRecovery.canRecover(error);
    const recoveryInstructions = this.errorRecovery.getRecoveryInstructions(error);
    
    let type = FailureType.UNKNOWN;
    let userActions = recoveryInstructions;
    let operatorActions: string[] | undefined;
    let nextSteps: string[] = [];

    // Classify failure type
    const providerError = this.errorRecovery["strategies"].find(s => s.canRecover(error as any)) 
      ? error 
      : (error as Error);

    if (providerError instanceof Error) {
      const errMsg = providerError.message.toLowerCase();
      if (errMsg.includes("connection") || errMsg.includes("timeout")) {
        type = FailureType.CONNECTION;
      } else if (errMsg.includes("auth") || errMsg.includes("reject") || errMsg.includes("unauthorized")) {
        type = FailureType.AUTHENTICATION;
      } else if (errMsg.includes("hardware") || errMsg.includes("device")) {
        type = FailureType.HARDWARE_WALLET;
      } else if (errMsg.includes("network")) {
        type = FailureType.NETWORK;
      } else if (errMsg.includes("transaction") || errMsg.includes("signing")) {
        type = FailureType.TRANSACTION;
      }
    }

    // Build recovery instructions
    if (!isRecoverable) {
      operatorActions = ["Review transaction details", "Check system logs", "Verify network status"];
      nextSteps = ["Contact support", "Wait for system status update"];
    } else {
      nextSteps = ["Follow user actions below", "Retry operation if applicable"];
    }

    return {
      type,
      isRecoverable,
      requiresManualIntervention: !isRecoverable,
      recoveryInstructions: {
        userActions,
        operatorActions,
        nextSteps
      },
      metadata: {
        originalError: error
      }
    };
  }

  /**
   * Gets retry guidance for a failure
   */
  getRetryGuidance(error: unknown, currentAttempt: number = 0): RetryGuidance {
    const analysis = this.analyzeFailure(error);
    const retryGuidance: RetryGuidance = {
      shouldRetry: analysis.isRecoverable,
      maxRetries: this.maxRetries,
      currentAttempt,
      backoffStrategy: "exponential_with_jitter"
    };

    if (analysis.isRecoverable) {
      // Calculate retry delay
      const baseDelay = this.retryDelayMs;
      const jitter = Math.random() * 500;
      retryGuidance.retryAfterMs = Math.min(
        baseDelay * Math.pow(2, currentAttempt) + jitter,
        30000
      );
    }

    return retryGuidance;
  }

  /**
   * Attempts to recover from a signature provider error
   */
  async recoverFromError(error: unknown, context?: ErrorRecoveryContext): Promise<ErrorRecoveryResult> {
    return this.errorRecovery.recover(error, context);
  }

  /**
   * Attempts to clean up a failed operation by either retrying the mint
   * or refunding the locked assets based on configured handlers.
   *
   * @param context - The context of the failed operation.
   * @param signal - Optional signal to cancel the cleanup. Retry backoff
   *                 delays are interrupted and the pending abort rejects.
   * @returns A promise resolving to the result of the recovery attempt.
   */
  async cleanup(
    context: RecoveryContext,
    signal?: AbortSignalLike
  ): Promise<RecoveryResult> {
    // 1) Attempt retries of the mint step if a retry handler is provided
    if (this.retryHandler?.retryMint) {
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          const res = await this.retryHandler.retryMint(context);
          if (res && res.success) {
            return {
              actionTaken: RecoveryAction.RETRY_MINT,
              success: true,
              message: `Mint retry succeeded on attempt ${attempt}`,
              details: res.details || {},
            } as RecoveryResult;
          }
          // if handler returned failure, wait and retry
        } catch (error: unknown) {
          // Cancellation must propagate unmasked, not be swallowed.
          if (isAbortError(error)) {
            throw error;
          }
          // Otherwise swallow and retry
        }
        if (attempt < this.maxRetries) {
          await abortableSleep(this.retryDelayMs, signal ?? this.defaultSignal);
        }
      }
    }

    // 2) If retries exhausted or not configured, attempt refund of the lock
    if (this.refundHandler?.refundLock) {
      try {
        const refundRes = await this.refundHandler.refundLock(context);
        if (refundRes && refundRes.success) {
          return {
            actionTaken: RecoveryAction.REFUND_LOCK,
            success: true,
            message: `Refund executed`,
            details: refundRes.details || {},
          } as RecoveryResult;
        }
        return {
          actionTaken: RecoveryAction.MANUAL_INTERVENTION,
          success: false,
          message: `Refund handler executed but reported failure: ${refundRes?.message || "unknown"}`,
          details: refundRes?.details || {},
        } as RecoveryResult;
      } catch (error: unknown) {
        const msg = String(error);
        return {
          actionTaken: RecoveryAction.MANUAL_INTERVENTION,
          success: false,
          message: `Refund handler threw an error: ${msg}`,
        } as RecoveryResult;
      }
    }

    // 3) No handlers available — signal manual intervention required
    return {
      actionTaken: RecoveryAction.MANUAL_INTERVENTION,
      success: false,
      message:
        "No retry or refund handlers configured; manual intervention required.",
    } as RecoveryResult;
  }
}

// Global recovery manager instance
export const recoveryManager = new RecoveryEngine();

/**
 * Factory function to create a new RecoveryEngine instance.
 *
 * @param options - Configuration options for the engine.
 * @returns A new RecoveryEngine instance.
 */
export function createRecoveryEngine(options?: RecoveryEngineOptions) {
  return new RecoveryEngine(options);
}
