import Anthropic from "@anthropic-ai/sdk";
import config from "../config/config";
import { memoryStore } from "./memory/memory";
import logger from "../config/logger";
import { withTimeout, TimeoutError } from "../utils/timeout";

const client = new Anthropic({
  apiKey: config.apiKey,
});

export class AgentLLM {
  async callLLM(
    agentId: string,
    prompt: string,
    userInput: string,
    asJson = true,
    timeoutMs?: number | string,
    traceId?: string
  ): Promise<unknown> {
    // If timeoutMs is actually a traceId (string), swap the parameters
    const actualTimeoutMs =
      typeof timeoutMs === "string" ? undefined : timeoutMs;
    const actualTraceId =
      typeof timeoutMs === "string" ? timeoutMs : traceId || "";

    const timeout = actualTimeoutMs || config.agent.timeouts.llmCall;
    const memoryContext = memoryStore.get(agentId).join("\n");
    // Delimit user input with XML-style tags to prevent prompt injection.
    // The model is instructed to treat everything inside <user_input> as data only.
    const safeUserInput = userInput.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const fullPrompt = `${
      memoryContext ? "Previous context:\n" + memoryContext + "\n\n" : ""
    }${prompt}\n\n<user_input>\n${safeUserInput}\n</user_input>${
      asJson ? "\n\nPlease respond with valid JSON only." : ""
    }`;

    logger.debug("Starting LLM call", {
      agentId,
      timeout,
      asJson,
      traceId: actualTraceId,
    });

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

      const content =
        message.content[0].type === "text" ? message.content[0].text : "{}";

      if (asJson) {
        try {
          const parsed = JSON.parse(content);
          return parsed;
        } catch (err) {
          logger.error("JSON parse error", { error: err, rawContent: content });
          return {};
        }
      } else {
        return content;
      }
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
}

export const agentLLM = new AgentLLM();
