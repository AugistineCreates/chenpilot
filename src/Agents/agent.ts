import Anthropic from "@anthropic-ai/sdk";
import config from "../config/config";
import { memoryStore } from "./memory/memory";
import logger from "../config/logger";
import { withTimeout, TimeoutError } from "../utils/timeout";
import {
  LLMTokenUsage,
  recordLLMUsage,
} from "../observability/agentPlanMetrics";
import {
  ModelFallbackOrchestrator,
  LLMCallContext,
} from "./models/ModelFallbackOrchestrator";
import { CapabilityRequirement, PlanVersion } from "./models/ModelCapability";
import { modelRegistry, SelectionStrategy } from "./models/ModelRegistry";
import { v4 as uuidv4 } from "uuid";
import { AgentContextBuilder } from "./context/AgentContextBuilder";

export interface LLMCallOptions {
  asJson?: boolean;
  timeoutMs?: number;
  traceId?: string;
  userId?: string;
  requirements?: CapabilityRequirement;
}

export class AgentLLM {
  public client: Anthropic;
  private fallbackOrchestrator: ModelFallbackOrchestrator;

  constructor() {
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
    this.fallbackOrchestrator = new ModelFallbackOrchestrator(this.client, {
      maxRetries: config.models?.maxRetries ?? 3,
      baseDelayMs: 1000,
      exponentialBackoff: true,
      tryDifferentModels: true,
    });
  }

  /**
   * Calls the LLM using a typed AgentContextBuilder instance.
   * Guarantees strict trust zone separation between instructions and external data.
   */
  async callLLMWithContext(
    agentId: string,
    contextBuilder: AgentContextBuilder,
    options: LLMCallOptions = {}
  ): Promise<unknown> {
    const { asJson = true, timeoutMs, traceId } = options;
    const timeout = timeoutMs || config.agent.timeouts.llmCall;
    const actualTraceId = traceId || "";

    const promptText = contextBuilder.buildPrompt();
    const fullPrompt = `${promptText}${
      asJson ? "\n\nPlease respond with valid JSON only." : ""
    }`;

    logger.debug("Starting LLM call with typed context", {
      agentId,
      timeout,
      asJson,
      traceId: actualTraceId,
      trustSummary: contextBuilder.getTrustSummary(),
      useFallback: config.models?.verifyEquivalence,
    });

    return this.dispatchCall({
      agentId,
      fullPrompt,
      userInput: "",
      asJson,
      timeout,
      traceId: actualTraceId,
      options,
    });
  }

  /**
   * Standard callLLM method. Uses AgentContextBuilder under the hood
   * to guarantee typed trust zone separation and size bounding.
   */
  async callLLM(
    agentId: string,
    prompt: string,
    userInput: string,
    asJson = true,
    timeoutMs?: number | string,
    traceId?: string,
    options?: {
      userId?: string;
      requirements?: CapabilityRequirement;
    }
  ): Promise<unknown> {
    const actualTimeoutMs =
      typeof timeoutMs === "string" ? undefined : timeoutMs;
    const actualTraceId =
      typeof timeoutMs === "string" ? timeoutMs : traceId || "";

    const timeout = actualTimeoutMs || config.agent.timeouts.llmCall;

    // Construct typed context
    const contextBuilder = new AgentContextBuilder(prompt);

    const memoryHistory = memoryStore.get(agentId);
    if (memoryHistory && memoryHistory.length > 0) {
      contextBuilder.addMemoryHistory(memoryHistory);
    }

    if (userInput && typeof userInput === "string") {
      contextBuilder.addUserInput(userInput);
    }

    const fullPrompt = `${contextBuilder.buildPrompt()}${
      asJson ? "\n\nPlease respond with valid JSON only." : ""
    }`;

    logger.debug("Starting LLM call with fallback orchestration", {
      agentId,
      timeout,
      asJson,
      traceId: actualTraceId,
      useFallback: config.models?.verifyEquivalence,
    });

    return this.dispatchCall({
      agentId,
      fullPrompt,
      userInput: userInput || "",
      asJson,
      timeout,
      traceId: actualTraceId,
      options,
    });
  }

  private async dispatchCall(params: {
    agentId: string;
    fullPrompt: string;
    userInput: string;
    asJson: boolean;
    timeout: number;
    traceId: string;
    options?: {
      userId?: string;
      requirements?: CapabilityRequirement;
    };
  }): Promise<unknown> {
    const {
      agentId,
      fullPrompt,
      userInput,
      asJson,
      timeout,
      traceId,
      options,
    } = params;

    // Use fallback orchestrator if enabled and models are registered in registry
    const hasRegisteredModels = modelRegistry.getAllModels().length > 0;
    if (config.models?.verifyEquivalence && hasRegisteredModels) {
      const callContext: LLMCallContext = {
        callId: uuidv4(),
        agentId,
        userId: options?.userId,
        userInput,
        requirements: options?.requirements || {
          minPlanVersion: PlanVersion.V1_WORKFLOW,
          minQualityScore: config.models.minQualityScore,
        },
        preferredModelId: config.models.primary,
        strategy: config.models.selectionStrategy as SelectionStrategy,
        fallbackChainName: "default",
        maxRetries: config.models.maxRetries,
        timeoutMs: timeout,
      };

      try {
        const result = await this.fallbackOrchestrator.executeCall(
          callContext,
          fullPrompt,
          {
            asJson,
            maxTokens: 4096,
          }
        );

        // Record usage
        const usage: LLMTokenUsage = {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          provider: "anthropic",
          model: result.modelId,
        };
        recordLLMUsage(traceId || agentId, usage);

        // Log fallback decision
        if (result.usedFallback) {
          logger.warn("Used fallback model for LLM call", {
            agentId,
            primaryModel: config.models.primary,
            usedModel: result.modelId,
            validationScore: result.validation.qualityScore,
            decisionCount: result.decisionLog.length,
          });
        }

        // Log validation warnings
        if (!result.validation.valid) {
          logger.warn("LLM output validation failed", {
            agentId,
            modelId: result.modelId,
            errors: result.validation.errors.map((e) => e.message),
            qualityScore: result.validation.qualityScore,
          });
        }

        // Attach usage metadata
        if (result.content && typeof result.content === "object") {
          Object.defineProperty(result.content, "llmUsage", {
            value: usage,
            enumerable: false,
            configurable: true,
          });
        }

        return result.content;
      } catch (error) {
        logger.error("Fallback orchestration failed", {
          agentId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    return this.executeAnthropicCall(
      agentId,
      fullPrompt,
      asJson,
      timeout,
      traceId
    );
  }

  private async executeAnthropicCall(
    agentId: string,
    fullPrompt: string,
    asJson: boolean,
    timeout: number,
    traceId: string
  ): Promise<unknown> {
    try {
      const message = await withTimeout(
        this.client.messages.create({
          model: config.models?.primary || "claude-3-5-haiku-20241022",
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: fullPrompt,
            },
          ],
        }),
        {
          timeoutMs: timeout,
          operation: `LLM call for agent ${agentId}`,
          onTimeout: () => {
            logger.error("LLM call timeout", { agentId, timeout });
          },
        }
      );

      const usage: LLMTokenUsage = {
        inputTokens: message.usage?.input_tokens || 0,
        outputTokens: message.usage?.output_tokens || 0,
        totalTokens:
          (message.usage?.input_tokens || 0) +
          (message.usage?.output_tokens || 0),
        provider: "anthropic",
        model: config.models?.primary || "claude-3-5-haiku-20241022",
      };

      recordLLMUsage(traceId || agentId, usage);

      const content =
        message.content[0].type === "text" ? message.content[0].text : "{}";

      if (asJson) {
        try {
          const parsed = JSON.parse(content) as unknown;
          if (parsed && typeof parsed === "object") {
            Object.defineProperty(parsed, "llmUsage", {
              value: usage,
              enumerable: false,
              configurable: true,
            });
          }
          return parsed;
        } catch (err) {
          logger.error("JSON parse error", { error: err, rawContent: content });
          return {};
        }
      }

      return content;
    } catch (error) {
      if (error instanceof TimeoutError) {
        logger.error("LLM call timed out", {
          agentId,
          timeout,
          operation: error.operation,
        });
        throw new Error(`LLM call timed out after ${timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Get orchestrator metrics
   */
  getMetrics() {
    return this.fallbackOrchestrator.getMetrics();
  }
}

export const agentLLM = new AgentLLM();
