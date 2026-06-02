import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";

export class MetaTool extends BaseTool {
  metadata: ToolMetadata = {
    name: "meta_tool",
    description:
      "Provides information about the agent (name, capabilities, version).",
    parameters: {
      operation: {
        type: "string",
        description: "The meta operation to perform",
        required: true,
        enum: ["get_name", "get_capabilities", "get_version", "get_creator"],
      },
    },
    examples: [
      "What is your name?",
      "What can you do?",
      "What version are you?",
    ],
    category: "meta",
    version: "1.0.0",
    riskLevel: "low",
    capabilities: ["agent_info"],
    permissions: [],
  };

  async execute(
    payload: Record<string, unknown>,
    _userId: string
  ): Promise<ToolResult> {
    const operation = payload.operation as string;

    switch (operation) {
      case "get_name":
        return this.createSuccessResult("agent_name", {
          name: "Chen pilot",
        });

      case "get_capabilities":
        return this.createSuccessResult("agent_capabilities", {
          capabilities: [
            "Check wallet balances",
            "Transfer tokens",
            "Get wallet address",
            "Swap assets",
            "Provide agent info (name, version, capabilities)",
            "Create delete and edit contacts"
          ],
        });

      case "get_version":
        return this.createSuccessResult("agent_version", {
          version: this.metadata.version,
        });
      case "get_creator":
        return this.createSuccessResult("get_creator", {
          data: "i was created by Solomon Emmanuel and Fishon Amos",
        });
      default:
        return this.createErrorResult(
          "meta_operation",
          `Unknown operation: ${operation}`
        );
    }
  }
}

export const metaTool = new MetaTool();
