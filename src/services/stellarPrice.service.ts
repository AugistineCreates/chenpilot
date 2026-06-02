import * as StellarSdk from "@stellar/stellar-sdk";
import config from "../config/config";
import logger from "../config/logger";
import priceCacheService, { PRICE_MAX_AGE_MS } from "./priceCache.service";
import { multiHopPathFinder } from "./multiHopPathFinder";

// ---------------------------------------------------------------------------
// QuoteValidity — the contract callers must check before acting on a quote
// ---------------------------------------------------------------------------

export type QuoteInvalidReason =
  | "stale"
  | "no_liquidity"
  | "fetch_error"
  | "unsupported_asset";

export interface QuoteValidity {
  valid: boolean;
  reason?: QuoteInvalidReason;
  /** Age of the underlying price data in ms. */
  ageMs: number;
  /** Timestamp when this quote expires (ms since epoch). */
  expiresAt: number;
}

export interface PriceQuote {
  fromAsset: string;
  toAsset: string;
  price: number;
  amount: number;
  estimatedOutput: number;
  path?: string[];
  cached: boolean;
  timestamp: number;
  validity: QuoteValidity;
  multiHopAnalysis?: {
    totalPathsFound: number;
    bestPathHops: number;
    /** Normalized 0–1 efficiency score. */
    efficiency: number;
  };
}

// ---------------------------------------------------------------------------

const SUPPORTED_ASSETS: Record<string, StellarSdk.Asset> = {
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

function makeValidity(
  ageMs: number,
  valid: boolean,
  reason?: QuoteInvalidReason
): QuoteValidity {
  return {
    valid,
    reason,
    ageMs,
    expiresAt: Date.now() - ageMs + PRICE_MAX_AGE_MS,
  };
}

export class StellarPriceService {
  private server: StellarSdk.Horizon.Server;
  private readonly CACHE_TTL = 60;

  constructor() {
    this.server = new StellarSdk.Horizon.Server(config.stellar.horizonUrl);
  }

  private getAsset(symbol: string): StellarSdk.Asset {
    const asset = SUPPORTED_ASSETS[symbol.toUpperCase()];
    if (!asset) throw new Error(`Unsupported asset: ${symbol}`);
    return asset;
  }

  /**
   * Returns a price quote with an explicit `validity` contract.
   * Throws only on unsupported assets; all other failures produce an
   * invalid quote so callers can handle them deterministically.
   *
   * Stale cache is NEVER silently returned as a valid quote.
   */
  async getPrice(
    fromAsset: string,
    toAsset: string,
    amount: number = 1
  ): Promise<PriceQuote> {
    // Validate assets up-front — this is the only hard throw.
    try {
      this.getAsset(fromAsset);
      this.getAsset(toAsset);
    } catch {
      return this.invalidQuote(
        fromAsset,
        toAsset,
        amount,
        "unsupported_asset",
        0
      );
    }

    // Check cache — only use if fresh.
    const cached = await priceCacheService.getPrice(fromAsset, toAsset);
    if (cached?.fresh) {
      return {
        fromAsset,
        toAsset,
        price: cached.data.price,
        amount,
        estimatedOutput: amount * cached.data.price,
        cached: true,
        timestamp: cached.data.timestamp,
        validity: makeValidity(cached.ageMs, true),
      };
    }

    // Fetch live price from Stellar DEX.
    try {
      const sourceAsset = this.getAsset(fromAsset);
      const destAsset = this.getAsset(toAsset);

      const paths = await this.server
        .strictSendPaths(sourceAsset, amount.toFixed(7), [destAsset])
        .call();

      if (!paths.records || paths.records.length === 0) {
        logger.warn(`No liquidity path found for ${fromAsset}/${toAsset}`);
        return this.invalidQuote(fromAsset, toAsset, amount, "no_liquidity", 0);
      }

      const bestPath = paths.records[0];
      const destAmount = parseFloat(bestPath.destination_amount);
      const price = destAmount / amount;

      await priceCacheService.setPrice(
        fromAsset,
        toAsset,
        price,
        "stellar_dex",
        this.CACHE_TTL
      );

      const pathAssets = bestPath.path.map(
        (a: { asset_type: string; asset_code: string }) =>
          a.asset_type === "native" ? "XLM" : a.asset_code
      );

      logger.info(`Fetched live price ${fromAsset}/${toAsset} = ${price}`);

      return {
        fromAsset,
        toAsset,
        price,
        amount,
        estimatedOutput: destAmount,
        path: [fromAsset, ...pathAssets, toAsset],
        cached: false,
        timestamp: Date.now(),
        validity: makeValidity(0, true),
      };
    } catch (error) {
      logger.error("Error fetching price from Stellar DEX:", error);
      return this.invalidQuote(fromAsset, toAsset, amount, "fetch_error", 0);
    }
  }

  /**
   * Batch price fetch. Each quote carries its own validity — callers must
   * filter on `quote.validity.valid` before use.
   */
  async getPrices(
    pairs: Array<{ from: string; to: string; amount?: number }>
  ): Promise<PriceQuote[]> {
    return Promise.all(
      pairs.map((p) => this.getPrice(p.from, p.to, p.amount ?? 1))
    );
  }

  async getOrderbookDepth(
    fromAsset: string,
    toAsset: string,
    limit: number = 20
  ): Promise<{
    bids: Array<{ price: number; amount: number }>;
    asks: Array<{ price: number; amount: number }>;
  }> {
    const sourceAsset = this.getAsset(fromAsset);
    const destAsset = this.getAsset(toAsset);

    const orderbook = await this.server
      .orderbook(sourceAsset, destAsset)
      .limit(limit)
      .call();

    return {
      bids: orderbook.bids.map((b) => ({
        price: parseFloat(b.price),
        amount: parseFloat(b.amount),
      })),
      asks: orderbook.asks.map((a) => ({
        price: parseFloat(a.price),
        amount: parseFloat(a.amount),
      })),
    };
  }

  async invalidatePrice(fromAsset: string, toAsset: string): Promise<void> {
    await priceCacheService.invalidatePrice(fromAsset, toAsset);
  }

  /**
   * Multi-hop price with validity contract.
   * Returns an invalid quote (rather than throwing) when no path is found.
   */
  async getPriceWithMultiHop(
    fromAsset: string,
    toAsset: string,
    amount: number = 1,
    maxHops: number = 5
  ): Promise<PriceQuote> {
    try {
      this.getAsset(fromAsset);
      this.getAsset(toAsset);
    } catch {
      return this.invalidQuote(
        fromAsset,
        toAsset,
        amount,
        "unsupported_asset",
        0
      );
    }

    try {
      const sourceAsset = this.getAsset(fromAsset);
      const destAsset = this.getAsset(toAsset);

      const pathResult = await multiHopPathFinder.findOptimalPath(
        sourceAsset,
        destAsset,
        amount.toFixed(7),
        { maxHops }
      );

      const destAmount = parseFloat(pathResult.bestPath.destinationAmount);
      const price = destAmount / amount;

      return {
        fromAsset,
        toAsset,
        price,
        amount,
        estimatedOutput: destAmount,
        path: pathResult.bestPath.route,
        cached: false,
        timestamp: Date.now(),
        validity: makeValidity(0, true),
        multiHopAnalysis: {
          totalPathsFound: pathResult.allPaths.length,
          bestPathHops: pathResult.bestPath.hops,
          efficiency: pathResult.bestPath.efficiency,
        },
      };
    } catch (error) {
      logger.error("Error fetching multi-hop price:", error);
      return this.invalidQuote(fromAsset, toAsset, amount, "fetch_error", 0);
    }
  }

  private invalidQuote(
    fromAsset: string,
    toAsset: string,
    amount: number,
    reason: QuoteInvalidReason,
    ageMs: number
  ): PriceQuote {
    return {
      fromAsset,
      toAsset,
      price: 0,
      amount,
      estimatedOutput: 0,
      cached: false,
      timestamp: Date.now(),
      validity: makeValidity(ageMs, false, reason),
    };
  }
}

export default new StellarPriceService();
