/**
 * Price alert commands — /alert and /alerts.
 *
 * In-process alert state (mirrors the old per-adapter Map).  A future
 * iteration should persist alerts to the backend so they survive restarts and
 * work across both platforms for the same user.
 */

import type { CommandContext, CommandHandler, CommandReply } from "../types";
import type { PriceAlert } from "../../types";
import { SUPPORTED_CURRENCIES } from "../types";
import type { SupportedCurrency } from "../types";
import { getUserCurrency } from "./currency";

// Shared across Discord and Telegram
const priceAlerts = new Map<string, PriceAlert>();

export function getAlerts(): ReadonlyMap<string, PriceAlert> {
  return priceAlerts;
}

export const alertHandler: CommandHandler = {
  name: "alert",
  description: "Set a price alert for a Stellar asset",

  async execute(ctx: CommandContext): Promise<CommandReply> {
    const [assetCode, conditionRaw, priceRaw, currencyRaw] = ctx.args;

    if (!assetCode || !conditionRaw || !priceRaw) {
      return {
        text:
          "Usage: /alert <assetCode> <above|below> <price> [USD|XLM|BTC]\n" +
          "Example: /alert XLM above 0.15 USD",
      };
    }

    const condition = conditionRaw.toLowerCase();
    if (condition !== "above" && condition !== "below") {
      return { text: "❌ Condition must be `above` or `below`." };
    }

    const targetPrice = parseFloat(priceRaw);
    if (isNaN(targetPrice) || targetPrice <= 0) {
      return { text: "❌ Price must be a positive number." };
    }

    const currency: SupportedCurrency = (() => {
      const raw = currencyRaw?.toUpperCase();
      if (raw && (SUPPORTED_CURRENCIES as readonly string[]).includes(raw)) {
        return raw as SupportedCurrency;
      }
      return getUserCurrency(ctx.platform, ctx.userId);
    })();

    const alertId = `${ctx.userId}-${assetCode}-${Date.now()}`;
    const alert: PriceAlert = {
      id: alertId,
      userId: ctx.userId,
      assetCode: assetCode.toUpperCase(),
      targetPrice,
      currency,
      condition: condition as "above" | "below",
      createdAt: new Date().toISOString(),
      triggered: false,
    };

    priceAlerts.set(alertId, alert);

    return {
      text: `🔔 Alert set: notify me when ${assetCode.toUpperCase()} is ${condition} ${targetPrice} ${currency}`,
    };
  },
};

export const alertsHandler: CommandHandler = {
  name: "alerts",
  description: "List your active price alerts",

  async execute(ctx: CommandContext): Promise<CommandReply> {
    const userAlerts = [...priceAlerts.values()].filter(
      (a) => a.userId === ctx.userId && !a.triggered
    );

    if (userAlerts.length === 0) {
      return {
        text: "📭 You have no active price alerts. Use /alert to set one.",
      };
    }

    let text = "🔔 Your Active Alerts\n\n";
    for (const a of userAlerts) {
      text += `• ${a.assetCode} ${a.condition} ${a.targetPrice} ${a.currency} (ID: ${a.id.slice(-6)})\n`;
    }
    return { text };
  },
};
