/**
 * Model Fallback Orchestrator
 * 
 * Orchestrates model selection, fallback decisions, and retry logic.
 * Tracks all fallback decisions with reasons for audit and debugging.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  modelRegistry,
  ModelSelectionResult,
  SelectionStrategy,
} from "./ModelRegistry";
import {
  ModelCapability,
  CapabilityRequirement,
  OutputFormat,
  PlanVersion,
} from "./ModelCapability";
import { outputValidator, ValidationResult } from "./OutputValidator";
import logger from "../../config/logger";

/**
 * LLM call context
 */
export interface LLMCallContext {
  /** Unique identifier for this call (for tracing) */
  callId: string;
  /** Agent making the call */
  agentId: string;
  /** User making the request */
  userId?: string;
  /** User input being processed */
  userInput?: string;
  /** Capability requirements for this call */
  requirements?: CapabilityRequirement;
  /** Preferred model (if any) */
  preferredModelId?: string;
  /** Selection strategy */
  strategy?: SelectionStrategy;
  /** Fallback chain name (if using a chain) */
  fallbackChainName?: string;
  /** Maximum number of retry attempts */
  maxRetries?: number;
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * LLM call result
 */
export interface LLMCallResult {
  /** The actual response content */
  content: unknown;
  /** Model that generated the response */
  modelId: string;
  /** Whether a fallback model was used */
  usedFallback: boolean;
  /** Validation result */
  validation: ValidationResult;
  /** Token usage */
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  /** Decision log */
  decisionLog: FallbackDecision[];
}

/**
 * Fallback decision record
 */
export interface FallbackDecision {
  /** When this decision was made */
  timestamp: Date;
  /** Type of decision */
  type:
    | "primary_selected"
    | "fallback_triggered"
    | "retry_attempted"
    | "validation_failed"
    | "model_unavailable"
    | "timeout"
    | "api_error";
  /** Model involved in this decision */
  modelId: string;
  /** Whether the decision was successful */
  success: boolean;
  /** Reason for the decision */
  reason: string;
  /** Additional context */
  metadata?: Record<string, unknown>;
}

/**
 * Retry strategy
 */
export interface RetryStrategy {
  /** Maximum number of retries */
  maxRetries: number;
  /** Base delay between retries (ms) */
  baseDelayMs: number;
  /** Whether to use exponential backoff */
  exponentialBackoff: boolean;
  /** Whether to try different models on retry */
  tryDifferentModels: boolean;
}

/**
 * Default retry strategy
 */
const DEFAULT_RETRY_STRATEGY: RetryStrategy = {
  maxRetries: 2,
  baseDelayMs: 1000,
  exponentialBackoff: true,
  tryDifferentModels: true,
};

/**
 * Model fallback orchestrator
 */
export class ModelFallbackOrchestrator {
  private client: Anthropic;
  private retryStrategy: RetryStrategy;
  
  // Metrics
  private totalCalls = 0;
  private fallbackCount = 0;
  private validationFailures = 0;
  private successfulCalls = 0;

  constructor(
    client: Anthropic,
    retryStrategy: RetryStrategy = DEFAULT_RETRY_STRATEGY
  ) {
    this.client = client;
    this.retryStrategy = retryStrategy;
  }

  /**
   * Execute an LLM call with automatic fallback and validation
   */
  async executeCall(
    context: LLMCallContext,
    prompt: string,
    options: {
      asJson?: boolean;
      maxTokens?: number;
      temperature?: number;
    } = {}
  ): Promise<LLMCallResult> {
    this.totalCalls++;
    const decisionLog: FallbackDecision[] = [];
    const startTime = Date.now();

    logger.info("Starting LLM call with fallback orchestration", {
      callId: context.callId,
      agentId: context.agentId,
      preferredModel: context.preferredModelId,
      strategy: context.strategy,
      fallbackChain: context.fallbackChainName,
    });

    try {
      // Select initial model
      const selection = this.selectModel(context);
      if (!selection) {
        throw new Error("No compatible model available for requirements");
      }

      decisionLog.push({
        timestamp: new Date(),
        type: "primary_selected",
        modelId: selection.model.modelId,
        success: true,
        reason: selection.reason,
        metadata: {
          isFallback: selection.isFallback,
          rejected: selection.rejected,
        },
      });

      // Attempt call with retries
      const result = await this.callWithRetries(
        selection.model,
        prompt,
        options,
        context,
        decisionLog
      );

      this.successfulCalls++;
      
      if (selection.isFallback) {
        this.fallbackCount++;
      }

      const duration = Date.now() - startTime;
      logger.info("LLM call completed successfully", {
        callId: context.callId,
        modelId: result.modelId,
        usedFallback: result.usedFallback,
        validationScore: result.validation.qualityScore,
        durationMs: duration,
        decisions: decisionLog.length,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error("LLM call failed after all retries", {
        callId: context.callId,
        error: error instanceof Error ? error.message : "Unknown error",
        durationMs: duration,
        decisions: decisionLog.length,
      });
      throw error;
    }
  }

  /**
   * Call LLM with retry logic
   */
  private async callWithRetries(
    initialModel: ModelCapability,
    prompt: string,
    options: {
      asJson?: boolean;
      maxTokens?: number;
      temperature?: number;
    },
    context: LLMCallContext,
    decisionLog: FallbackDecision[]
  ): Promise<LLMCallResult> {
    let currentModel = initialModel;
    let lastError: Error | null = null;
    const triedModels = new Set<string>([initialModel.modelId]);

    for (let attempt = 0; attempt <= this.retryStrategy.maxRetries; attempt++) {
      try {
        logger.debug(`Attempting LLM call (attempt ${attempt + 1})`, {
          callId: context.callId,
          modelId: currentModel.modelId,
        });

        const result = await this.callModel(
          currentModel,
          prompt,
          options,
          context
        );

        // Validate output
        const validation = this.validateOutput(
          result.content,
          options.asJson ?? true,
          context
        );

        if (!validation.valid) {
          this.validationFailures++;
          
          decisionLog.push({
            timestamp: new Date(),
            type: "validation_failed",
            modelId: currentModel.modelId,
            success: false,
            reason: `Validation failed: ${validation.errors.map(e => e.message).join(", ")}`,
            metadata: {
              qualityScore: validation.qualityScore,
              errorCount: validation.errors.length,
              warningCount: validation.warnings.length,
            },
          });

          // If validation fails and we have retries left, try a different model
          if (
            attempt < this.retryStrategy.maxRetries &&
            this.retryStrategy.tryDifferentModels
          ) {
            const nextModel = this.selectAlternativeModel(
              context,
              triedModels,
              "validation_failed"
            );

            if (nextModel) {
              logger.warn("Validation failed, trying alternative model", {
                callId: context.callId,
                failedModel: currentModel.modelId,
                nextModel: nextModel.modelId,
                validationScore: validation.qualityScore,
              });

              currentModel = nextModel;
              triedModels.add(nextModel.modelId);

              decisionLog.push({
                timestamp: new Date(),
                type: "fallback_triggered",
                modelId: nextModel.modelId,
                success: true,
                reason: "Previous model failed validation, trying alternative",
              });

              await this.delay(this.getRetryDelay(attempt));
              continue;
            }
          }

          // If we can't retry or no alternative model, return with validation warnings
          logger.warn("Validation failed but no alternative available", {
            callId: context.callId,
            modelId: currentModel.modelId,
            qualityScore: validation.qualityScore,
          });
        }

        return {
          content: result.content,
          modelId: currentModel.modelId,
          usedFallback: currentModel.modelId !== context.preferredModelId,
          validation,
          usage: result.usage,
          decisionLog,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        const isTimeout = error instanceof Error && error.message.includes("timeout");
        const isApiError = error instanceof Error && (
          error.message.includes("rate limit") ||
          error.message.includes("overloaded") ||
          error.message.includes("unavailable")
        );

        decisionLog.push({
          timestamp: new Date(),
          type: isTimeout ? "timeout" : isApiError ? "api_error" : "model_unavailable",
          modelId: currentModel.modelId,
          success: false,
          reason: lastError.message,
        });

        logger.warn("LLM call attempt failed", {
          callId: context.callId,
          attempt: attempt + 1,
          modelId: currentModel.modelId,
          error: lastError.message,
          isTimeout,
          isApiError,
        });

        // Try alternative model if available and retries left
        if (
          attempt < this.retryStrategy.maxRetries &&
          this.retryStrategy.tryDifferentModels
        ) {
          const nextModel = this.selectAlternativeModel(
            context,
            triedModels,
            isTimeout ? "timeout" : isApiError ? "api_error" : "error"
          );

          if (nextModel) {
            logger.info("Falling back to alternative model", {
              callId: context.callId,
              failedModel: currentModel.modelId,
              nextModel: nextModel.modelId,
              reason: lastError.message,
            });

            currentModel = nextModel;
            triedModels.add(nextModel.modelId);

            decisionLog.push({
              timestamp: new Date(),
              type: "fallback_triggered",
              modelId: nextModel.modelId,
              success: true,
              reason: `Fallback due to ${isTimeout ? "timeout" : "error"} in previous model`,
            });

            await this.delay(this.getRetryDelay(attempt));
            continue;
          }
        }

        // If last retry or no alternative, fail
        if (attempt === this.retryStrategy.maxRetries) {
          throw new Error(
            `LLM call failed after ${attempt + 1} attempts: ${lastError.message}`
          );
        }

        // Retry with same model after delay
        decisionLog.push({
          timestamp: new Date(),
          type: "retry_attempted",
          modelId: currentModel.modelId,
          success: true,
          reason: `Retrying after ${this.getRetryDelay(attempt)}ms delay`,
        });

        await this.delay(this.getRetryDelay(attempt));
      }
    }

    throw lastError || new Error("LLM call failed with no error details");
  }

  /**
   * Call a specific model
   */
  private async callModel(
    model: ModelCapability,
    prompt: string,
    options: {
      asJson?: boolean;
      maxTokens?: number;
      temperature?: number;
    },
    context: LLMCallContext
  ): Promise<{
    content: unknown;
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  }> {
    const timeout = context.timeoutMs || 30000;
    const maxTokens = options.maxTokens || 4096;
    const temperature = options.temperature ?? 1.0;

    const fullPrompt = options.asJson
      ? `${prompt}\n\nPlease respond with valid JSON only.`
      : prompt;

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const message = await this.client.messages.create(
        {
          model: model.modelId,
          max_tokens: maxTokens,
          temperature,
          messages: [
            {
              role: "user",
              content: fullPrompt,
            },
          ],
        },
        {
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      const content =
        message.content[0].type === "text" ? message.content[0].text : "{}";

      let parsedContent: unknown = content;
      if (options.asJson) {
        try {
          parsedContent = JSON.parse(content);
        } catch {
          logger.warn("Failed to parse JSON response", {
            modelId: model.modelId,
            callId: context.callId,
          });
          parsedContent = {};
        }
      }

      return {
        content: parsedContent,
        usage: {
          inputTokens: message.usage?.input_tokens || 0,
          outputTokens: message.usage?.output_tokens || 0,
          totalTokens:
            (message.usage?.input_tokens || 0) +
            (message.usage?.output_tokens || 0),
        },
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`LLM call timeout after ${timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Select initial model based on context
   */
  private selectModel(context: LLMCallContext): ModelSelectionResult | null {
    // Use fallback chain if specified
    if (context.fallbackChainName) {
      return modelRegistry.selectWithFallbackChain(
        context.fallbackChainName,
        context.requirements || {}
      );
    }

    // Use direct selection
    return modelRegistry.selectModel(
      context.requirements || {},
      context.strategy || SelectionStrategy.QUALITY_FIRST,
      context.preferredModelId
    );
  }

  /**
   * Select an alternative model (for fallback)
   */
  private selectAlternativeModel(
    context: LLMCallContext,
    triedModels: Set<string>,
    reason: string
  ): ModelCapability | null {
    const compatible = modelRegistry.getCompatibleModels(
      context.requirements || {}
    );

    // Filter out already tried models
    const untried = compatible.filter(m => !triedModels.has(m.modelId));

    if (untried.length === 0) {
      logger.warn("No untried alternative models available", {
        callId: context.callId,
        triedModels: Array.from(triedModels),
        reason,
      });
      return null;
    }

    // Sort by strategy and pick the best
    const strategy = context.strategy || SelectionStrategy.QUALITY_FIRST;
    const sorted = modelRegistry["sortByStrategy"](untried, strategy);

    return sorted[0] || null;
  }

  /**
   * Validate LLM output
   */
  private validateOutput(
    output: unknown,
    expectJson: boolean,
    context: LLMCallContext
  ): ValidationResult {
    const expectedFormat = expectJson ? OutputFormat.JSON : OutputFormat.TEXT;
    const expectedPlanVersion = context.requirements?.minPlanVersion;

    return outputValidator.validate(output, expectedFormat, expectedPlanVersion, {
      userId: context.userId,
      userInput: context.userInput,
    });
  }

  /**
   * Get retry delay with exponential backoff
   */
  private getRetryDelay(attempt: number): number {
    if (!this.retryStrategy.exponentialBackoff) {
      return this.retryStrategy.baseDelayMs;
    }

    return this.retryStrategy.baseDelayMs * Math.pow(2, attempt);
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get orchestrator metrics
   */
  getMetrics(): {
    totalCalls: number;
    successfulCalls: number;
    fallbackCount: number;
    validationFailures: number;
    successRate: number;
    fallbackRate: number;
  } {
    return {
      totalCalls: this.totalCalls,
      successfulCalls: this.successfulCalls,
      fallbackCount: this.fallbackCount,
      validationFailures: this.validationFailures,
      successRate: this.totalCalls > 0 ? this.successfulCalls / this.totalCalls : 0,
      fallbackRate: this.totalCalls > 0 ? this.fallbackCount / this.totalCalls : 0,
    };
  }

  /**
   * Reset metrics (for testing)
   */
  resetMetrics(): void {
    this.totalCalls = 0;
    this.fallbackCount = 0;
    this.validationFailures = 0;
    this.successfulCalls = 0;
  }
}
