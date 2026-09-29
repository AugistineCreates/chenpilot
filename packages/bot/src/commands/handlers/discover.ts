import type { CommandContext, CommandHandler, CommandReply } from "../types";
import type { TrendingAsset } from "../../types";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000";

const ADVANCED_ROLE_NAMES = (
  process.env.DISCORD_ADVANCED_ROLES ?? "DeFi Pro,Whale,Admin"
)
  .split(",")
  .map((r) => r.trim());

export const discoverHandler: CommandHandler = {
  name: "discover",
  description: "Discover trending Stellar assets (requires advanced role)",
  requiredRoles: ADVANCED_ROLE_NAMES,

  async execute(_ctx: CommandContext): Promise<CommandReply> {
    const res = await fetch(`${BACKEND_URL}/api/assets/trending`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const assets = (await res.json()) as TrendingAsset[];

    if (!assets.length) {
      return { text: "📭 No trending assets found at this time." };
    }

    let text = "🌟 Trending Stellar Assets\n\n";
    for (const a of assets.slice(0, 5)) {
      const change =
        a.priceChange24h >= 0
          ? `+${a.priceChange24h.toFixed(2)}%`
          : `${a.priceChange24h.toFixed(2)}%`;
      const emoji = a.priceChange24h >= 0 ? "📈" : "📉";
      text += `${emoji} ${a.assetCode}${a.domain ? ` (${a.domain})` : ""}\n`;
      text += `  24h: ${change} | Volume: ${a.volume24h.toLocaleString()} | Holders: ${a.holders.toLocaleString()}\n\n`;
    }

    return { text };
  },
};

export const advancedHandler: CommandHandler = {
  name: "advanced",
  description: "Execute an advanced role-gated command",
  requiredRoles: ADVANCED_ROLE_NAMES,

  async execute(_ctx: CommandContext): Promise<CommandReply> {
    return { text: "✅ Advanced command executed. (Role check passed)" };
  },
};
