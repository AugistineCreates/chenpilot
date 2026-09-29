/**
 * Currency preference command.
 *
 * Because user preferences are per-user they need to survive across handler
 * invocations.  We keep an in-process Map here (same approach as the old
 * per-adapter Map, but now shared across both platforms).
 */

import type { CommandContext, CommandHandler, CommandReply } from "../types";
import { SUPPORTED_CURRENCIES } from "../types";
import type { SupportedCurrency } from "../types";

/** Shared preference store — platform-keyed so Discord and Telegram users with
 *  the same numeric ID don't collide. */
const userCurrency = new Map<string, SupportedCurrency>();

export function getUserCurrency(platform: string, userId: string): SupportedCurrency {
  return userCurrency.get(`${platform}:${userId}`) ?? "USD";
}

export function setUserCurrency(
  platform: string,
  userId: string,
  currency: SupportedCurrency
): void {
  userCurrency.set(`${platform}:${userId}`, currency);
}

export const currencyHandler: CommandHandler = {
  name: "currency",
  description: "Set your preferred reporting currency (USD, XLM, or BTC)",

  async execute(ctx: CommandContext): Promise<CommandReply> {
    const arg = ctx.args[0]?.toUpperCase() as SupportedCurrency | undefined;

    if (!arg || !(SUPPORTED_CURRENCIES as readonly string[]).includes(arg)) {
      const current = getUserCurrency(ctx.platform, ctx.userId);
      return {
        text: `Usage: /currency <USD|XLM|BTC>\nCurrent: ${current}`,
      };
    }

    setUserCurrency(ctx.platform, ctx.userId, arg);
    return {
      text: `✅ Report currency set to ${arg}`,
      ephemeral: true,
    };
  },
};
