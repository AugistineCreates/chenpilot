/**
 * Command Registry
 *
 * Central registry that stores all registered CommandHandlers and exposes a
 * single `dispatch()` entry point.  The adapters call dispatch() after
 * constructing a CommandContext — the registry applies guards, executes the
 * handler, records metrics, and returns the reply text.
 *
 * Nothing in this file is Discord- or Telegram-specific.
 */

import type {
  CommandContext,
  CommandHandler,
  CommandMetrics,
  CommandRegistryOptions,
} from "./types";
import { propagateBotCommand } from "../observability/botContext";
import {
  dmOnlyGuard,
  roleGuard,
  platformGuard,
  rateLimitGuard,
  floodGuard,
} from "./guards";
import { RateLimiter, DEFAULT_RATE_LIMIT, STRICT_RATE_LIMIT } from "../rateLimiter";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000";

// ─── Metrics reporting ────────────────────────────────────────────────────────

async function reportMetrics(metrics: CommandMetrics): Promise<void> {
  try {
    await fetch(`${BACKEND_URL}/api/bot/metrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metrics),
    });
  } catch {
    // Fail silently — metrics must never interrupt user-facing flows.
  }
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export class CommandRegistry {
  private handlers = new Map<string, CommandHandler>();
  private defaultLimiter: RateLimiter;
  private strictLimiter: RateLimiter;
  private lastCommandTime = new Map<string, number>();
  private debounceMs: number;

  constructor(opts: CommandRegistryOptions = {}) {
    this.debounceMs = opts.debounceMs ?? 1000;
    this.defaultLimiter = new RateLimiter(DEFAULT_RATE_LIMIT);
    this.strictLimiter = new RateLimiter(STRICT_RATE_LIMIT);
  }

  // ── Registration ────────────────────────────────────────────────────────────

  /**
   * Register one or more command handlers.  Duplicate names overwrite silently
   * (last-write wins) so hot-patching in tests is straightforward.
   */
  register(...handlers: CommandHandler[]): this {
    for (const h of handlers) {
      this.handlers.set(h.name, h);
    }
    return this;
  }

  /** Return every registered handler (used by adapters to build slash-command lists). */
  all(): CommandHandler[] {
    return [...this.handlers.values()];
  }

  /** Look up a single handler by name. */
  get(name: string): CommandHandler | undefined {
    return this.handlers.get(name);
  }

  // ── Dispatch ────────────────────────────────────────────────────────────────

  /**
   * Main entry point called by adapters.
   *
   * @returns The reply text, or null when the command was not found.
   *          Adapters should forward the text to their native reply mechanism.
   *
   * The reply is also sent via `ctx.reply()` so adapters that prefer the
   * fire-and-forget model can ignore the return value.
   */
  async dispatch(ctx: CommandContext): Promise<string | null> {
    // ── Flood guard (always applied regardless of command) ─────────────────
    const floodKey = `${ctx.platform}:${ctx.userId}`;
    const floodResult = floodGuard(ctx.userId, this.lastCommandTime, this.debounceMs);
    if (!floodResult.passed) {
      await ctx.reply(floodResult.reason!);
      return floodResult.reason!;
    }

    const handler = this.handlers.get(ctx.command);
    if (!handler) return null; // Unknown command — let the adapter handle it

    // ── Per-handler guards ─────────────────────────────────────────────────
    const guards = [
      platformGuard(handler, ctx),
      dmOnlyGuard(handler, ctx),
      roleGuard(handler, ctx),
      rateLimitGuard(handler, ctx, this.defaultLimiter, this.strictLimiter),
    ];

    for (const result of guards) {
      if (!result.passed) {
        await ctx.reply(result.reason!);
        return result.reason!;
      }
    }

    // ── Execute ────────────────────────────────────────────────────────────
    const start = Date.now();
    let success = true;
    let errorMsg: string | undefined;
    let replyText = "";

    try {
      const reply = await propagateBotCommand(ctx, async () => await handler.execute(ctx));
      replyText = reply.text;
      await ctx.reply(reply.text);
    } catch (err) {
      success = false;
      errorMsg = err instanceof Error ? err.message : String(err);
      replyText = `❌ An error occurred: ${errorMsg}`;
      console.error(`[CommandRegistry] Error executing command "${ctx.command}":`, err);
      await ctx.reply(replyText);
    }

    // ── Metrics (fire-and-forget) ──────────────────────────────────────────
    const metrics: CommandMetrics = {
      command: ctx.command,
      platform: ctx.platform,
      userId: ctx.userId,
      executionTimeMs: Date.now() - start,
      success,
      error: errorMsg,
      timestamp: new Date().toISOString(),
    };

    console.log(
      `[Bot] ${ctx.platform} /${ctx.command} by ${ctx.userId}: ${metrics.executionTimeMs}ms${success ? "" : " (failed)"}`
    );

    reportMetrics(metrics).catch(() => {});

    return replyText;
  }
}

// ── Singleton shared across both adapters ─────────────────────────────────────

export const commandRegistry = new CommandRegistry();
