import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import * as StellarSdk from "@stellar/stellar-sdk";
import { flashSwapRiskAnalyzer } from "../../services/flashSwapRiskAnalyzer";

interface RiskAnalysisPayload extends Record<string, unknown> {
  from: string;
  to: string;
  amount: number;
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

export class RiskAnalysisTool extends BaseTool<RiskAnalysisPayload> {
  metadata: ToolMetadata = {
    name: "risk_analysis_tool",
    description: "Analyze sandwich attack and flash swap risks for DEX swaps",
    parameters: {
      from: {
        type: "string",
        description: "Source token symbol",
        required: true,
        enum: ["XLM", "USDC", "USDT"],
      },
      to: {
        type: "string",
        description: "Target token symbol",
        required: true,
        enum: ["XLM", "USDC", "USDT"],
      },
      amount: {
        type: "number",
        description: "Amount to analyze",
        required: true,
        min: 0,
      },
    },
    examples: [
      "Analyze risk for swapping 1000 XLM to USDC",
      "Check sandwich attack risk for 500 USDC to XLM",
    ],
    category: "security",
    version: "1.0.0",
    riskLevel: "low",
    capabilities: ["risk_analysis"],
    permissions: [],
  };

  async execute(payload: RiskAnalysisPayload, userId: string): Promise<ToolResult> {
    try {
      const sourceAsset = STELLAR_ASSETS[payload.from];
      const destAsset = STELLAR_ASSETS[payload.to];

      if (!sourceAsset || !destAsset) {
        return this.createErrorResult(
          "risk_analysis",
          "Invalid token symbol. Supported: XLM, USDC, USDT"
        );
      }

      const analysis = await flashSwapRiskAnalyzer.analyzeSwapRisk({
        fromAsset: sourceAsset,
        toAsset: destAsset,
        amount: payload.amount,
      });

      return this.createSuccessResult("risk_analysis", {
        swap: {
          from: payload.from,
          to: payload.to,
          amount: payload.amount,
        },
        riskLevel: analysis.riskLevel,
        sandwichAttackRisk: `${(analysis.sandwichAttackRisk * 100).toFixed(1)}%`,
        warnings: analysis.warnings,
        recommendations: analysis.recommendations,
        metrics: {
          priceImpact: `${analysis.metrics.priceImpact.toFixed(2)}%`,
          liquidityDepth: analysis.metrics.liquidityDepth.toFixed(2),
          spreadPercentage: `${analysis.metrics.spreadPercentage.toFixed(2)}%`,
          recentVolatility: `${analysis.metrics.recentVolatility.toFixed(2)}%`,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return this.createErrorResult("risk_analysis", `Risk analysis failed: ${errorMessage}`);
    }
  }
}

export const riskAnalysisTool = new RiskAnalysisTool();
