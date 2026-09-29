import { randomUUID } from "crypto";
import { getRedisClient } from "../redis/client";
import logger from "../../config/logger";
import { LockOptions, LockResult, LockInfo, LockService } from "./types";

/**
 * Instrumentation counters for Redis-backed coordination primitives.
 */
export interface ConcurrencyCounters {
  acquireSuccess: number;
  acquireFailure: number;
  releaseSuccess: number;
  releaseFailure: number;
  extendSuccess: number;
  extendFailure: number;
  forceRelease: number;
  renewalSuccess: number;
  renewalFailure: number;
  staleCleanup: number;
}

/**
 * Safe Redis concurrency primitives for distributed coordination.
 *
 * Improvements over basic locking:
 *  - Ownership semantics via owner-prefixed lock values
 *  - Automatic renewal/lease extension with safety checks
 *  - Stale-lock detection and cleanup
 *  - Advisory lock metadata for observability
 *  - Counter-based instrumentation
 */
export class RedisConcurrencyService implements LockService {
  private readonly DEFAULT_TTL = 30000;
  private readonly DEFAULT_RETRY_DELAY = 100;
  private readonly DEFAULT_MAX_RETRIES = 10;
  private readonly DEFAULT_RENEWAL_THRESHOLD = 0.6; // renew at 60% of TTL elapsed

  private counters: ConcurrencyCounters = {
    acquireSuccess: 0,
    acquireFailure: 0,
    releaseSuccess: 0,
    releaseFailure: 0,
    extendSuccess: 0,
    extendFailure: 0,
    forceRelease: 0,
    renewalSuccess: 0,
    renewalFailure: 0,
    staleCleanup: 0,
  };

  private getLockKey(resourceKey: string): string {
    return `lock:${resourceKey}`;
  }

  private generateLockValue(identifier: string): string {
    return `${identifier}:${randomUUID()}:${Date.now()}`;
  }

  private extractOwnerId(lockValue: string): string {
    const colonIndex = lockValue.indexOf(":");
    return colonIndex === -1 ? lockValue : lockValue.substring(0, colonIndex);
  }

  private releaseLuaScript(): string {
    return `
      local key = KEYS[1]
      local identifier = ARGV[1]
      local lockValue = redis.call('GET', key)
      if not lockValue then
        return 0
      end
      local prefix = identifier .. ':'
      if string.sub(lockValue, 1, #prefix) == prefix then
        return redis.call('DEL', key)
      else
        return 0
      end
    `;
  }

  private extendLuaScript(): string {
    return `
      local key = KEYS[1]
      local identifier = ARGV[1]
      local ttl = ARGV[2]
      local lockValue = redis.call('GET', key)
      if not lockValue then
        return 0
      end
      local prefix = identifier .. ':'
      if string.sub(lockValue, 1, #prefix) == prefix then
        return redis.call('EXPIRE', key, ttl)
      else
        return 0
      end
    `;
  }

  async acquireLock(
    resourceKey: string,
    identifier: string,
    options: LockOptions = {}
  ): Promise<LockResult> {
    const {
      ttl = this.DEFAULT_TTL,
      retryDelay = this.DEFAULT_RETRY_DELAY,
      maxRetries = this.DEFAULT_MAX_RETRIES,
    } = options;

    const lockKey = this.getLockKey(resourceKey);
    const lockValue = this.generateLockValue(identifier);
    const ttlSeconds = Math.ceil(ttl / 1000);
    const startTime = Date.now();

    logger.debug("Attempting to acquire lock", {
      resourceKey,
      identifier,
      ttl,
      maxRetries,
    });

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const redis = getRedisClient();
        const result = await redis.set(lockKey, lockValue, "EX", ttlSeconds, "NX");

        if (result === "OK") {
          const acquiredAt = Date.now();
          this.counters.acquireSuccess++;

          logger.info("Lock acquired successfully", {
            resourceKey,
            identifier,
            attempt,
            ttl,
            acquireMs: acquiredAt - startTime,
          });

          return {
            acquired: true,
            lockKey,
            lockValue,
            ttl,
            acquiredAt,
          };
        }

        logger.debug("Lock acquisition failed, retrying", {
          resourceKey,
          identifier,
          attempt,
          maxRetries,
        });

        if (attempt < maxRetries) {
          await this.delay(retryDelay);
        }
      } catch (error) {
        logger.error("Error during lock acquisition", {
          resourceKey,
          identifier,
          attempt,
          error: error instanceof Error ? error.message : "Unknown error",
        });

        if (attempt === maxRetries) {
          this.counters.acquireFailure++;
          return {
            acquired: false,
            lockKey,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }

        await this.delay(retryDelay);
      }
    }

    this.counters.acquireFailure++;

    logger.warn("Failed to acquire lock after max retries", {
      resourceKey,
      identifier,
      maxRetries,
    });

    return {
      acquired: false,
      lockKey,
      error: "Maximum retry attempts exceeded",
    };
  }

  async releaseLock(resourceKey: string, identifier: string): Promise<boolean> {
    const lockKey = this.getLockKey(resourceKey);

    try {
      const redis = getRedisClient();
      const result = await redis.eval(this.releaseLuaScript(), 1, lockKey, identifier);

      const released = result === 1;

      if (released) {
        this.counters.releaseSuccess++;
        logger.info("Lock released successfully", {
          resourceKey,
          identifier,
        });
      } else {
        this.counters.releaseFailure++;
        logger.warn("Lock release failed", {
          resourceKey,
          identifier,
          reason: "Lock not found or not owned by identifier",
        });
      }

      return released;
    } catch (error) {
      this.counters.releaseFailure++;
      logger.error("Error during lock release", {
        resourceKey,
        identifier,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return false;
    }
  }

  async forceReleaseLock(resourceKey: string): Promise<boolean> {
    const lockKey = this.getLockKey(resourceKey);

    try {
      const redis = getRedisClient();
      const result = await redis.del(lockKey);

      if (result === 1) {
        this.counters.forceRelease++;
        logger.info("Lock force-released", { resourceKey });
        return true;
      }

      logger.warn("Force release: lock not found", { resourceKey });
      return false;
    } catch (error) {
      logger.error("Error during force lock release", {
        resourceKey,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return false;
    }
  }

  async extendLock(
    resourceKey: string,
    identifier: string,
    ttl: number
  ): Promise<boolean> {
    const lockKey = this.getLockKey(resourceKey);
    const ttlSeconds = Math.ceil(ttl / 1000);

    try {
      const redis = getRedisClient();
      const result = await redis.eval(this.extendLuaScript(), 1, lockKey, identifier, ttlSeconds);

      const extended = result === 1;

      if (extended) {
        this.counters.extendSuccess++;
        logger.info("Lock extended successfully", {
          resourceKey,
          identifier,
          ttl,
        });
      } else {
        this.counters.extendFailure++;
        logger.warn("Lock extension failed", {
          resourceKey,
          identifier,
          ttl,
          reason: "Lock not found or not owned by identifier",
        });
      }

      return extended;
    } catch (error) {
      this.counters.extendFailure++;
      logger.error("Error during lock extension", {
        resourceKey,
        identifier,
        ttl,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return false;
    }
  }

  /**
   * Renew an owned lock if enough of its TTL has elapsed.
   * Returns true if renewal was attempted and succeeded, false otherwise.
   */
  async renewLock(resourceKey: string, identifier: string, ttl: number): Promise<boolean> {
    const lockKey = this.getLockKey(resourceKey);

    try {
      const redis = getRedisClient();
      const lockValue = await redis.get(lockKey);

      if (!lockValue || !lockValue.startsWith(`${identifier}:`)) {
        this.counters.renewalFailure++;
        return false;
      }

      const ttlResult = await redis.ttl(lockKey);
      const ttlSeconds = Math.ceil(ttl / 1000);

      if (ttlResult === -1 || ttlResult === -2) {
        // Lock expired or missing
        this.counters.renewalFailure++;
        return false;
      }

      const elapsed = ttlSeconds - ttlResult;
      const threshold = Math.floor(ttlSeconds * this.DEFAULT_RENEWAL_THRESHOLD);

      if (elapsed >= threshold) {
        const renewed = await this.extendLock(resourceKey, identifier, ttl);
        if (renewed) {
          this.counters.renewalSuccess++;
          logger.debug("Lock renewed", { resourceKey, identifier, ttl });
        } else {
          this.counters.renewalFailure++;
        }
        return renewed;
      }

      return false;
    } catch (error) {
      this.counters.renewalFailure++;
      logger.error("Error during lock renewal", {
        resourceKey,
        identifier,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return false;
    }
  }

  async isLocked(resourceKey: string): Promise<boolean> {
    const lockKey = this.getLockKey(resourceKey);

    try {
      const redis = getRedisClient();
      const result = await redis.exists(lockKey);
      return result === 1;
    } catch (error) {
      logger.error("Error checking lock status", {
        resourceKey,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return false;
    }
  }

  async getLockInfo(resourceKey: string): Promise<LockInfo | null> {
    const lockKey = this.getLockKey(resourceKey);

    try {
      const redis = getRedisClient();
      const pipeline = redis.pipeline();
      pipeline.get(lockKey);
      pipeline.ttl(lockKey);
      const results = await pipeline.exec();

      if (!results) {
        return null;
      }

      const valueResult = results[0];
      const ttlResult = results[1];

      if (!valueResult || !valueResult[1]) {
        return null;
      }

      const lockValue = valueResult[1] as string;
      const lockTtl = ttlResult[1] as number;

      const ownerId = this.extractOwnerId(lockValue);
      const timestamp = parseInt(lockValue.split(":").pop() || "0", 10);

      return {
        key: resourceKey,
        value: lockValue,
        ownerId,
        ttl: lockTtl > 0 ? lockTtl * 1000 : 0,
        createdAt: timestamp || Date.now(),
      };
    } catch (error) {
      logger.error("Error getting lock info", {
        resourceKey,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return null;
    }
  }

  /**
   * Clean up stale locks (missing TTL or expired).
   * Also collects instrumentation for stale locks encountered.
   */
  async cleanupStaleLocks(pattern: string = "lock:*"): Promise<number> {
    let cleaned = 0;

    try {
      const redis = getRedisClient();
      let cursor = "0";

      do {
        const result = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = result[0];
        const keys = result[1];

        for (const key of keys) {
          const ttl = await redis.ttl(key);
          if (ttl === -1) {
            await redis.del(key);
            cleaned++;
            this.counters.staleCleanup++;
            logger.warn("Cleaned up stale lock (no TTL)", { key });
          }
        }
      } while (cursor !== "0");

      if (cleaned > 0) {
        logger.info("Stale lock cleanup completed", { cleaned });
      }

      return cleaned;
    } catch (error) {
      logger.error("Error during stale lock cleanup", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return cleaned;
    }
  }

  getCounters(): ConcurrencyCounters {
    return { ...this.counters };
  }

  resetCounters(): void {
    this.counters = {
      acquireSuccess: 0,
      acquireFailure: 0,
      releaseSuccess: 0,
      releaseFailure: 0,
      extendSuccess: 0,
      extendFailure: 0,
      forceRelease: 0,
      renewalSuccess: 0,
      renewalFailure: 0,
      staleCleanup: 0,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const redisConcurrencyService = new RedisConcurrencyService();