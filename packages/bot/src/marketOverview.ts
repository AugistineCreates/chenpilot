/**
 * Market Overview Service
 *
 * Fetches and formats daily market summaries of top-performing Stellar assets
 * for automated daily digest posts in Discord channels.
 */

export interface AssetData {
  code: string;
  issuer?: string;
  domain?: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  holders?: number;
}

export interface MarketOverviewData {
  timestamp: string;
  topGainers: AssetData[];
  topLosers: AssetData[];
  topVolume: AssetData[];
  networkStatus?: {
    isHealthy: boolean;
    latestLedger: number;
  };
}

export class MarketOverviewService {
  private readonly BACKEND_URL =
    process.env.BACKEND_URL || "http://localhost:3000";

  /**
   * Fetch market overview data from the backend
   */
  async fetchMarketOverview(): Promise<MarketOverviewData> {
    try {
      // Fetch top gainers
      const gainersRes = await fetch(
        `${this.BACKEND_URL}/api/assets/trending?sort=price_change&order=desc&limit=5`
      );
      const topGainers = gainersRes.ok
        ? ((await gainersRes.json()) as AssetData[])
        : [];

      // Fetch top losers
      const losersRes = await fetch(
        `${this.BACKEND_URL}/api/assets/trending?sort=price_change&order=asc&limit=5`
      );
      const topLosers = losersRes.ok
        ? ((await losersRes.json()) as AssetData[])
        : [];

      // Fetch top by volume
      const volumeRes = await fetch(
        `${this.BACKEND_URL}/api/assets/trending?sort=volume&order=desc&limit=5`
      );
      const topVolume = volumeRes.ok
        ? ((await volumeRes.json()) as AssetData[])
        : [];

      // Fetch network status
      let networkStatus;
      try {
        const statusRes = await fetch(`${this.BACKEND_URL}/api/network/status`);
        if (statusRes.ok) {
          const statusData = (await statusRes.json()) as {
            health?: { isHealthy?: boolean; latestLedger?: number };
          };
          networkStatus = {
            isHealthy: statusData.health?.isHealthy || false,
            latestLedger: statusData.health?.latestLedger || 0,
          };
        }
      } catch {
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
  }

  /**
   * Format market overview data for Discord message
   */
  formatMarketOverviewMessage(data: MarketOverviewData): string {
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
  private formatNumber(num: number): string {
    if (num >= 1_000_000_000) {
      return `${(num / 1_000_000_000).toFixed(2)}B`;
    }
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(2)}M`;
    }
    if (num >= 1_000) {
      return `${(num / 1_000).toFixed(2)}K`;
    }
    return num.toFixed(2);
  }
}
