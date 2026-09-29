/**
 * Portfolio / report command.
 *
 * Unified handler for both `/report` (Discord) and `/portfolio` (Telegram).
 * Both names are registered in the index so either alias triggers this logic.
 */

import type { CommandContext, CommandHandler, CommandReply } from "../types";
import { SUPPORTED_CURRENCIES } from "../types";
import type { SupportedCurrency } from "../types";
import { getUserCurrency } from "./currency";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000";

interface PortfolioResponse {
  address: string;
  currency: string;
  totalValue: number | null;
  assets: {
    code: string;
    issuer?: string;
    balance: number;
    value: number | null;
  }[];
  fetchedAt: string;
}

async function fetchPortfolio(
  userId: string,
  currency: SupportedCurrency
): Promise<PortfolioResponse> {
  const res = await fetch(
    `${BACKEND_URL}/api/portfolio/${userId}?currency=${currency}`
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<PortfolioResponse>;
}

function formatPortfolio(data: PortfolioResponse): string {
  const shortAddr = `${data.address.slice(0, 4)}...${data.address.slice(-4)}`;
  const netWorth =
    data.totalValue !== null
      ? `${data.totalValue.toFixed(4)} ${data.currency}`
      : "price data unavailable";

  let text =
    `💼 Stellar Portfolio Summary\n` +
    `📬 Account: ${shortAddr}\n` +
    `💰 Net Worth: ${netWorth}\n` +
    `🕐 ${new Date(data.fetchedAt).toUTCString()}\n\n` +
    `Assets\n`;

  if (data.assets.length === 0) {
    text += "No assets found on this account.\n";
  } else {
    for (const a of data.assets) {
      const valueStr =
        a.value !== null
          ? ` ≈ ${a.value.toFixed(4)} ${data.currency}`
          : "";
      const issuerStr = a.issuer
        ? ` (${a.issuer.slice(0, 6)}...)`
        : "";
      text += `• ${a.code}${issuerStr}: ${a.balance.toFixed(7)}${valueStr}\n`;
    }
  }

  text += `\nTip: use /currency <USD|XLM|BTC> to change currency.`;
  return text;
}

export const portfolioHandler: CommandHandler = {
  name: "portfolio",
  description: "View your Stellar portfolio and estimated net worth",

  async execute(ctx: CommandContext): Promise<CommandReply> {
    // Accept optional currency override as first arg
    const rawCurrency = ctx.args[0]?.toUpperCase();
    const currency: SupportedCurrency =
      rawCurrency &&
      (SUPPORTED_CURRENCIES as readonly string[]).includes(rawCurrency)
        ? (rawCurrency as SupportedCurrency)
        : getUserCurrency(ctx.platform, ctx.userId);

    const data = await fetchPortfolio(ctx.userId, currency);
    return { text: formatPortfolio(data) };
  },
};

/** Alias — Discord uses `/report` for the same thing. */
export const reportHandler: CommandHandler = {
  ...portfolioHandler,
  name: "report",
  description: "Get your portfolio report in your preferred currency",
};
