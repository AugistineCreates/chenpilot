import {
  RateLimiterConfig,
  RateLimitCheckResult,
  RateLimiterStatus,
} from "./types";
import type { AbortSignalLike } from "./types";
import { abortableSleep } from "./abort";

/**
 * Token bucket rate limiter.
 *
 * Prevents hitting Horizon API rate limits by controlling request throughput.
 * Each request consumes one token. Tokens refill at a configured rate per second.
 * Burst requests are allowed up to `burstSize` when the bucket is full.
 */
export class RateLimiter {
  private requestsPerSecond: number;
  private burstSize: number;
  private perEndpoint: boolean;

  private tokens: number;
  private lastRefillTime: number;
  private perEndpointTokens: Map<string, number> = new Map();
  private perEndpointRefillTime: Map<string, number> = new Map();

  private totalChecks: number = 0;
  private limitedRequests: number = 0;

  /**
   * Create a new token bucket rate limiter.
   *
   * @param config - Configuration options
   *
   * @example
   * ```typescript
   * const limiter = new RateLimiter({
   *   requestsPerSecond: 5,
   *   burstSize: 10,
   * });
   *
   * const result = await limiter.checkLimit();
   * if (!result.allowed) {
   *   await new Promise(resolve => setTimeout(resolve, result.retryAfterMs));
   * }
   * ```
   */
  constructor(config: RateLimiterConfig = {}) {
    this.requestsPerSecond = config.requestsPerSecond ?? 1;
    this.burstSize = config.burstSize ?? this.requestsPerSecond;
    this.perEndpoint = config.perEndpoint ?? false;

    if (this.requestsPerSecond <= 0) {
      throw new Error("requestsPerSecond must be positive");
    }
    if (this.burstSize < this.requestsPerSecond) {
      throw new Error("burstSize must be >= requestsPerSecond");
    }

    this.tokens = this.burstSize;
    this.lastRefillTime = Date.now();
  }

  /**
   * Check if a request is allowed under the rate limit.
   *
   * @param endpoint - Optional endpoint identifier for per-endpoint limiting
   * @returns Rate limit check result
   */
  checkLimit(endpoint?: string): RateLimitCheckResult {
    this.totalChecks++;

    if (this.perEndpoint && endpoint) {
      return this.checkPerEndpoint(endpoint);
    }

    return this.checkGlobal();
  }

  /**
   * Wait until a request is allowed, then return.
   *
   * Useful as a guard before making API calls.
   *
   * @param endpoint - Optional endpoint identifier for per-endpoint limiting
   * @param signal - Optional signal to cancel the wait. The pending delay is
   *                 interrupted and the promise rejects with `AbortError`.
   * @example
   * ```typescript
   * await limiter.acquire("getTransaction");
   * // Safe to make RPC call now
   * ```
   */
  async acquire(endpoint?: string, signal?: AbortSignalLike): Promise<void> {
    let result = this.checkLimit(endpoint);
    while (!result.allowed) {
      await abortableSleep(result.retryAfterMs + 1, signal);
      result = this.checkLimit(endpoint);
    }
  }

  /**
   * Get the current limiter status.
   */
  getStatus(): RateLimiterStatus {
    const status: RateLimiterStatus = {
      totalChecks: this.totalChecks,
      limitedRequests: this.limitedRequests,
      tokensAvailable: this.refillTokens(),
    };

    if (this.perEndpoint && this.perEndpointTokens.size > 0) {
      status.perEndpointTokens = {};
      for (const [endpoint] of this.perEndpointTokens.entries()) {
        status.perEndpointTokens[endpoint] = this.getEndpointTokens(endpoint);
      }
    }

    return status;
  }

  /**
   * Reset the limiter to its initial state.
   */
  reset(): void {
    this.tokens = this.burstSize;
    this.lastRefillTime = Date.now();
    this.perEndpointTokens.clear();
    this.perEndpointRefillTime.clear();
    this.totalChecks = 0;
    this.limitedRequests = 0;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private checkGlobal(): RateLimitCheckResult {
    this.tokens = this.refillTokens();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return {
        allowed: true,
        retryAfterMs: 0,
        tokensAvailable: this.tokens,
      };
    }

    this.limitedRequests++;
    const retryAfterMs = this.calculateRetryAfter(1);

    return {
      allowed: false,
      retryAfterMs,
      tokensAvailable: this.tokens,
    };
  }

  private checkPerEndpoint(endpoint: string): RateLimitCheckResult {
    let tokens = this.getEndpointTokens(endpoint);

    if (tokens >= 1) {
      tokens -= 1;
      this.perEndpointTokens.set(endpoint, tokens);
      return {
        allowed: true,
        retryAfterMs: 0,
        tokensAvailable: tokens,
      };
    }

    this.limitedRequests++;
    const retryAfterMs = this.calculateRetryAfter(1);

    return {
      allowed: false,
      retryAfterMs,
      tokensAvailable: tokens,
    };
  }

  private getEndpointTokens(endpoint: string): number {
    const lastRefill = this.perEndpointRefillTime.get(endpoint) ?? Date.now();
    const elapsed = (Date.now() - lastRefill) / 1000;
    const refilled = elapsed * this.requestsPerSecond;
    const tokens = Math.min(
      this.perEndpointTokens.get(endpoint) ?? this.burstSize,
      this.burstSize,
      (this.perEndpointTokens.get(endpoint) ?? this.burstSize) + refilled
    );

    this.perEndpointRefillTime.set(endpoint, Date.now());
    this.perEndpointTokens.set(endpoint, tokens);

    return tokens;
  }

  private refillTokens(): number {
    const now = Date.now();
    const elapsed = (now - this.lastRefillTime) / 1000;
    const refilled = elapsed * this.requestsPerSecond;
    const newTokens = Math.min(this.burstSize, this.tokens + refilled);

    this.lastRefillTime = now;
    this.tokens = newTokens;

    return newTokens;
  }

  private calculateRetryAfter(needed: number): number {
    const current = this.tokens;
    const shortage = needed - current;
    const timeToRefill = (shortage / this.requestsPerSecond) * 1000;
    return Math.ceil(timeToRefill);
  }
}

/**
 * Create a new rate limiter with default settings suitable for Stellar/Horizon.
 *
 * Defaults: 3 requests per second with a burst of 10.
 *
 * @example
 * ```typescript
 * const limiter = createRateLimiter({ requestsPerSecond: 5 });
 * ```
 */
export function createRateLimiter(config: RateLimiterConfig = {}): RateLimiter {
  return new RateLimiter({
    requestsPerSecond: config.requestsPerSecond ?? 3,
    burstSize: config.burstSize ?? 10,
    perEndpoint: config.perEndpoint ?? false,
  });
}
