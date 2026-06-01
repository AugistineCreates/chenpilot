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
const globals_1 = require("@jest/globals");
const priceCache_service_1 = require("../../src/services/priceCache.service");
(0, globals_1.describe)("PriceCacheService", () => {
  let cacheService;
  (0, globals_1.beforeAll)(() => {
    cacheService = new priceCache_service_1.PriceCacheService();
  });
  (0, globals_1.afterAll)(() =>
    __awaiter(void 0, void 0, void 0, function* () {
      yield cacheService.disconnect();
    })
  );
  (0, globals_1.beforeEach)(() =>
    __awaiter(void 0, void 0, void 0, function* () {
      yield cacheService.clearAll();
    })
  );
  (0, globals_1.describe)("setPrice and getPrice", () => {
    (0, globals_1.it)("should cache and retrieve a price", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield cacheService.setPrice("XLM", "USDC", 0.12, "stellar_dex", 60);
        const cached = yield cacheService.getPrice("XLM", "USDC");
        (0, globals_1.expect)(cached).not.toBeNull();
        (0, globals_1.expect)(
          cached === null || cached === void 0 ? void 0 : cached.price
        ).toBe(0.12);
        (0, globals_1.expect)(
          cached === null || cached === void 0 ? void 0 : cached.source
        ).toBe("stellar_dex");
        (0, globals_1.expect)(
          cached === null || cached === void 0 ? void 0 : cached.timestamp
        ).toBeLessThanOrEqual(Date.now());
      })
    );
    (0, globals_1.it)("should return null for non-existent price", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const cached = yield cacheService.getPrice("XLM", "USDT");
        (0, globals_1.expect)(cached).toBeNull();
      })
    );
    (0, globals_1.it)("should handle case-insensitive asset symbols", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield cacheService.setPrice("xlm", "usdc", 0.12, "stellar_dex", 60);
        const cached = yield cacheService.getPrice("XLM", "USDC");
        (0, globals_1.expect)(cached).not.toBeNull();
        (0, globals_1.expect)(
          cached === null || cached === void 0 ? void 0 : cached.price
        ).toBe(0.12);
      })
    );
    (0, globals_1.it)(
      "should expire after TTL",
      () =>
        __awaiter(void 0, void 0, void 0, function* () {
          yield cacheService.setPrice("XLM", "USDC", 0.12, "stellar_dex", 1);
          // Wait for expiration
          yield new Promise((resolve) => setTimeout(resolve, 1500));
          const cached = yield cacheService.getPrice("XLM", "USDC");
          (0, globals_1.expect)(cached).toBeNull();
        }),
      10000
    );
  });
  (0, globals_1.describe)("getPrices", () => {
    (0, globals_1.it)("should retrieve multiple prices at once", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        yield cacheService.setPrice("XLM", "USDC", 0.12, "stellar_dex", 60);
        yield cacheService.setPrice("XLM", "USDT", 0.11, "stellar_dex", 60);
        yield cacheService.setPrice("USDC", "USDT", 0.99, "stellar_dex", 60);
        const pairs = [
          { from: "XLM", to: "USDC" },
          { from: "XLM", to: "USDT" },
          { from: "USDC", to: "USDT" },
        ];
        const results = yield cacheService.getPrices(pairs);
        (0, globals_1.expect)(results.size).toBe(3);
        (0, globals_1.expect)(
          (_a = results.get("XLM/USDC")) === null || _a === void 0
            ? void 0
            : _a.price
        ).toBe(0.12);
        (0, globals_1.expect)(
          (_b = results.get("XLM/USDT")) === null || _b === void 0
            ? void 0
            : _b.price
        ).toBe(0.11);
        (0, globals_1.expect)(
          (_c = results.get("USDC/USDT")) === null || _c === void 0
            ? void 0
            : _c.price
        ).toBe(0.99);
      })
    );
    (0, globals_1.it)("should handle missing prices in batch", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        yield cacheService.setPrice("XLM", "USDC", 0.12, "stellar_dex", 60);
        const pairs = [
          { from: "XLM", to: "USDC" },
          { from: "XLM", to: "USDT" },
        ];
        const results = yield cacheService.getPrices(pairs);
        (0, globals_1.expect)(results.size).toBe(2);
        (0, globals_1.expect)(
          (_a = results.get("XLM/USDC")) === null || _a === void 0
            ? void 0
            : _a.price
        ).toBe(0.12);
        (0, globals_1.expect)(results.get("XLM/USDT")).toBeNull();
      })
    );
  });
  (0, globals_1.describe)("invalidatePrice", () => {
    (0, globals_1.it)("should invalidate a cached price", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield cacheService.setPrice("XLM", "USDC", 0.12, "stellar_dex", 60);
        let cached = yield cacheService.getPrice("XLM", "USDC");
        (0, globals_1.expect)(cached).not.toBeNull();
        yield cacheService.invalidatePrice("XLM", "USDC");
        cached = yield cacheService.getPrice("XLM", "USDC");
        (0, globals_1.expect)(cached).toBeNull();
      })
    );
  });
  (0, globals_1.describe)("clearAll", () => {
    (0, globals_1.it)("should clear all cached prices", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield cacheService.setPrice("XLM", "USDC", 0.12, "stellar_dex", 60);
        yield cacheService.setPrice("XLM", "USDT", 0.11, "stellar_dex", 60);
        yield cacheService.clearAll();
        const cached1 = yield cacheService.getPrice("XLM", "USDC");
        const cached2 = yield cacheService.getPrice("XLM", "USDT");
        (0, globals_1.expect)(cached1).toBeNull();
        (0, globals_1.expect)(cached2).toBeNull();
      })
    );
  });
  (0, globals_1.describe)("getStats", () => {
    (0, globals_1.it)("should return cache statistics", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        yield cacheService.setPrice("XLM", "USDC", 0.12, "stellar_dex", 60);
        yield cacheService.setPrice("XLM", "USDT", 0.11, "stellar_dex", 60);
        const stats = yield cacheService.getStats();
        (0, globals_1.expect)(stats.totalKeys).toBe(2);
        (0, globals_1.expect)(stats.memoryUsage).toBeDefined();
      })
    );
  });
  (0, globals_1.describe)("healthCheck", () => {
    (0, globals_1.it)("should return true when Redis is connected", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const healthy = yield cacheService.healthCheck();
        (0, globals_1.expect)(healthy).toBe(true);
      })
    );
  });
});
