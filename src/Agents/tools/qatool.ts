import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import { container } from "tsyringe";
import QaService from "../../QA/qa.service";
import { memoryStore } from "../memory/memory";
interface QAPayload {
  query: string;
  context?: Record<string, unknown>;
  input?: string;
}

export class QATool extends BaseTool {
  metadata: ToolMetadata = {
    name: "qa_tool",
    description:
      "Answer user questions about transactions, balances, and contacts.",
    parameters: {
      operation: {
        type: "string",
        description: "The operation to perform",
        required: true,
        enum: ["ask"],
      },
      payload: {
        type: "object",
        description: "Payload containing the user query and optional context",
        required: true,
      },
    },
    examples: [
      "who did I send STRK to yesterday?",
      "can you help me transfer money?",
      "is it safe to perform this transaction?",
      "what’s my wallet balance?",
    ],
    category: "qa",
    version: "1.0.0",
    riskLevel: "low",
    capabilities: ["knowledge_retrieval"],
    permissions: [],
  };

  private qaService = container.resolve(QaService);
  async execute(
    payload: Record<string, unknown>,
    userId: string
  ): Promise<ToolResult> {
    const operation = payload.operation as string;
    const data = payload.payload as QAPayload;

    try {
      switch (operation) {
        case "ask":
          return this.ask(data, userId);
        default:
          return this.createErrorResult(
            "qa_operation",
            `Unknown operation: ${operation}`
          );
      }
    } catch (error) {
      return this.createErrorResult("qa_error", (error as Error).message);
    }
  }

  private async ask(data: QAPayload, userId: string): Promise<ToolResult> {
    if (!data?.query) {
      return this.createErrorResult(
        "qa_query",
        "Missing required field: query"
      );
    }

    const context = memoryStore.get(userId);
    const contextObj: Record<string, unknown> = { memory: context };
    const answer = await this.qaService.answer(userId, data.query, contextObj);

    return this.createSuccessResult("qa_answer", { answer });
  }
}

export const qaTool = new QATool();
