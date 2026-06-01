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
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const stellarPrice_service_1 = require("../../src/services/stellarPrice.service");
const priceCache_service_1 = __importDefault(
  require("../../src/services/priceCache.service")
);
// Mock the price cache service
globals_1.jest.mock("../../src/services/priceCache.service", () => ({
  __esModule: true,
  default: {
    getPrice: globals_1.jest.fn(),
    setPrice: globals_1.jest.fn(),
    invalidatePrice: globals_1.jest.fn(),
  },
}));
(0, globals_1.describe)("StellarPriceService", () => {
  let priceService;
  (0, globals_1.beforeEach)(() => {
    priceService = new stellarPrice_service_1.StellarPriceService();
    globals_1.jest.clearAllMocks();
  });
  (0, globals_1.describe)("getPrice", () => {
    (0, globals_1.it)("should return cached price if available", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockCachedPrice = {
          price: 0.12,
          timestamp: Date.now(),
          source: "stellar_dex",
        };
        priceCache_service_1.default.getPrice.mockResolvedValue(
          mockCachedPrice
        );
        const quote = yield priceService.getPrice("XLM", "USDC", 100);
        (0, globals_1.expect)(quote.cached).toBe(true);
        (0, globals_1.expect)(quote.price).toBe(0.12);
        (0, globals_1.expect)(quote.estimatedOutput).toBe(12);
        (0, globals_1.expect)(
          priceCache_service_1.default.getPrice
        ).toHaveBeenCalledWith("XLM", "USDC");
      })
    );
    (0, globals_1.it)("should fetch from Stellar DEX if not cached", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        priceCache_service_1.default.getPrice.mockResolvedValue(null);
        // This will fail in test environment without actual Stellar connection
        // but we're testing the flow
        yield (0, globals_1.expect)(
          priceService.getPrice("XLM", "USDC", 100)
        ).rejects.toThrow();
        (0, globals_1.expect)(
          priceCache_service_1.default.getPrice
        ).toHaveBeenCalledWith("XLM", "USDC");
      })
    );
    (0, globals_1.it)("should throw error for unsupported asset", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        priceCache_service_1.default.getPrice.mockResolvedValue(null);
        yield (0, globals_1.expect)(
          priceService.getPrice("INVALID", "USDC", 100)
        ).rejects.toThrow("Unsupported asset: INVALID");
      })
    );
  });
  (0, globals_1.describe)("getPrices", () => {
    (0, globals_1.it)("should fetch multiple prices", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockCachedPrice = {
          price: 0.12,
          timestamp: Date.now(),
          source: "stellar_dex",
        };
        priceCache_service_1.default.getPrice.mockResolvedValue(
          mockCachedPrice
        );
        const pairs = [
          { from: "XLM", to: "USDC", amount: 100 },
          { from: "XLM", to: "USDT", amount: 50 },
        ];
        const quotes = yield priceService.getPrices(pairs);
        (0, globals_1.expect)(quotes.length).toBe(2);
        (0, globals_1.expect)(quotes[0].fromAsset).toBe("XLM");
        (0, globals_1.expect)(quotes[0].toAsset).toBe("USDC");
        (0, globals_1.expect)(quotes[1].fromAsset).toBe("XLM");
        (0, globals_1.expect)(quotes[1].toAsset).toBe("USDT");
      })
    );
    (0, globals_1.it)("should handle errors gracefully in batch", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        priceCache_service_1.default.getPrice
          .mockResolvedValueOnce({
            price: 0.12,
            timestamp: Date.now(),
            source: "stellar_dex",
          })
          .mockResolvedValueOnce(null);
        const pairs = [
          { from: "XLM", to: "USDC" },
          { from: "INVALID", to: "USDT" },
        ];
        const quotes = yield priceService.getPrices(pairs);
        // Should return only successful quotes
        (0, globals_1.expect)(quotes.length).toBe(1);
        (0, globals_1.expect)(quotes[0].fromAsset).toBe("XLM");
      })
    );
  });
  (0, globals_1.describe)("invalidatePrice", () => {
    (0, globals_1.it)("should call cache invalidation", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield priceService.invalidatePrice("XLM", "USDC");
        (0, globals_1.expect)(
          priceCache_service_1.default.invalidatePrice
        ).toHaveBeenCalledWith("XLM", "USDC");
      })
    );
  });
});
