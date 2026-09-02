import Anthropic from "@anthropic-ai/sdk";
import config from "../config/config";
import { memoryStore } from "./memory/memory";
import logger from "../config/logger";
import {
  LLMTokenUsage,
  recordLLMUsage,
} from "../observability/agentPlanMetrics";
import { AgentContextBuilder } from "./context/AgentContextBuilder";

const client = new Anthropic({
  apiKey: config.apiKey,
});

export interface LLMCallOptions {
  asJson?: boolean;
  timeoutMs?: number;
  traceId?: string;
}

export class AgentLLM {
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
    });

    return this.executeAnthropicCall(
      agentId,
      fullPrompt,
      asJson,
      timeout,
      actualTraceId
    );
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
      useFallback: config.models.verifyEquivalence,
    });

    return this.executeAnthropicCall(
      agentId,
      fullPrompt,
      asJson,
      timeout,
      actualTraceId
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
        client.messages.create({
          model: "claude-3-5-haiku-20241022",
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
        model: "claude-3-5-haiku-20241022",
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

        // Record usage
        const usage: LLMTokenUsage = {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          provider: "anthropic",
          model: result.modelId,
        };
        recordLLMUsage(actualTraceId || agentId, usage);

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
            errors: result.validation.errors.map(e => e.message),
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

    // Legacy path: direct call without fallback (if verification disabled)
    logger.debug("Using legacy direct LLM call (fallback disabled)");
    
    const message = await client.messages.create({
      model: config.models.primary,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: fullPrompt + (asJson ? "\n\nPlease respond with valid JSON only." : ""),
        },
      ],
    });

    const usage: LLMTokenUsage = {
      inputTokens: message.usage?.input_tokens || 0,
      outputTokens: message.usage?.output_tokens || 0,
      totalTokens:
        (message.usage?.input_tokens || 0) +
        (message.usage?.output_tokens || 0),
      provider: "anthropic",
      model: config.models.primary,
    };

    recordLLMUsage(actualTraceId || agentId, usage);

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
  }

  /**
   * Get orchestrator metrics
   */
  getMetrics() {
    return fallbackOrchestrator.getMetrics();
  }
}

export const agentLLM = new AgentLLM();
