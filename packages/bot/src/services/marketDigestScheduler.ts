/**
 * Market Digest Scheduler
 *
 * A platform-agnostic scheduler that drives daily market overview digests.
 * Instead of hard-coding the posting logic inside a bot adapter, callers
 * register `DigestTarget` objects that know how to post to their own
 * channel/chat.  The scheduler owns the clock and the retry semantics.
 *
 * Usage (in index.ts):
 *
 *   const scheduler = new MarketDigestScheduler();
 *   scheduler.addTarget(discordBot.createDigestTarget());
 *   scheduler.addTarget(telegramBot.createDigestTarget());
 *   scheduler.start();
 *
 * Operator controls (env vars):
 *   MARKET_DIGEST_ENABLED        — "true" / "false" (default: "false")
 *   MARKET_DIGEST_TIME           — "HH:MM" UTC (default: "09:00")
 *   MARKET_DIGEST_RETRY_ATTEMPTS — max post retries per target (default: 3)
 *   MARKET_DIGEST_RETRY_DELAY_MS — ms between retries (default: 30000)
 */

import { MarketOverviewService, MarketOverviewData } from "../marketOverview";

// ─── Public interface ────────────────────────────────────────────────────────

/**
 * A named posting target (one Discord channel, one Telegram chat, etc.).
 * Adapters implement this to hook into the scheduler without knowing its
 * internals.
 */
export interface DigestTarget {
  /** Human-readable label used in logs (e.g. "discord:#market-updates"). */
  label: string;
  /**
   * Called by the scheduler when it is time to post.
   * Should resolve when the message has been delivered (or reject on failure).
   */
  post(data: MarketOverviewData): Promise<void>;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface MarketDigestConfig {
  enabled: boolean;
  digestTime: string;
  maxRetryAttempts: number;
  retryDelayMs: number;
}

function parsePositiveInteger(
  name: string,
  rawValue: string | undefined,
  fallback: number
): number {
  if (rawValue === undefined || rawValue === "") {
    return fallback;
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error(
      `Invalid ${name}: "${rawValue}". Expected a positive integer.`
    );
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `Invalid ${name}: "${rawValue}". Expected a positive integer.`
    );
  }

  return parsed;
}

function parseEnabled(rawValue: string | undefined): boolean {
  if (rawValue === undefined || rawValue === "") {
    return false;
  }

  if (rawValue === "true") {
    return true;
  }

  if (rawValue === "false") {
    return false;
  }

  throw new Error(
    `Invalid MARKET_DIGEST_ENABLED: "${rawValue}". Expected "true" or "false".`
  );
}

function parseDigestTime(rawValue: string | undefined): string {
  const digestTime = rawValue || "09:00";
  const match = digestTime.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error(
      `Invalid MARKET_DIGEST_TIME: "${digestTime}". Expected HH:MM format.`
    );
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw new Error(
      `Invalid MARKET_DIGEST_TIME: "${digestTime}". Expected hours 00-23 and minutes 00-59.`
    );
  }

  return digestTime;
}

export function resolveMarketDigestConfig(
  env: NodeJS.ProcessEnv = process.env
): MarketDigestConfig {
  return {
    enabled: parseEnabled(env.MARKET_DIGEST_ENABLED),
    digestTime: parseDigestTime(env.MARKET_DIGEST_TIME),
    maxRetryAttempts: parsePositiveInteger(
      "MARKET_DIGEST_RETRY_ATTEMPTS",
      env.MARKET_DIGEST_RETRY_ATTEMPTS,
      3
    ),
    retryDelayMs: parsePositiveInteger(
      "MARKET_DIGEST_RETRY_DELAY_MS",
      env.MARKET_DIGEST_RETRY_DELAY_MS,
      30000
    ),
  };
}

/** 24 h in ms */
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

// ─── Scheduler ───────────────────────────────────────────────────────────────

export class MarketDigestScheduler {
  private targets: DigestTarget[] = [];
  private readonly marketService: MarketOverviewService;
  private readonly config: MarketDigestConfig;
  private nextTimeout?: ReturnType<typeof setTimeout>;
  private dailyInterval?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    marketService?: MarketOverviewService,
    env: NodeJS.ProcessEnv = process.env
  ) {
    this.marketService = marketService ?? new MarketOverviewService();
    this.config = resolveMarketDigestConfig(env);
  }

  // ── Target registration ────────────────────────────────────────────────────

  addTarget(target: DigestTarget): this {
    this.targets.push(target);
    return this;
  }

  removeTarget(label: string): this {
    this.targets = this.targets.filter((t) => t.label !== label);
    return this;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Start the scheduler.  Safe to call multiple times — subsequent calls are
   * no-ops while it is already running.
   */
  start(): void {
    if (this.running) return;

    if (!this.config.enabled) {
      console.log(
        "ℹ️ Market digest scheduler disabled (MARKET_DIGEST_ENABLED != true)"
      );
      return;
    }

    if (this.targets.length === 0) {
      console.warn(
        "⚠️ Market digest scheduler: no targets registered, skipping start"
      );
      return;
    }

    this.running = true;
    const delayMs = this.msUntilNextSchedule();
    const nextPost = new Date(Date.now() + delayMs);

    console.log(
      `📅 Market digest scheduler started — next post at ${nextPost.toUTCString()} ` +
        `(${Math.round(delayMs / 60_000)} min), targets: ${this.targets.map((t) => t.label).join(", ")}`
    );

    // Fire at the precise daily time, then repeat every 24 h.
    this.nextTimeout = setTimeout(() => {
      void this.runAll();
      this.dailyInterval = setInterval(
        () => void this.runAll(),
        DAILY_INTERVAL_MS
      );
    }, delayMs);
  }

  /**
   * Stop the scheduler and clear all pending timers.
   */
  stop(): void {
    if (this.nextTimeout) {
      clearTimeout(this.nextTimeout);
      this.nextTimeout = undefined;
    }
    if (this.dailyInterval) {
      clearInterval(this.dailyInterval);
      this.dailyInterval = undefined;
    }
    this.running = false;
    console.log("🛑 Market digest scheduler stopped");
  }

  /**
   * Immediately trigger a digest post to all registered targets, bypassing
   * the schedule.  Useful for operator-initiated on-demand posts or testing.
   */
  async postNow(): Promise<void> {
    console.log("📊 Market digest: on-demand post requested");
    await this.runAll();
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /**
   * Compute milliseconds until the next occurrence of DIGEST_TIME in UTC.
   */
  private msUntilNextSchedule(): number {
    const [hours, minutes] = this.config.digestTime.split(":").map(Number);
    const now = new Date();
    const next = new Date();
    next.setUTCHours(hours, minutes, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    return next.getTime() - now.getTime();
  }

  /**
   * Fetch market data once and fan it out to all targets.
   */
  private async runAll(): Promise<void> {
    console.log("📊 Market digest: fetching market data …");
    let data: MarketOverviewData;

    try {
      data = await this.marketService.fetchMarketOverview();
    } catch (err) {
      console.error("❌ Market digest: failed to fetch market data", err);
      return;
    }

    await Promise.allSettled(
      this.targets.map((target) => this.postWithRetry(target, data))
    );
  }

  /**
   * Attempt to post to a single target with exponential-like retry.
   */
  private async postWithRetry(
    target: DigestTarget,
    data: MarketOverviewData
  ): Promise<void> {
    let lastErr: unknown;

    for (let attempt = 1; attempt <= this.config.maxRetryAttempts; attempt++) {
      try {
        await target.post(data);
        console.log(`✅ Market digest posted to ${target.label}`);
        return;
      } catch (err) {
        lastErr = err;
        console.error(
          `❌ Market digest post to ${target.label} failed (attempt ${attempt}/${MAX_RETRY_ATTEMPTS}):`,
          err
        );
        if (attempt < this.config.maxRetryAttempts) {
          await sleep(this.config.retryDelayMs * attempt);
        }
      }
    }

    console.error(
      `❌ Market digest: gave up posting to ${target.label} after ${this.config.maxRetryAttempts} attempts`,
      lastErr
    );
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const marketDigestScheduler = new MarketDigestScheduler();

// ── Utility ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
