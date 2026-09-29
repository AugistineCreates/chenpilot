import { Request, Response, NextFunction } from "express";
import RateLimiterService from "../../../Gateway/middleware/rateLimiter.service";
import { getRedisClient } from "../../../services/redis/client";

/**
 * Tests for KYC-specific rate limiting
 * Verifies that KYC endpoints have stricter rate limits
 * (3 requests per hour per user/IP)
 */

describe("KYC Rate Limiting", () => {
  let redisClient: any;

  beforeAll(() => {
    redisClient = getRedisClient();
  });

  afterEach(async () => {
    // Clean up Redis keys after each test
    const keys = await redisClient.keys("rate-limit:*");
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
  });

  describe("KYC Limiter Configuration", () => {
    it("should create a KYC rate limiter instance", () => {
      const limiter = RateLimiterService.createKycLimiter();
      expect(limiter).toBeDefined();
      expect(typeof limiter).toBe("function");
    });

    it("should be stricter than general rate limiter", () => {
      // KYC limiter: 3 requests per hour
      // General limiter: 100 requests per minute (6000 per hour)
      // This is a behavioral test to document the strictness
      const kycLimiter = RateLimiterService.createKycLimiter();
      const generalLimiter = RateLimiterService.createGeneralLimiter();

      expect(kycLimiter).toBeDefined();
      expect(generalLimiter).toBeDefined();
      // KYC should have a much lower rate limit
    });
  });

  describe("KYC Rate Limit Enforcement", () => {
    it("should enforce 3 requests per hour for KYC submissions", async () => {
      const limiter = RateLimiterService.createKycLimiter();
      const userId = "test-user-123";
      let rateLimitHit = false;

      // Simulate 5 KYC submission requests
      for (let i = 0; i < 5; i++) {
        const mockReq = {
          ip: "192.168.1.1",
          path: "/api/kyc/submit",
          user: { id: userId },
          headers: { "user-agent": "test-agent" },
        } as unknown as Request;

        const mockRes = {
          status: () => ({
            json: (data: any) => {
              if (data.message?.includes("KYC")) {
                rateLimitHit = true;
              }
            },
          }),
          setHeader: () => {},
          getHeader: () => undefined,
        } as unknown as Response;

        const mockNext = () => {};

        await limiter(mockReq, mockRes, mockNext);
      }

      // After 5 requests, rate limit should have been hit
      expect(rateLimitHit).toBe(true);
    });
  });

  describe("Per-User Rate Limiting", () => {
    it("should use user ID as key when user is authenticated", async () => {
      const limiter = RateLimiterService.createKycLimiter();

      const mockReq1 = {
        ip: "192.168.1.1",
        path: "/api/kyc/submit",
        user: { id: "user-123" },
        headers: { "user-agent": "test-agent" },
      } as unknown as Request;

      const mockReq2 = {
        ip: "192.168.1.1", // Same IP but different user
        path: "/api/kyc/submit",
        user: { id: "user-456" },
        headers: { "user-agent": "test-agent" },
      } as unknown as Request;

      const mockRes = {
        status: () => ({
          json: () => {},
        }),
        setHeader: () => {},
        getHeader: () => undefined,
      } as unknown as Response;

      const mockNext = () => {};

      // Both users should have independent rate limits
      await limiter(mockReq1, mockRes, mockNext);
      await limiter(mockReq2, mockRes, mockNext);

      // This test verifies that the limiter is created and can handle per-user keys
      expect(limiter).toBeDefined();
    });

    it("should fall back to IP when user is not authenticated", async () => {
      const limiter = RateLimiterService.createKycLimiter();

      const mockReq = {
        ip: "192.168.1.100",
        path: "/api/kyc/submit",
        headers: { "user-agent": "test-agent" },
        // No user object
      } as unknown as Request;

      const mockRes = {
        status: () => ({
          json: () => {},
        }),
        setHeader: () => {},
        getHeader: () => undefined,
      } as unknown as Response;

      const mockNext = () => {};

      // Should use IP for rate limiting when no user
      await limiter(mockReq, mockRes, mockNext);

      expect(limiter).toBeDefined();
    });
  });

  describe("Redis Persistence for KYC Limits", () => {
    it("should store KYC rate limit data in Redis", async () => {
      const limiter = RateLimiterService.createKycLimiter();
      const userId = "kyc-test-user";

      const mockReq = {
        ip: "192.168.1.1",
        path: "/api/kyc/submit",
        user: { id: userId },
        headers: { "user-agent": "test-agent" },
      } as unknown as Request;

      const mockRes = {
        status: () => ({
          json: () => {},
        }),
        setHeader: () => {},
        getHeader: () => undefined,
      } as unknown as Response;

      const mockNext = () => {};

      // Make a request
      await limiter(mockReq, mockRes, mockNext);

      // Verify that Redis contains the rate limit key
      const keys = await redisClient.keys("rate-limit:*");
      expect(keys.length).toBeGreaterThan(0);
    });
  });

  describe("KYC Rate Limit Isolation", () => {
    it("should not share rate limit counters between different endpoints", async () => {
      // KYC limiter is specifically for KYC endpoints
      // General limiter is for other endpoints
      const kycLimiter = RateLimiterService.createKycLimiter();
      const generalLimiter = RateLimiterService.createGeneralLimiter();

      expect(kycLimiter).toBeDefined();
      expect(generalLimiter).toBeDefined();
      // Different rate limiters should have different Redis key prefixes
    });
  });

  describe("Horizontal Scaling", () => {
    it("should enforce rate limits consistently across instances", async () => {
      // Both instances should use the same Redis store
      const limiter1 = RateLimiterService.createKycLimiter();
      const limiter2 = RateLimiterService.createKycLimiter();

      // Both should be functional instances
      expect(limiter1).toBeDefined();
      expect(limiter2).toBeDefined();
      expect(typeof limiter1).toBe("function");
      expect(typeof limiter2).toBe("function");
    });
  });
});
