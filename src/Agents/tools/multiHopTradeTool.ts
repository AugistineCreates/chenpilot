import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import * as StellarSdk from "@stellar/stellar-sdk";
import { multiHopPathFinder } from "../../services/multiHopPathFinder";
import logger from "../../config/logger";

interface MultiHopTradePayload extends Record<string, unknown> {
  fromAsset: string;
  toAsset: string;
  amount: number;
  maxHops?: number;
  executeOptimal?: boolean;
}

const STELLAR_ASSETS: Record<string, StellarSdk.Asset> = {
  XLM: StellarSdk.Asset.native(),
  USDC: new StellarSdk.Asset(
    "USDC",
    "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
  ),
  USDT: new StellarSdk.Asset(
    "USDT",
    "GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V"
  ),
};

export class MultiHopTradeTool extends BaseTool<MultiHopTradePayload> {
  metadata: ToolMetadata = {
    name: "multi_hop_trade",
    description:
      "Evaluate and find optimal multi-hop trading paths across Stellar DEX using multiple intermediate assets",
    category: "defi",
    parameters: {
      fromAsset: {
        type: "string",
        description: "Source asset symbol (e.g., XLM, USDC, USDT)",
        required: true,
        enum: ["XLM", "USDC", "USDT"],
      },
      toAsset: {
        type: "string",
        description: "Destination asset symbol (e.g., XLM, USDC, USDT)",
        required: true,
        enum: ["XLM", "USDC", "USDT"],
      },
      amount: {
        type: "number",
        description: "Amount of source asset to trade",
        required: true,
      },
      maxHops: {
        type: "number",
        description: "Maximum number of intermediate hops (default: 5)",
        required: false,
      },
      executeOptimal: {
        type: "boolean",
        description:
          "Whether to execute the optimal path (default: false, only evaluate)",
        required: false,
      },
    },
    examples: [
      "Find best path to swap 100 XLM to USDC",
      "Evaluate multi-hop routes from USDC to USDT with max 3 hops",
      "Compare trading paths for 500 XLM to USDT",
    ],
    version: "1.0.0",
  };

  async execute(
    payload: MultiHopTradePayload,
    userId: string
  ): Promise<ToolResult> {
    try {
      logger.info("Multi-hop trade path evaluation started", {
        userId,
        payload,
      });

      const sourceAsset = this.getAsset(payload.fromAsset);
      const destinationAsset = this.getAsset(payload.toAsset);

      if (!sourceAsset || !destinationAsset) {
        return {
          action: "multi_hop_trade",
          status: "error",
          error: "Invalid asset symbols provided",
        };
      }

      if (payload.fromAsset === payload.toAsset) {
        return {
          action: "multi_hop_trade",
          status: "error",
          error: "Source and destination assets must be different",
        };
      }

      const result = await multiHopPathFinder.findOptimalPath(
        sourceAsset,
        destinationAsset,
        payload.amount.toFixed(7),
        {
          maxHops: payload.maxHops || 5,
        }
      );

      const response = {
        bestPath: {
          route: result.bestPath.route,
          hops: result.bestPath.hops,
          sourceAmount: result.bestPath.sourceAmount,
          destinationAmount: result.bestPath.destinationAmount,
          priceImpact: `${result.bestPath.priceImpact.toFixed(2)}%`,
          estimatedSlippage: `${(result.bestPath.estimatedSlippage * 100).toFixed(3)}%`,
          efficiency: result.bestPath.efficiency.toFixed(4),
        },
        alternativePaths: result.allPaths.slice(1, 4).map((path) => ({
          route: path.route,
          hops: path.hops,
          destinationAmount: path.destinationAmount,
          efficiency: path.efficiency.toFixed(4),
        })),
        evaluation: {
          totalPathsFound: result.allPaths.length,
          evaluationTimeMs: result.evaluationTime,
          timestamp: new Date(result.timestamp).toISOString(),
        },
        recommendation: this.generateRecommendation(result.bestPath),
      };

      logger.info("Multi-hop trade path evaluation completed", {
        userId,
        pathsFound: result.allPaths.length,
        bestPathHops: result.bestPath.hops,
      });

      return {
        action: "multi_hop_trade",
        status: "success",
        message: "Multi-hop path evaluation completed successfully",
        data: response,
      };
    } catch (error) {
      logger.error("Multi-hop trade path evaluation failed", {
        userId,
        error,
      });

      return {
        action: "multi_hop_trade",
        status: "error",
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  }

  private getAsset(symbol: string): StellarSdk.Asset | null {
    return STELLAR_ASSETS[symbol.toUpperCase()] || null;
  }

  private generateRecommendation(bestPath: any): string {
    if (bestPath.hops === 1) {
      return "Direct trade path available - optimal for execution";
    }
    if (bestPath.hops === 2) {
      return "Single intermediate hop - good efficiency with minimal complexity";
    }
    if (bestPath.priceImpact > 5) {
      return "High price impact detected - consider splitting into smaller trades";
    }
    if (bestPath.estimatedSlippage > 0.01) {
      return "Elevated slippage expected - monitor execution carefully";
    }
    return "Path evaluation complete - review efficiency metrics before execution";
  }
}
