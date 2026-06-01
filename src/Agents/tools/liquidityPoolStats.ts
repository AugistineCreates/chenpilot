import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import config from "../../config/config";
import logger from "../../config/logger";

interface LiquidityPoolStatsPayload extends Record<string, unknown> {
  poolId: string;
}

interface HorizonPoolRecord {
  id: string;
  reserves: Array<{ asset: string; amount: string }>;
  total_shares: string;
  total_trustlines: string;
  fee_bp: number;
  volume?: { [key: string]: { base_volume: string; counter_volume: string } };
}

const POOL_ID_REGEX = /^[0-9a-f]{64}$/i;
const FEE_PERCENTAGE = 0.003; // 0.30% standard Stellar AMM fee

export class LiquidityPoolStatsTool extends BaseTool<LiquidityPoolStatsPayload> {
  metadata: ToolMetadata = {
    name: "get_liquidity_pool_stats",
    description:
      "Fetch statistics for a Stellar AMM liquidity pool by pool ID, including reserves, volume, and estimated APR",
    parameters: {
      poolId: {
        type: "string",
        description: "64-character hexadecimal Stellar AMM liquidity pool ID",
        required: true,
        pattern: "^[0-9a-f]{64}$",
      },
    },
    examples: [
      "Get stats for liquidity pool abc123...",
      "Show me the APR for this pool",
      "What are the reserves in pool 0x...",
    ],
    category: "stellar",
    version: "1.0.0",
  };

  validate(payload: LiquidityPoolStatsPayload): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!payload.poolId) {
      errors.push("Missing required parameter: poolId");
      return { valid: false, errors };
    }

    if (!POOL_ID_REGEX.test(payload.poolId)) {
      errors.push("poolId must be a 64-character hexadecimal string");
    }

    return { valid: errors.length === 0, errors };
  }

  async execute(payload: LiquidityPoolStatsPayload): Promise<ToolResult> {
    const validation = this.validate(payload);
    if (!validation.valid) {
      return this.createErrorResult(
        "get_liquidity_pool_stats",
        validation.errors.join(", ")
      );
    }

    const { poolId } = payload;

    try {
      const url = `${config.stellar.horizonUrl}/liquidity_pools/${poolId}`;
      const response = await fetch(url);

      if (response.status === 404) {
        return this.createErrorResult(
          "get_liquidity_pool_stats",
          "Liquidity pool not found. Verify the pool ID exists on the configured Stellar network."
        );
      }

      if (!response.ok) {
        return this.createErrorResult(
          "get_liquidity_pool_stats",
          `Horizon API returned HTTP ${response.status}`
        );
      }

      const pool = (await response.json()) as HorizonPoolRecord;

      const reserveA = parseFloat(pool.reserves[0]?.amount ?? "0");
      const reserveB = parseFloat(pool.reserves[1]?.amount ?? "0");
      const assetA = pool.reserves[0]?.asset ?? "unknown";
      const assetB = pool.reserves[1]?.asset ?? "unknown";

      // Extract 24h volume from the pool record if available
      const volumeEntry = pool.volume
        ? (
            pool.volume as Record<
              string,
              { base_volume: string; counter_volume: string }
            >
          )[Object.keys(pool.volume)[0]]
        : null;
      const volume24h = volumeEntry
        ? parseFloat(volumeEntry.base_volume) +
          parseFloat(volumeEntry.counter_volume)
        : 0;

      const totalLiquidity = reserveA + reserveB;
      const apr =
        totalLiquidity > 0
          ? parseFloat(
              (
                ((volume24h * FEE_PERCENTAGE * 365) / totalLiquidity) *
                100
              ).toFixed(2)
            )
          : 0;

      return this.createSuccessResult("get_liquidity_pool_stats", {
        poolId,
        assetA,
        assetB,
        reserveA: parseFloat(reserveA.toFixed(7)),
        reserveB: parseFloat(reserveB.toFixed(7)),
        totalShares: pool.total_shares,
        totalTrustlines: pool.total_trustlines,
        fee: `${(pool.fee_bp / 100).toFixed(2)}%`,
        volume24h,
        apr,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error("LiquidityPoolStatsTool error", { poolId, error });

      const message =
        error instanceof Error &&
        (error.message.includes("fetch") || error.message.includes("network"))
          ? "Failed to reach Horizon API. Check network connectivity."
          : error instanceof Error
            ? error.message
            : "Unknown error";

      return this.createErrorResult("get_liquidity_pool_stats", message);
    }
  }
}

export const liquidityPoolStatsTool = new LiquidityPoolStatsTool();
