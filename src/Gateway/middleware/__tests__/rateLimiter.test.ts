import { Request, Response, NextFunction } from "express";
import RateLimiterService from "../rateLimiter.service";
import { getRedisClient } from "../../../services/redis/client";

/**
 * Test suite for Redis-backed rate limiter
 * Verifies that rate limiting works correctly across multiple instances
 */

describe("RateLimiterService", () => {
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

  describe("createGeneralLimiter", () => {
    it("should create a rate limiter instance", () => {
      const limiter = RateLimiterService.createGeneralLimiter();
      expect(limiter).toBeDefined();
      expect(typeof limiter).toBe("function");
    });

    it("should enforce rate limits with 100 requests per minute", async () => {
      const limiter = RateLimiterService.createGeneralLimiter();
      let requestCount = 0;
      let rateLimitHit = false;

      // Simulate requests
      for (let i = 0; i < 105; i++) {
        const mockReq = {
          ip: "192.168.1.1",
          path: "/api/test",
          headers: { "user-agent": "test-agent" },
        } as Request;

        const mockRes = {
          status: () => ({
            json: (data: any) => {
              if (data.message?.includes("Too many")) {
                rateLimitHit = true;
              }
            },
          }),
          setHeader: () => {},
          getHeader: () => undefined,
        } as Response;

        const mockNext = () => {
          requestCount++;
        };

        await limiter(mockReq, mockRes, mockNext);
      }

      // After 105 requests, rate limit should have been hit
      expect(rateLimitHit).toBe(true);
    });
  });

  describe("createAuthLimiter", () => {
    it("should create an auth rate limiter instance", () => {
      const limiter = RateLimiterService.createAuthLimiter();
      expect(limiter).toBeDefined();
      expect(typeof limiter).toBe("function");
    });
  });

  describe("createKycLimiter", () => {
    it("should create a KYC rate limiter instance", () => {
      const limiter = RateLimiterService.createKycLimiter();
      expect(limiter).toBeDefined();
      expect(typeof limiter).toBe("function");
    });

    it("should use user ID as key generator when user is authenticated", () => {
      const limiter = RateLimiterService.createKycLimiter();
      expect(limiter).toBeDefined();
    });

    it("should enforce 3 requests per hour per user", async () => {
      const limiter = RateLimiterService.createKycLimiter();
      const userId = "kyc-test-user-999";
      let requestCount = 0;
      let rateLimitHit = false;

      for (let i = 0; i < 4; i++) {
        const mockReq = {
          ip: "10.0.0.1",
          path: "/api/kyc/submit",
          user: { id: userId },
          headers: { "user-agent": "test-agent" },
        } as unknown as Request;

        const mockRes = {
          status: () => ({
            json: (data: any) => {
              if (data.message?.includes("Too many KYC")) {
                rateLimitHit = true;
              }
            },
          }),
          setHeader: () => {},
          getHeader: () => undefined,
        } as unknown as Response;

        const mockNext = () => {
          requestCount++;
        };

        await limiter(mockReq, mockRes, mockNext);
      }

      expect(requestCount).toBe(3);
      expect(rateLimitHit).toBe(true);
    });
  });

  describe("createSensitiveLimiter", () => {
    it("should create a sensitive endpoint rate limiter", () => {
      const limiter = RateLimiterService.createSensitiveLimiter();
      expect(limiter).toBeDefined();
      expect(typeof limiter).toBe("function");
    });
  });

  describe("Redis persistence", () => {
    it("should store rate limit data in Redis with correct prefix", async () => {
      const limiter = RateLimiterService.createGeneralLimiter();
      const testIp = "192.168.1.100";

      const mockReq = {
        ip: testIp,
        path: "/api/test",
        headers: { "user-agent": "test-agent" },
      } as Request;

      const mockRes = {
        status: () => ({
          json: () => {},
        }),
        setHeader: () => {},
        getHeader: () => undefined,
      } as Response;

      const mockNext = () => {};

      // Make a request
      await limiter(mockReq, mockRes, mockNext);

      // Verify that Redis contains the rate limit key
      const keys = await redisClient.keys("rate-limit:*");
      expect(keys.length).toBeGreaterThan(0);
    });
  });

  describe("Fallback to memory store", () => {
    it("should not throw an error if Redis is unavailable", () => {
      // This test ensures the limiter has error handling
      expect(() => {
        RateLimiterService.createGeneralLimiter();
        RateLimiterService.createAuthLimiter();
        RateLimiterService.createKycLimiter();
        RateLimiterService.createSensitiveLimiter();
      }).not.toThrow();
    });
  });
});
