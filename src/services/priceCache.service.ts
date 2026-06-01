import { getRedisClient, healthCheckRedis } from "./redis/client";
import logger from "../config/logger";

export interface PriceData {
  price: number;
  timestamp: number;
  source: string;
}

interface CacheStats {
  totalKeys: number;
  memoryUsage: string;
  hitRate?: number;
}

export class PriceCacheService {
  private readonly DEFAULT_TTL = 60;
  private hits = 0;
  private misses = 0;

  private getCacheKey(fromAsset: string, toAsset: string): string {
    return `price:${fromAsset.toUpperCase()}:${toAsset.toUpperCase()}`;
  }

  async getPrice(
    fromAsset: string,
    toAsset: string
  ): Promise<PriceData | null> {
    const start = Date.now();

    try {
      const key = this.getCacheKey(fromAsset, toAsset);
      const redis = getRedisClient();
      const cached = await redis.get(key);

      if (!cached) {
        this.misses++;
        return null;
      }

      this.hits++;
      const priceData: PriceData = JSON.parse(cached);

      logger.debug("Cache hit for price", {
        pair: `${fromAsset}/${toAsset}`,
        price: priceData.price,
        latencyMs: Date.now() - start,
      });

      return priceData;
    } catch (error) {
      logger.error("Error getting cached price", {
        error: error instanceof Error ? error.message : "Unknown error",
        latencyMs: Date.now() - start,
      });
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
    const start = Date.now();

    try {
      const key = this.getCacheKey(fromAsset, toAsset);
      const priceData: PriceData = {
        price,
        timestamp: Date.now(),
        source,
      };

      const redis = getRedisClient();
      await redis.setex(key, ttl, JSON.stringify(priceData));

      logger.debug("Cached price", {
        pair: `${fromAsset}/${toAsset}`,
        price,
        ttl,
        latencyMs: Date.now() - start,
      });
    } catch (error) {
      logger.error("Error setting cached price", {
        error: error instanceof Error ? error.message : "Unknown error",
        latencyMs: Date.now() - start,
      });
    }
  }

  async getPrices(
    pairs: Array<{ from: string; to: string }>
  ): Promise<Map<string, PriceData | null>> {
    const results = new Map<string, PriceData | null>();
    const start = Date.now();

    try {
      const keys = pairs.map((pair) => this.getCacheKey(pair.from, pair.to));
      const redis = getRedisClient();
      const values = await redis.mget(...keys);

      pairs.forEach((pair, index) => {
        const pairKey = `${pair.from}/${pair.to}`;
        const value = values[index];

        if (value) {
          results.set(pairKey, JSON.parse(value));
          this.hits++;
        } else {
          results.set(pairKey, null);
          this.misses++;
        }
      });

      logger.debug("Batch price retrieval", {
        pairs: pairs.length,
        latencyMs: Date.now() - start,
      });
    } catch (error) {
      logger.error("Error getting multiple cached prices", {
        error: error instanceof Error ? error.message : "Unknown error",
        latencyMs: Date.now() - start,
      });
    }

    return results;
  }

  async invalidatePrice(fromAsset: string, toAsset: string): Promise<void> {
    try {
      const key = this.getCacheKey(fromAsset, toAsset);
      const redis = getRedisClient();
      await redis.del(key);
      logger.debug("Invalidated price cache", {
        pair: `${fromAsset}/${toAsset}`,
      });
    } catch (error) {
      logger.error("Error invalidating cached price", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async clearAll(): Promise<void> {
    const start = Date.now();

    try {
      const redis = getRedisClient();
      let cursor = "0";
      let deletedCount = 0;

      do {
        const result = await redis.scan(
          cursor,
          "MATCH",
          "price:*",
          "COUNT",
          100
        );
        cursor = result[0];
        const keys = result[1];

        if (keys.length > 0) {
          await redis.del(...keys);
          deletedCount += keys.length;
        }
      } while (cursor !== "0");

      if (deletedCount > 0) {
        logger.info("Cleared price cache", {
          keysDeleted: deletedCount,
          latencyMs: Date.now() - start,
        });
      }
    } catch (error) {
      logger.error("Error clearing price cache", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async getStats(): Promise<CacheStats> {
    try {
      const redis = getRedisClient();
      let totalKeys = 0;
      let cursor = "0";

      do {
        const result = await redis.scan(
          cursor,
          "MATCH",
          "price:*",
          "COUNT",
          500
        );
        cursor = result[0];
        totalKeys += result[1].length;
      } while (cursor !== "0");

      const info = await redis.info("memory");
      const memoryMatch = info.match(/used_memory_human:(.+)/);
      const memoryUsage = memoryMatch ? memoryMatch[1].trim() : "unknown";

      const totalAccesses = this.hits + this.misses;
      const hitRate =
        totalAccesses > 0
          ? parseFloat(((this.hits / totalAccesses) * 100).toFixed(1))
          : undefined;

      return {
        totalKeys,
        memoryUsage,
        hitRate,
      };
    } catch (error) {
      logger.error("Error getting cache stats", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return {
        totalKeys: 0,
        memoryUsage: "unknown",
      };
    }
  }

  getHitRate(): { hits: number; misses: number; hitRate: number | undefined } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? parseFloat(((this.hits / total) * 100).toFixed(1)) : undefined,
    };
  }

  resetHitRate(): void {
    this.hits = 0;
    this.misses = 0;
  }

  async healthCheck(): Promise<boolean> {
    return healthCheckRedis();
  }
}

export default new PriceCacheService();
