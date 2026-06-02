"use strict";
/**
 * Rate Limiter for Bot Commands
 *
 * Implements a sliding window rate limiter to prevent individual users
 * from flooding the bot with commands.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STRICT_RATE_LIMIT =
  exports.DEFAULT_RATE_LIMIT =
  exports.RateLimiter =
    void 0;
class RateLimiter {
  constructor(config) {
    this.userTimestamps = new Map();
    this.config = config;
  }
  /**
   * Check if a request is allowed for a given user
   *
   * @param userId - The user identifier
   * @returns Rate limit status
   */
  check(userId) {
    const now = Date.now();
    const timestamps = this.userTimestamps.get(userId) || [];
    // Filter out timestamps outside the current window
    const windowStart = now - this.config.windowMs;
    const validTimestamps = timestamps.filter((ts) => ts > windowStart);
    // Update the stored timestamps
    this.userTimestamps.set(userId, validTimestamps);
    const requestCount = validTimestamps.length;
    const remaining = Math.max(0, this.config.maxRequests - requestCount);
    const allowed = requestCount < this.config.maxRequests;
    if (allowed) {
      // Add current timestamp
      validTimestamps.push(now);
      this.userTimestamps.set(userId, validTimestamps);
    } else {
      // Calculate retry after time (when oldest request expires)
      const oldestTimestamp = validTimestamps[0];
      const retryAfter = Math.ceil(
        (oldestTimestamp + this.config.windowMs - now) / 1000
      );
      return {
        allowed: false,
        remaining: 0,
        resetTime: oldestTimestamp + this.config.windowMs,
        retryAfter,
      };
    }
    return {
      allowed: true,
      remaining: remaining - 1,
      resetTime: now + this.config.windowMs,
    };
  }
  /**
   * Reset rate limit for a specific user
   *
   * @param userId - The user identifier
   */
  reset(userId) {
    this.userTimestamps.delete(userId);
  }
  /**
   * Clear all rate limit data (useful for testing)
   */
  clear() {
    this.userTimestamps.clear();
  }
  /**
   * Get current rate limit status without consuming a request
   *
   * @param userId - The user identifier
   * @returns Current rate limit status
   */
  getStatus(userId) {
    const now = Date.now();
    const timestamps = this.userTimestamps.get(userId) || [];
    // Filter out timestamps outside the current window
    const windowStart = now - this.config.windowMs;
    const validTimestamps = timestamps.filter((ts) => ts > windowStart);
    const requestCount = validTimestamps.length;
    const remaining = Math.max(0, this.config.maxRequests - requestCount);
    const allowed = requestCount < this.config.maxRequests;
    let retryAfter;
    if (!allowed && validTimestamps.length > 0) {
      const oldestTimestamp = validTimestamps[0];
      retryAfter = Math.ceil(
        (oldestTimestamp + this.config.windowMs - now) / 1000
      );
    }
    return {
      allowed,
      remaining,
      resetTime: now + this.config.windowMs,
      retryAfter,
    };
  }
}
exports.RateLimiter = RateLimiter;
// Default rate limit configuration
exports.DEFAULT_RATE_LIMIT = {
  maxRequests: 10, // 10 requests
  windowMs: 60000, // per minute (60 seconds)
};
// Strict rate limit for sensitive operations
exports.STRICT_RATE_LIMIT = {
  maxRequests: 3, // 3 requests
  windowMs: 60000, // per minute
};
