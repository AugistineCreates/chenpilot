import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  jest,
} from "@jest/globals";
import { PriceCacheService } from "../../src/services/priceCache.service";

const mockRedis = {
  get: jest.fn(),
  setex: jest.fn(),
  mget: jest.fn(),
  del: jest.fn(),
  scan: jest.fn(),
  info: jest.fn(),
  ping: jest.fn(),
  quit: jest.fn(),
  on: jest.fn(),
};

jest.mock("../../src/services/redis/client", () => ({
  getRedisClient: jest.fn(() => mockRedis),
  healthCheckRedis: jest.fn().mockResolvedValue(true),
}));

describe("PriceCacheService", () => {
  let cacheService: PriceCacheService;

  beforeAll(() => {
    cacheService = new PriceCacheService();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    cacheService.resetHitRate();
    mockRedis.scan
      .mockResolvedValueOnce(["0", []])
      .mockResolvedValueOnce(["0", []]);
  });

  describe("setPrice and getPrice", () => {
    it("should cache and retrieve a price", async () => {
      mockRedis.setex.mockResolvedValue("OK");
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ price: 0.12, timestamp: 1000, source: "stellar_dex" })
      );

      await cacheService.setPrice("XLM", "USDC", 0.12, "stellar_dex", 60);
      const cached = await cacheService.getPrice("XLM", "USDC");

      expect(cached).not.toBeNull();
      expect(cached?.price).toBe(0.12);
      expect(cached?.source).toBe("stellar_dex");
      expect(cached?.timestamp).toBe(1000);
    });

    it("should return null for non-existent price", async () => {
      mockRedis.get.mockResolvedValue(null);

      const cached = await cacheService.getPrice("XLM", "USDT");
      expect(cached).toBeNull();
    });

    it("should handle case-insensitive asset symbols", async () => {
      mockRedis.setex.mockResolvedValue("OK");
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ price: 0.12, timestamp: 1000, source: "stellar_dex" })
      );

      await cacheService.setPrice("xlm", "usdc", 0.12, "stellar_dex", 60);
      const cached = await cacheService.getPrice("XLM", "USDC");

      expect(cached).not.toBeNull();
      expect(cached?.price).toBe(0.12);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        "price:XLM:USDC",
        60,
        expect.any(String)
      );
      expect(mockRedis.get).toHaveBeenCalledWith("price:XLM:USDC");
    });
  });

  describe("getPrices", () => {
    it("should retrieve multiple prices at once", async () => {
      mockRedis.setex.mockResolvedValue("OK");
      mockRedis.mget.mockResolvedValue([
        JSON.stringify({ price: 0.12, timestamp: 1000, source: "stellar_dex" }),
        JSON.stringify({ price: 0.11, timestamp: 1000, source: "stellar_dex" }),
        JSON.stringify({ price: 0.99, timestamp: 1000, source: "stellar_dex" }),
      ]);

      await cacheService.setPrice("XLM", "USDC", 0.12, "stellar_dex", 60);
      await cacheService.setPrice("XLM", "USDT", 0.11, "stellar_dex", 60);
      await cacheService.setPrice("USDC", "USDT", 0.99, "stellar_dex", 60);

      const pairs = [
        { from: "XLM", to: "USDC" },
        { from: "XLM", to: "USDT" },
        { from: "USDC", to: "USDT" },
      ];

      const results = await cacheService.getPrices(pairs);

      expect(results.size).toBe(3);
      expect(results.get("XLM/USDC")?.price).toBe(0.12);
      expect(results.get("XLM/USDT")?.price).toBe(0.11);
      expect(results.get("USDC/USDT")?.price).toBe(0.99);
    });

    it("should handle missing prices in batch", async () => {
      mockRedis.mget.mockResolvedValue([
        JSON.stringify({ price: 0.12, timestamp: 1000, source: "stellar_dex" }),
        null,
      ]);

      const pairs = [
        { from: "XLM", to: "USDC" },
        { from: "XLM", to: "USDT" },
      ];

      const results = await cacheService.getPrices(pairs);

      expect(results.size).toBe(2);
      expect(results.get("XLM/USDC")?.price).toBe(0.12);
      expect(results.get("XLM/USDT")).toBeNull();
    });
  });

  describe("invalidatePrice", () => {
    it("should invalidate a cached price", async () => {
      mockRedis.del.mockResolvedValue(1);

      await cacheService.invalidatePrice("XLM", "USDC");

      expect(mockRedis.del).toHaveBeenCalledWith("price:XLM:USDC");
    });
  });

  describe("clearAll", () => {
    it("should clear all cached prices using SCAN", async () => {
      mockRedis.scan
        .mockResolvedValueOnce(["0", ["price:XLM:USDC", "price:XLM:USDT"]])
        .mockResolvedValueOnce(["0", []]);
      mockRedis.del.mockResolvedValue(2);

      await cacheService.clearAll();

      expect(mockRedis.scan).toHaveBeenCalledWith(
        "0",
        "MATCH",
        "price:*",
        "COUNT",
        100
      );
      expect(mockRedis.del).toHaveBeenCalledWith(
        "price:XLM:USDC",
        "price:XLM:USDT"
      );
    });
  });

  describe("getStats", () => {
    it("should return cache statistics with hit rate", async () => {
      mockRedis.scan
        .mockResolvedValueOnce(["0", ["price:XLM:USDC"]])
        .mockResolvedValueOnce(["0", []]);
      mockRedis.info.mockResolvedValue("used_memory_human:1.5M\n");

      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({ price: 0.12, timestamp: 1000, source: "stellar_dex" })
      );
      await cacheService.getPrice("XLM", "USDC");
      mockRedis.get.mockResolvedValueOnce(null);
      await cacheService.getPrice("XLM", "USDT");

      const stats = await cacheService.getStats();

      expect(stats.totalKeys).toBe(1);
      expect(stats.memoryUsage).toBe("1.5M");
      expect(stats.hitRate).toBe(50);
    });
  });

  describe("getHitRate", () => {
    it("should return hit/miss counts and rate", async () => {
      mockRedis.get
        .mockResolvedValueOnce(
          JSON.stringify({ price: 0.12, timestamp: 1000, source: "stellar_dex" })
        )
        .mockResolvedValueOnce(null);

      await cacheService.getPrice("XLM", "USDC");
      await cacheService.getPrice("XLM", "USDT");

      const rate = cacheService.getHitRate();
      expect(rate.hits).toBe(1);
      expect(rate.misses).toBe(1);
      expect(rate.hitRate).toBe(50);
    });
  });

  describe("healthCheck", () => {
    it("should return true when Redis is connected", async () => {
      const healthy = await cacheService.healthCheck();
      expect(healthy).toBe(true);
    });
  });
});
