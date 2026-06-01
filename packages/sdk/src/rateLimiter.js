"use strict";
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done
          ? resolve(result.value)
          : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimiter = void 0;
exports.createRateLimiter = createRateLimiter;
/**
 * Token bucket rate limiter.
 *
 * Prevents hitting Horizon API rate limits by controlling request throughput.
 * Each request consumes one token. Tokens refill at a configured rate per second.
 * Burst requests are allowed up to `burstSize` when the bucket is full.
 */
class RateLimiter {
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
  constructor(config = {}) {
    var _a, _b, _c;
    this.perEndpointTokens = new Map();
    this.perEndpointRefillTime = new Map();
    this.totalChecks = 0;
    this.limitedRequests = 0;
    this.requestsPerSecond =
      (_a = config.requestsPerSecond) !== null && _a !== void 0 ? _a : 1;
    this.burstSize =
      (_b = config.burstSize) !== null && _b !== void 0
        ? _b
        : this.requestsPerSecond;
    this.perEndpoint =
      (_c = config.perEndpoint) !== null && _c !== void 0 ? _c : false;
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
  checkLimit(endpoint) {
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
   * @example
   * ```typescript
   * await limiter.acquire("getTransaction");
   * // Safe to make RPC call now
   * ```
   */
  acquire(endpoint) {
    return __awaiter(this, void 0, void 0, function* () {
      let result = this.checkLimit(endpoint);
      while (!result.allowed) {
        yield new Promise((resolve) =>
          setTimeout(resolve, result.retryAfterMs + 1)
        );
        result = this.checkLimit(endpoint);
      }
    });
  }
  /**
   * Get the current limiter status.
   */
  getStatus() {
    const status = {
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
  reset() {
    this.tokens = this.burstSize;
    this.lastRefillTime = Date.now();
    this.perEndpointTokens.clear();
    this.perEndpointRefillTime.clear();
    this.totalChecks = 0;
    this.limitedRequests = 0;
  }
  // ─── Private helpers ────────────────────────────────────────────────────────
  checkGlobal() {
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
  checkPerEndpoint(endpoint) {
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
  getEndpointTokens(endpoint) {
    var _a, _b, _c;
    const lastRefill =
      (_a = this.perEndpointRefillTime.get(endpoint)) !== null && _a !== void 0
        ? _a
        : Date.now();
    const elapsed = (Date.now() - lastRefill) / 1000;
    const refilled = elapsed * this.requestsPerSecond;
    const tokens = Math.min(
      (_b = this.perEndpointTokens.get(endpoint)) !== null && _b !== void 0
        ? _b
        : this.burstSize,
      this.burstSize,
      ((_c = this.perEndpointTokens.get(endpoint)) !== null && _c !== void 0
        ? _c
        : this.burstSize) + refilled
    );
    this.perEndpointRefillTime.set(endpoint, Date.now());
    this.perEndpointTokens.set(endpoint, tokens);
    return tokens;
  }
  refillTokens() {
    const now = Date.now();
    const elapsed = (now - this.lastRefillTime) / 1000;
    const refilled = elapsed * this.requestsPerSecond;
    const newTokens = Math.min(this.burstSize, this.tokens + refilled);
    this.lastRefillTime = now;
    this.tokens = newTokens;
    return newTokens;
  }
  calculateRetryAfter(needed) {
    const current = this.tokens;
    const shortage = needed - current;
    const timeToRefill = (shortage / this.requestsPerSecond) * 1000;
    return Math.ceil(timeToRefill);
  }
}
exports.RateLimiter = RateLimiter;
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
function createRateLimiter(config = {}) {
  var _a, _b, _c;
  return new RateLimiter({
    requestsPerSecond:
      (_a = config.requestsPerSecond) !== null && _a !== void 0 ? _a : 3,
    burstSize: (_b = config.burstSize) !== null && _b !== void 0 ? _b : 10,
    perEndpoint:
      (_c = config.perEndpoint) !== null && _c !== void 0 ? _c : false,
  });
}
