import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { StellarPriceService } from "../../src/services/stellarPrice.service";
import priceCacheService from "../../src/services/priceCache.service";

jest.mock("../../src/services/priceCache.service", () => ({
  __esModule: true,
  default: {
    getPrice: jest.fn(),
    setPrice: jest.fn(),
    invalidatePrice: jest.fn(),
  },
}));

jest.mock("@stellar/stellar-sdk");

const mockGetPrice = priceCacheService.getPrice as jest.Mock;

function freshCacheResult(price: number) {
  return {
    data: { price, timestamp: Date.now(), source: "stellar_dex" },
    fresh: true,
    ageMs: 100,
  };
}

describe("StellarPriceService", () => {
  let priceService: StellarPriceService;

  beforeEach(() => {
    priceService = new StellarPriceService();
    jest.clearAllMocks();
  });

  describe("getPrice — QuoteValidity contract", () => {
    it("returns a valid quote from fresh cache", async () => {
      mockGetPrice.mockResolvedValue(freshCacheResult(0.12));

      const quote = await priceService.getPrice("XLM", "USDC", 100);

      expect(quote.cached).toBe(true);
      expect(quote.price).toBe(0.12);
      expect(quote.estimatedOutput).toBe(12);
      expect(quote.validity.valid).toBe(true);
      expect(quote.validity.ageMs).toBeGreaterThanOrEqual(0);
      expect(quote.validity.expiresAt).toBeGreaterThan(Date.now() - 1000);
    });

    it("does NOT use stale cache — returns invalid quote instead", async () => {
      // Stale cache entry (fresh=false)
      mockGetPrice.mockResolvedValue({
        data: {
          price: 0.12,
          timestamp: Date.now() - 120_000,
          source: "stellar_dex",
        },
        fresh: false,
        ageMs: 120_000,
      });

      // No live Horizon server available in tests → fetch_error
      const quote = await priceService.getPrice("XLM", "USDC", 100);

      expect(quote.validity.valid).toBe(false);
      expect(quote.validity.reason).toBe("fetch_error");
      expect(quote.price).toBe(0);
    });

    it("returns invalid quote with reason=unsupported_asset for unknown symbols", async () => {
      mockGetPrice.mockResolvedValue(null);

      const quote = await priceService.getPrice("DOGE", "USDC", 100);

      expect(quote.validity.valid).toBe(false);
      expect(quote.validity.reason).toBe("unsupported_asset");
      expect(quote.price).toBe(0);
      expect(quote.estimatedOutput).toBe(0);
    });

    it("returns invalid quote with reason=fetch_error when Horizon fails", async () => {
      mockGetPrice.mockResolvedValue(null); // no cache

      const quote = await priceService.getPrice("XLM", "USDC", 100);

      expect(quote.validity.valid).toBe(false);
      expect(quote.validity.reason).toBe("fetch_error");
    });
  });

  describe("getPrices — batch", () => {
    it("returns one quote per pair, each with validity", async () => {
      mockGetPrice.mockResolvedValue(freshCacheResult(0.12));

      const quotes = await priceService.getPrices([
        { from: "XLM", to: "USDC", amount: 100 },
        { from: "XLM", to: "USDT", amount: 50 },
      ]);

      expect(quotes).toHaveLength(2);
      quotes.forEach((q) => expect(q.validity).toBeDefined());
    });

    it("returns invalid quotes (not throws) for unsupported assets in batch", async () => {
      mockGetPrice.mockResolvedValue(freshCacheResult(0.12));

      const quotes = await priceService.getPrices([
        { from: "XLM", to: "USDC" },
        { from: "DOGE", to: "USDC" },
      ]);

      expect(quotes).toHaveLength(2);
      expect(quotes[0].validity.valid).toBe(true);
      expect(quotes[1].validity.valid).toBe(false);
      expect(quotes[1].validity.reason).toBe("unsupported_asset");
    });
  });

  describe("invalidatePrice", () => {
    it("delegates to cache service", async () => {
      await priceService.invalidatePrice("XLM", "USDC");
      expect(priceCacheService.invalidatePrice).toHaveBeenCalledWith(
        "XLM",
        "USDC"
      );
    });
  });
});
