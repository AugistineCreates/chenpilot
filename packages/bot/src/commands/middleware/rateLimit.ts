/**
 * Rate Limiting Middleware
 * Enforces rate limits on command execution
 */

import {
  CommandMiddleware,
  TypedCommandContext,
  TypedCommandResult,
  CommandError,
  ErrorCode,
} from '../types.js';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export function createRateLimitMiddleware<TInput>(
  maxRequests: number,
  windowMs: number,
  skipFailedRequests = false
): CommandMiddleware<TInput> {
  const rateLimits = new Map<string, RateLimitEntry>();

  return async (context: TypedCommandContext<TInput>, next) => {
    const now = Date.now();
    const userId = context.userId;
    const entry = rateLimits.get(userId);

    // Reset if window expired
    if (!entry || now > entry.resetTime) {
      rateLimits.set(userId, {
        count: 1,
        resetTime: now + windowMs,
      });
      return next();
    }

    // Check if limit exceeded
    if (entry.count >= maxRequests) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      return {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Rate limit exceeded. Try again in ${retryAfter} seconds`,
          recoverable: true,
          userMessage: `Please wait ${retryAfter} seconds before trying again`,
        },
      };
    }

    // Increment count
    entry.count++;

    try {
      const result = await next();
      
      // Decrement count if failed and skipFailedRequests is true
      if (!result.success && skipFailedRequests) {
        entry.count--;
      }

      return result;
    } catch (error) {
      if (skipFailedRequests) {
        entry.count--;
      }
      throw error;
    }
  };
}
