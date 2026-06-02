import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import stellarPriceService from "../../services/stellarPrice.service";
import priceCacheService from "../../services/priceCache.service";
import logger from "../../config/logger";

interface PricePayload extends Record<string, unknown> {
  operation: "get_price" | "get_prices" | "get_orderbook" | "cache_stats";
  from?: string;
  to?: string;
  amount?: number;
  pairs?: Array<{ from: string; to: string; amount?: number }>;
  limit?: number;
}

export class PriceTool extends BaseTool<PricePayload> {
  metadata: ToolMetadata = {
    name: "price_tool",
    description:
      "Get real-time asset prices from Stellar DEX with Redis caching for fast lookups",
    parameters: {
      operation: {
        type: "string",
        description: "The price operation to perform",
        required: true,
        enum: ["get_price", "get_prices", "get_orderbook", "cache_stats"],
      },
      from: {
        type: "string",
        description: "Source asset symbol",
        required: false,
        enum: ["XLM", "USDC", "USDT"],
      },
      to: {
        type: "string",
        description: "Target asset symbol",
        required: false,
        enum: ["XLM", "USDC", "USDT"],
      },
      amount: {
        type: "number",
        description: "Amount to get price for (default: 1)",
        required: false,
        min: 0,
      },
      pairs: {
        type: "array",
        description: "Array of asset pairs for batch price lookup",
        required: false,
      },
      limit: {
        type: "number",
        description: "Limit for orderbook depth (default: 20)",
        required: false,
        min: 1,
        max: 200,
      },
    },
    examples: [
      "What's the price of XLM in USDC?",
      "Get price for 100 XLM to USDT",
      "Show me the orderbook for XLM/USDC",
      "Get prices for multiple pairs",
      "Show cache statistics",
    ],
    category: "price",
    version: "1.0.0",
    riskLevel: "low",
    capabilities: ["market_data", "price_lookup"],
    permissions: [],
  };

  async execute(payload: PricePayload): Promise<ToolResult> {
    try {
      switch (payload.operation) {
        case "get_price":
          return await this.getPrice(payload);
        case "get_prices":
          return await this.getPrices(payload);
        case "get_orderbook":
          return await this.getOrderbook(payload);
        case "cache_stats":
          return await this.getCacheStats();
        default:
          return {
            action: "price",
            status: "error",
            error: `Unknown operation: ${payload.operation}`,
          };
      }
    } catch (error) {
      logger.error("Price tool error:", error);
      return {
        action: "price",
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async getPrice(payload: PricePayload): Promise<ToolResult> {
    if (!payload.from || !payload.to) {
      return {
        action: "price",
        status: "error",
        error: "Both 'from' and 'to' assets are required",
      };
    }

    const quote = await stellarPriceService.getPrice(
      payload.from,
      payload.to,
      payload.amount || 1
    );

    return {
      action: "price",
      status: "success",
      data: {
        quote,
      },
      message: quote.cached
        ? `Price retrieved from cache (${Math.round((Date.now() - quote.timestamp) / 1000)}s old)`
        : "Price fetched from Stellar DEX",
    };
  }

  private async getPrices(payload: PricePayload): Promise<ToolResult> {
    if (!payload.pairs || !Array.isArray(payload.pairs)) {
      return {
        action: "price",
        status: "error",
        error: "Pairs array is required for get_prices operation",
      };
    }

    const quotes = await stellarPriceService.getPrices(payload.pairs);

    return {
      action: "price",
      status: "success",
      data: {
        quotes,
        total: quotes.length,
        cached: quotes.filter((q) => q.cached).length,
      },
    };
  }

  private async getOrderbook(payload: PricePayload): Promise<ToolResult> {
    if (!payload.from || !payload.to) {
      return {
        action: "price",
        status: "error",
        error: "Both 'from' and 'to' assets are required",
      };
    }

    const orderbook = await stellarPriceService.getOrderbookDepth(
      payload.from,
      payload.to,
      payload.limit || 20
    );

    return {
      action: "price",
      status: "success",
      data: {
        pair: `${payload.from}/${payload.to}`,
        orderbook,
        bestBid: orderbook.bids[0]?.price || null,
        bestAsk: orderbook.asks[0]?.price || null,
        spread:
          orderbook.asks[0] && orderbook.bids[0]
            ? ((orderbook.asks[0].price - orderbook.bids[0].price) /
                orderbook.bids[0].price) *
              100
            : null,
      },
    };
  }

  private async getCacheStats(): Promise<ToolResult> {
    const stats = await priceCacheService.getStats();
    const healthy = await priceCacheService.healthCheck();

    return {
      action: "price",
      status: "success",
      data: {
        ...stats,
        healthy,
        status: healthy ? "connected" : "disconnected",
      },
    };
  }
}
