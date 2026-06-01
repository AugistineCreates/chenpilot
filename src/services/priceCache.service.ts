import Redis from "ioredis";
import config from "../config/config";
import logger from "../config/logger";

export interface PriceData {
  price: number;
  timestamp: number;
  source: string;
}

/** Maximum age in ms a cached price is considered fresh enough to act on. */
export const PRICE_MAX_AGE_MS = 60_000;

export interface CachedPriceResult {
  data: PriceData;
  /** True when the entry is within PRICE_MAX_AGE_MS. */
  fresh: boolean;
  ageMs: number;
}

export class PriceCacheService {
  private redis: Redis;
  private readonly DEFAULT_TTL = 60;

  constructor() {
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
    });

    this.redis.on("connect", () => logger.info("Redis connected successfully"));
    this.redis.on("error", (err) =>
      logger.error("Redis connection error:", err)
    );
  }

  private getCacheKey(fromAsset: string, toAsset: string): string {
    return `price:${fromAsset.toUpperCase()}:${toAsset.toUpperCase()}`;
  }

  /**
   * Returns the cached entry with an explicit freshness flag.
   * Callers must check `fresh` before using the price for decisions.
   */
  async getPrice(
    fromAsset: string,
    toAsset: string
  ): Promise<CachedPriceResult | null> {
    try {
      const key = this.getCacheKey(fromAsset, toAsset);
      const cached = await this.redis.get(key);
      if (!cached) return null;

      const data: PriceData = JSON.parse(cached);
      const ageMs = Date.now() - data.timestamp;
      const fresh = ageMs <= PRICE_MAX_AGE_MS;

      logger.debug(
        `Cache ${fresh ? "hit" : "stale"} for ${fromAsset}/${toAsset}`,
        {
          ageMs,
          price: data.price,
        }
      );

      return { data, fresh, ageMs };
    } catch (error) {
      logger.error("Error getting cached price:", error);
      return null;
    }
  }

  async setPrice(
    fromAsset: string,
    toAsset: string,
    price: number,
    source: string,
    ttl: number = this.DEFAULT_TTL
  ): Promise<void> {
    try {
      const key = this.getCacheKey(fromAsset, toAsset);
      const priceData: PriceData = { price, timestamp: Date.now(), source };
      await this.redis.setex(key, ttl, JSON.stringify(priceData));
      logger.debug(
        `Cached price for ${fromAsset}/${toAsset}: ${price} (TTL: ${ttl}s)`
      );
    } catch (error) {
      logger.error("Error setting cached price:", error);
    }
  }

  async getPrices(
    pairs: Array<{ from: string; to: string }>
  ): Promise<Map<string, CachedPriceResult | null>> {
    const results = new Map<string, CachedPriceResult | null>();
    try {
      const keys = pairs.map((p) => this.getCacheKey(p.from, p.to));
      const values = await this.redis.mget(...keys);
      pairs.forEach((pair, i) => {
        const pairKey = `${pair.from}/${pair.to}`;
        const value = values[i];
        if (value) {
          const data: PriceData = JSON.parse(value);
          const ageMs = Date.now() - data.timestamp;
          results.set(pairKey, {
            data,
            fresh: ageMs <= PRICE_MAX_AGE_MS,
            ageMs,
          });
        } else {
          results.set(pairKey, null);
        }
      });
    } catch (error) {
      logger.error("Error getting multiple cached prices:", error);
    }
    return results;
  }

  async invalidatePrice(fromAsset: string, toAsset: string): Promise<void> {
    try {
      await this.redis.del(this.getCacheKey(fromAsset, toAsset));
      logger.debug(`Invalidated cache for ${fromAsset}/${toAsset}`);
    } catch (error) {
      logger.error("Error invalidating cached price:", error);
    }
  }

  async clearAll(): Promise<void> {
    try {
      const keys = await this.redis.keys("price:*");
      if (keys.length > 0) {
        await this.redis.del(...keys);
        logger.info(`Cleared ${keys.length} cached prices`);
      }
    } catch (error) {
      logger.error("Error clearing price cache:", error);
    }
  }

  async getStats(): Promise<{ totalKeys: number; memoryUsage: string }> {
    try {
      const keys = await this.redis.keys("price:*");
      const info = await this.redis.info("memory");
      const memoryMatch = info.match(/used_memory_human:(.+)/);
      return {
        totalKeys: keys.length,
        memoryUsage: memoryMatch ? memoryMatch[1].trim() : "unknown",
      };
    } catch {
      return { totalKeys: 0, memoryUsage: "unknown" };
    }
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
    logger.info("Redis disconnected");
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }
}

export default new PriceCacheService();
