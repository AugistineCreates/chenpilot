"use strict";
/**
 * Market Overview Service
 *
 * Fetches and formats daily market summaries of top-performing Stellar assets
 * for automated daily digest posts in Discord channels.
 */
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
exports.MarketOverviewService = void 0;
class MarketOverviewService {
  constructor() {
    this.BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";
  }
  /**
   * Fetch market overview data from the backend
   */
  fetchMarketOverview() {
    return __awaiter(this, void 0, void 0, function* () {
      var _a, _b;
      try {
        // Fetch top gainers
        const gainersRes = yield fetch(
          `${this.BACKEND_URL}/api/assets/trending?sort=price_change&order=desc&limit=5`
        );
        const topGainers = gainersRes.ok ? yield gainersRes.json() : [];
        // Fetch top losers
        const losersRes = yield fetch(
          `${this.BACKEND_URL}/api/assets/trending?sort=price_change&order=asc&limit=5`
        );
        const topLosers = losersRes.ok ? yield losersRes.json() : [];
        // Fetch top by volume
        const volumeRes = yield fetch(
          `${this.BACKEND_URL}/api/assets/trending?sort=volume&order=desc&limit=5`
        );
        const topVolume = volumeRes.ok ? yield volumeRes.json() : [];
        // Fetch network status
        let networkStatus;
        try {
          const statusRes = yield fetch(
            `${this.BACKEND_URL}/api/network/status`
          );
          if (statusRes.ok) {
            const statusData = yield statusRes.json();
            networkStatus = {
              isHealthy:
                ((_a = statusData.health) === null || _a === void 0
                  ? void 0
                  : _a.isHealthy) || false,
              latestLedger:
                ((_b = statusData.health) === null || _b === void 0
                  ? void 0
                  : _b.latestLedger) || 0,
            };
          }
        } catch (_c) {
          // Network status fetch failed, continue without it
        }
        return {
          timestamp: new Date().toISOString(),
          topGainers,
          topLosers,
          topVolume,
          networkStatus,
        };
      } catch (error) {
        console.error("Error fetching market overview:", error);
        throw new Error("Failed to fetch market overview data");
      }
    });
  }
  /**
   * Format market overview data for Discord message
   */
  formatMarketOverviewMessage(data) {
    const date = new Date(data.timestamp).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    let message = `📊 **Daily Market Overview - ${date}**\n\n`;
    // Network status
    if (data.networkStatus) {
      const healthEmoji = data.networkStatus.isHealthy ? "🟢" : "🔴";
      message += `${healthEmoji} **Stellar Network Status:** Ledger ${data.networkStatus.latestLedger}\n\n`;
    }
    // Top Gainers
    message += `📈 **Top Gainers (24h)**\n`;
    if (data.topGainers.length === 0) {
      message += `No data available\n`;
    } else {
      for (const asset of data.topGainers) {
        const change =
          asset.priceChange24h >= 0
            ? `+${asset.priceChange24h.toFixed(2)}%`
            : `${asset.priceChange24h.toFixed(2)}%`;
        message += `• **${asset.code}** ${asset.domain ? `(${asset.domain})` : ""}\n`;
        message += `  Price: $${asset.price.toFixed(4)} | 24h: ${change} | Vol: ${this.formatNumber(asset.volume24h)}\n`;
      }
    }
    message += `\n`;
    // Top Losers
    message += `📉 **Top Losers (24h)**\n`;
    if (data.topLosers.length === 0) {
      message += `No data available\n`;
    } else {
      for (const asset of data.topLosers) {
        const change =
          asset.priceChange24h >= 0
            ? `+${asset.priceChange24h.toFixed(2)}%`
            : `${asset.priceChange24h.toFixed(2)}%`;
        message += `• **${asset.code}** ${asset.domain ? `(${asset.domain})` : ""}\n`;
        message += `  Price: $${asset.price.toFixed(4)} | 24h: ${change} | Vol: ${this.formatNumber(asset.volume24h)}\n`;
      }
    }
    message += `\n`;
    // Top by Volume
    message += `💰 **Top by Volume (24h)**\n`;
    if (data.topVolume.length === 0) {
      message += `No data available\n`;
    } else {
      for (const asset of data.topVolume) {
        const change =
          asset.priceChange24h >= 0
            ? `+${asset.priceChange24h.toFixed(2)}%`
            : `${asset.priceChange24h.toFixed(2)}%`;
        message += `• **${asset.code}** ${asset.domain ? `(${asset.domain})` : ""}\n`;
        message += `  Price: $${asset.price.toFixed(4)} | 24h: ${change} | Vol: ${this.formatNumber(asset.volume24h)}\n`;
      }
    }
    message += `\n*Data provided by Chen Pilot*`;
    return message;
  }
  /**
   * Format large numbers for readability
   */
  formatNumber(num) {
    if (num >= 1000000000) {
      return `${(num / 1000000000).toFixed(2)}B`;
    }
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(2)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(2)}K`;
    }
    return num.toFixed(2);
  }
}
exports.MarketOverviewService = MarketOverviewService;
