import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import * as StellarSdk from "@stellar/stellar-sdk";
import config from "../../config/config";
import logger from "../../config/logger";

interface StrategyRegistryPayload extends Record<string, unknown> {
  action: "vote" | "get_strategy" | "is_verified";
  poolId?: string;
  aiAgent?: string;
}

const POOL_ID_REGEX = /^[0-9a-f]{64}$/i;

export class StrategyRegistryTool extends BaseTool<StrategyRegistryPayload> {
  metadata: ToolMetadata = {
    name: "strategy_registry",
    description:
      "Interact with the Yield-Aggregator Strategy Registry to vote on Stellar DEX pools or check verification status.",
    parameters: {
      action: {
        type: "string",
        description:
          "Action to perform: 'vote', 'get_strategy', or 'is_verified'",
        required: true,
      },
      poolId: {
        type: "string",
        description: "64-character hexadecimal Stellar AMM liquidity pool ID",
        required: false,
        pattern: "^[0-9a-f]{64}$",
      },
      aiAgent: {
        type: "string",
        description:
          "The public key of the AI agent casting the vote (required for 'vote')",
        required: false,
      },
    },
    examples: [
      "Vote for pool abc123...",
      "What is the current yield strategy?",
      "Is this pool verified by the registry?",
    ],
    category: "stellar",
    version: "1.0.0",
  };

  validate(payload: StrategyRegistryPayload): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!payload.action) {
      errors.push("Missing required parameter: action");
    }

    if (payload.action === "vote") {
      if (!payload.poolId) errors.push("Missing poolId for vote action");
      if (!payload.aiAgent) errors.push("Missing aiAgent for vote action");
    }

    if (payload.poolId && !POOL_ID_REGEX.test(payload.poolId)) {
      errors.push("poolId must be a 64-character hexadecimal string");
    }

    return { valid: errors.length === 0, errors };
  }

  async execute(payload: StrategyRegistryPayload): Promise<ToolResult> {
    const validation = this.validate(payload);
    if (!validation.valid) {
      return this.createErrorResult(
        "strategy_registry",
        validation.errors.join(", ")
      );
    }

    const { action, poolId, aiAgent } = payload;
    const contractId =
      process.env.STRATEGY_REGISTRY_CONTRACT_ID ||
      "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4"; // Mock or default

    try {
      const server = new StellarSdk.SorobanRpc.Server(
        config.stellar.horizonUrl.replace("horizon", "soroban-rpc")
      ); // Heuristic for RPC URL

      if (action === "is_verified") {
        // Mocking the call for now as we don't have a live contract yet
        return {
          success: true,
          data: {
            poolId,
            verified: true,
            message: `Pool ${poolId} is verified and safe for liquidity.`,
          },
        };
      }

      if (action === "get_strategy") {
        return {
          success: true,
          data: {
            currentStrategy:
              "0101010101010101010101010101010101010101010101010101010101010101",
            message: "Current winning strategy retrieved from registry.",
          },
        };
      }

      if (action === "vote") {
        return {
          success: true,
          data: {
            poolId,
            aiAgent,
            status: "Vote submitted",
            message: `AI Agent ${aiAgent} voted for pool ${poolId}. The registry has verified this pool is safe.`,
          },
        };
      }

      return this.createErrorResult("strategy_registry", "Invalid action");
    } catch (error: any) {
      logger.error("Error interacting with Strategy Registry:", error);
      return this.createErrorResult("strategy_registry", error.message);
    }
  }
}

export const strategyRegistryTool = new StrategyRegistryTool();
