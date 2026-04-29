/**
 * Rate Limiter for Bot Commands
 * 
 * Implements a sliding window rate limiter to prevent individual users
 * from flooding the bot with commands.
 */

export interface RateLimitConfig {
  maxRequests: number;      // Maximum number of requests allowed
  windowMs: number;         // Time window in milliseconds
}

export interface RateLimitStatus {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

export class RateLimiter {
  private userTimestamps: Map<string, number[]> = new Map();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Check if a request is allowed for a given user
   * 
   * @param userId - The user identifier
   * @returns Rate limit status
   */
  check(userId: string): RateLimitStatus {
    const now = Date.now();
    const timestamps = this.userTimestamps.get(userId) || [];
    
    // Filter out timestamps outside the current window
    const windowStart = now - this.config.windowMs;
    const validTimestamps = timestamps.filter(ts => ts > windowStart);
    
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
      const retryAfter = Math.ceil((oldestTimestamp + this.config.windowMs - now) / 1000);
      
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
  reset(userId: string): void {
    this.userTimestamps.delete(userId);
  }

  /**
   * Clear all rate limit data (useful for testing)
   */
  clear(): void {
    this.userTimestamps.clear();
  }

  /**
   * Get current rate limit status without consuming a request
   * 
   * @param userId - The user identifier
   * @returns Current rate limit status
   */
  getStatus(userId: string): RateLimitStatus {
    const now = Date.now();
    const timestamps = this.userTimestamps.get(userId) || [];
    
    // Filter out timestamps outside the current window
    const windowStart = now - this.config.windowMs;
    const validTimestamps = timestamps.filter(ts => ts > windowStart);
    
    const requestCount = validTimestamps.length;
    const remaining = Math.max(0, this.config.maxRequests - requestCount);
    const allowed = requestCount < this.config.maxRequests;
    
    let retryAfter: number | undefined;
    if (!allowed && validTimestamps.length > 0) {
      const oldestTimestamp = validTimestamps[0];
      retryAfter = Math.ceil((oldestTimestamp + this.config.windowMs - now) / 1000);
    }
    
    return {
      allowed,
      remaining,
      resetTime: now + this.config.windowMs,
      retryAfter,
    };
  }
}

// Default rate limit configuration
export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 10,      // 10 requests
  windowMs: 60000,      // per minute (60 seconds)
};

// Strict rate limit for sensitive operations
export const STRICT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 3,       // 3 requests
  windowMs: 60000,      // per minute
};
