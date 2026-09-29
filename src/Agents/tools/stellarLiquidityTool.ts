import config from "../../config/config";
import { Horizon, Asset } from "@stellar/stellar-sdk";

//
// ==============================
// Types
// ==============================
//

interface StellarLiquidityInput {
  assetCode: string;
  assetIssuer: string;
  depthLimit?: number;
}

interface OrderBookLevel {
  price: string;
  amount: string;
}

interface HorizonOrderBookResponse {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

interface LiquidityMetrics {
  pair: string;
  network: string;
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadPercent: number;
  totalBidVolume: number;
  totalAskVolume: number;
  bidLevelsAnalyzed: number;
  askLevelsAnalyzed: number;
  timestamp: string;
}

interface LiquidityError {
  error: string;
}

//
// ==============================
// Validation
// ==============================
//

/**
 * Validate liquidity input parameters
 * @param input - The input containing assetCode and assetIssuer
 * @throws Error if input is invalid
 */
function validateInput(input: StellarLiquidityInput) {
  if (!input.assetCode || input.assetCode.length > 12) {
    throw new Error("Invalid assetCode");
  }

  if (!input.assetIssuer || input.assetIssuer.length < 56) {
    throw new Error("Invalid assetIssuer");
  }
}

//
// ==============================
// Horizon Call
// ==============================
//

/**
 * Fetch orderbook data from Stellar Horizon for an XLM trading pair
 * @param input - The liquidity input with asset code and issuer
 * @returns Orderbook with bids and asks
 */
async function fetchOrderBook(
  input: StellarLiquidityInput
): Promise<HorizonOrderBookResponse> {
  const server = new Horizon.Server(config.stellar.horizonUrl);

  // Define the two sides of the pair
  const native = Asset.native();
  const targetAsset = new Asset(input.assetCode, input.assetIssuer);

  const call = await server.orderbook(native, targetAsset).call();
  //console.log("call", call)

  return {
    bids: call.bids,
    asks: call.asks,
  };
}

//
// ==============================
// Metrics Computation
// ==============================
//

/**
 * Compute liquidity metrics from orderbook data including spread, depth, and volume
 * @param data - The orderbook response
 * @param input - The original liquidity input
 * @returns Computed liquidity metrics or error
 */
function computeLiquidityMetrics(
  data: HorizonOrderBookResponse,
  input: StellarLiquidityInput
): LiquidityMetrics | LiquidityError {
  if (!data.bids.length || !data.asks.length) {
    return { error: "No liquidity available for this pair." };
  }

  const depth = input.depthLimit ?? 20;

  const bids = data.bids.slice(0, depth);
  const asks = data.asks.slice(0, depth);

  const bestBid = parseFloat(bids[0].price);
  const bestAsk = parseFloat(asks[0].price);

  const spread = bestAsk - bestBid;
  const spreadPercent = (spread / bestAsk) * 100;

  const totalBidVolume = bids.reduce(
    (sum, bid) => sum + parseFloat(bid.amount),
    0
  );

  const totalAskVolume = asks.reduce(
    (sum, ask) => sum + parseFloat(ask.amount),
    0
  );

  return {
    pair: `XLM/${input.assetCode}`,
    network: config.stellar.network,
    bestBid,
    bestAsk,
    spread,
    spreadPercent,
    totalBidVolume,
    totalAskVolume,
    bidLevelsAnalyzed: bids.length,
    askLevelsAnalyzed: asks.length,
    timestamp: new Date().toISOString(),
  };
}

//
// ==============================
// Tool Definition
// ==============================
//

export const stellarLiquidityTool = {
  name: "get_xlm_liquidity",
  description:
    "Fetch real-time liquidity data for XLM trading pairs using the configured Stellar Horizon network.",
  parameters: {
    type: "object",
    properties: {
      assetCode: { type: "string" },
      assetIssuer: { type: "string" },
      depthLimit: { type: "number" },
    },
    required: ["assetCode", "assetIssuer"],
  },

  async execute(
    input: StellarLiquidityInput
  ): Promise<LiquidityMetrics | LiquidityError> {
    try {
      validateInput(input);

      const orderBook = await fetchOrderBook(input);

      return computeLiquidityMetrics(orderBook, input);
    } catch (error: unknown) {
      // 1. Log the full error for the developer
      console.error("StellarLiquidityTool Execution Error:", error);

      // 2. Extract a clean message for the AI Agent
      let message =
        "An unexpected error occurred while fetching liquidity data.";

      if (error instanceof Error) {
        message = error.message;
      } else if (typeof error === "string") {
        message = error;
      }

      // 3. Handle Stellar-specific "404 Not Found" (Common if asset/issuer doesn't exist)
      if (message.includes("404") || message.includes("not_found")) {
        message = `Liquidity pair not found. Ensure the asset ${input.assetCode} and issuer exist on the ${config.stellar.network}.`;
      }

      return { error: message };
    }
  },
};
