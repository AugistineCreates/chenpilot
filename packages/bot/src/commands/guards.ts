/**
 * Command Guards
 *
 * Stateless validation functions that run before execute(). Each guard receives the
 * command definition and the normalised context and returns a GuardResult — the
 * framework short-circuits on the first failure.
 *
 * Guards are intentionally pure and side-effect-free so they are trivially
 * unit-testable.
 */

import type { CommandContext, CommandHandler, GuardResult } from "./types";
import type { RateLimiter } from "../rateLimiter";
import { permissionMiddleware } from "../permissions/middleware.js";

// ─── DM-only guard ────────────────────────────────────────────────────────────

/**
 * Rejects commands that require a private chat when the message arrived in a
 * group / public channel.
 */
export function dmOnlyGuard(
  handler: CommandHandler,
  ctx: CommandContext
): GuardResult {
  if (!handler.dmOnly) return { passed: true };
  if (ctx.isDM) return { passed: true };

  return {
    passed: false,
    reason:
      "🔒 This command contains sensitive account data and can only be used in a Direct Message (DM) with the bot.",
  };
}

// ─── Role guard ───────────────────────────────────────────────────────────────

/**
 * Rejects Discord commands when the user does not hold one of the required
 * roles.  Always passes on Telegram (no role concept).
 */
export function roleGuard(
  handler: CommandHandler,
  ctx: CommandContext
): GuardResult {
  if (!handler.requiredRoles || handler.requiredRoles.length === 0) {
    return { passed: true };
  }

  // Telegram has no server roles — skip the check
  if (ctx.platform === "telegram") return { passed: true };

  const userRoles = ctx.roles ?? [];
  const hasRole = handler.requiredRoles.some((r) => userRoles.includes(r));

  if (hasRole) return { passed: true };

  return {
    passed: false,
    reason: `🔒 This command requires one of the following roles: **${handler.requiredRoles.join(", ")}**`,
  };
}

// ─── Platform guard ───────────────────────────────────────────────────────────

/**
 * Rejects commands that are not supported on the incoming platform.
 */
export function platformGuard(
  handler: CommandHandler,
  ctx: CommandContext
): GuardResult {
  if (!handler.platforms || handler.platforms.length === 0) {
    return { passed: true };
  }

  if (handler.platforms.includes(ctx.platform)) return { passed: true };

  return {
    passed: false,
    reason: `⚠️ This command is not available on ${ctx.platform}.`,
  };
}

// ─── Rate-limit guard ─────────────────────────────────────────────────────────

/**
 * Checks the sliding-window rate limiter for the user.
 * Accepts both the default and strict limiters so the handler definition can
 * pick the right one via `strictRateLimit`.
 */
export function rateLimitGuard(
  handler: CommandHandler,
  ctx: CommandContext,
  defaultLimiter: RateLimiter,
  strictLimiter: RateLimiter
): GuardResult {
  const limiter = handler.strictRateLimit ? strictLimiter : defaultLimiter;
  const status = limiter.check(ctx.userId);

  if (status.allowed) return { passed: true };

  const retryAfter = status.retryAfter ?? 60;
  return {
    passed: false,
    reason: `⏳ Rate limit exceeded. Please wait ${retryAfter} seconds before trying again.`,
  };
}

// ─── Flood guard ──────────────────────────────────────────────────────────────

/**
 * Debounces rapid-fire messages from the same user.
 * The last-command map is maintained by the caller (stateful per-adapter).
 */
export function floodGuard(
  userId: string,
  lastCommandTime: Map<string, number>,
  debounceMs: number
): GuardResult {
  const now = Date.now();
  const last = lastCommandTime.get(userId) ?? 0;

  if (now - last < debounceMs) {
    return {
      passed: false,
      reason: "⏳ Please wait a moment before sending another command.",
    };
  }

  lastCommandTime.set(userId, now);
  return { passed: true };
}

// ─── Permission matrix guard ───────────────────────────────────────────────────

/**
 * Checks the unified permission matrix for command access.
 * This guard integrates backend roles, platform roles, and contract capabilities.
 */
export async function permissionMatrixGuard(
  handler: CommandHandler,
  ctx: CommandContext
): Promise<GuardResult> {
  return await permissionMiddleware.permissionGuard(handler, ctx);
}
