import logger from "../config/logger";
import priceCacheService from "./priceCache.service";
import { agentLLM } from "../Agents/agent";
import { BotUpdateHelper } from "../Gateway/realtimeIntegration";
import { createBudget, budgetedFetch, BudgetExhaustedError } from "../utils/budget";

// Spike threshold — alert when price moves more than this % in one interval
const SPIKE_THRESHOLD_PCT = 5;
// How many recent news headlines to feed the LLM
const MAX_NEWS_ITEMS = 5;
// Poll every 60s
const POLL_INTERVAL_MS = 60_000;

interface WatchedPair {
  from: string;
  to: string;
  lastPrice: number | null;
}

interface NewsItem {
  title: string;
  published_at: string;
}

const NEWS_BUDGET = createBudget({
  deadlineMs: 8000,
  attempts: 2,
  bytes: 512 * 1024,
  downstreamCalls: 5,
  path: "priceSpike.news",
});

// Fetch recent crypto news from CryptoPanic (free, no key needed for basic feed)
async function fetchNews(asset: string): Promise<NewsItem[]> {
  try {
    const url = `https://cryptopanic.com/api/v1/posts/?auth_token=free&currencies=${asset}&kind=news&public=true`;
    const res = await budgetedFetch(NEWS_BUDGET, url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: NewsItem[] };
    return (data.results ?? []).slice(0, MAX_NEWS_ITEMS);
  } catch (error) {
    if (error instanceof BudgetExhaustedError) {
      logger.warn("News fetch budget exhausted", { asset, resource: error.resource });
    }
    return [];
  }
}

async function buildSpikeSummary(
  asset: string,
  pct: number,
  oldPrice: number,
  newPrice: number,
  news: NewsItem[]
): Promise<string> {
  if (news.length === 0) {
    const dir = pct > 0 ? "up" : "down";
    return `${asset} moved ${dir} ${Math.abs(pct).toFixed(1)}% (${oldPrice.toFixed(4)} → ${newPrice.toFixed(4)}) but no recent news was found.`;
  }

  const headlines = news.map((n) => `- ${n.title}`).join("\n");
  const direction = pct > 0 ? "spiked up" : "dropped";

  const prompt = `You are a concise crypto market analyst. An asset just had a significant price move.

Asset: ${asset}
Move: ${direction} ${Math.abs(pct).toFixed(1)}% (${oldPrice.toFixed(4)} → ${newPrice.toFixed(4)})

Recent news headlines:
${headlines}

In 2-3 sentences, explain the most likely reason for this price move based on the headlines. Be direct and specific. Do not use markdown.`;

  try {
    const summary = (await agentLLM.callLLM(
      "spike-alert",
      prompt,
      "",
      false, // plain text, not JSON
      10_000
    )) as string;
    return summary.trim();
  } catch (err) {
    logger.error("LLM spike summary failed", err);
    return `${asset} ${direction} ${Math.abs(pct).toFixed(1)}% — LLM summary unavailable.`;
  }
}

export class PriceSpikeAlertService {
  private pairs: WatchedPair[];
  private timer: ReturnType<typeof setInterval> | null = null;
  private botId = "price-spike-monitor";

  constructor(pairs: Array<{ from: string; to: string }>) {
    this.pairs = pairs.map((p) => ({ ...p, lastPrice: null }));
  }

  start() {
    logger.info("PriceSpikeAlertService started", {
      pairs: this.pairs.map((p) => `${p.from}/${p.to}`),
    });
    this.timer = setInterval(() => this.check(), POLL_INTERVAL_MS);
    // run immediately on start
    this.check();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async check() {
    for (const pair of this.pairs) {
      try {
        const cached = await priceCacheService.getPrice(pair.from, pair.to);
        if (!cached) continue;

        const current = cached.price;

        if (pair.lastPrice === null) {
          pair.lastPrice = current;
          continue;
        }

        const pct = ((current - pair.lastPrice) / pair.lastPrice) * 100;

        if (Math.abs(pct) >= SPIKE_THRESHOLD_PCT) {
          logger.info(
            `Spike detected ${pair.from}/${pair.to}: ${pct.toFixed(2)}%`
          );

          const news = await fetchNews(pair.from);
          const summary = await buildSpikeSummary(
            pair.from,
            pct,
            pair.lastPrice,
            current,
            news
          );

          const direction = pct > 0 ? "📈" : "📉";
          const message = `${direction} ${pair.from}/${pair.to} ${pct > 0 ? "+" : ""}${pct.toFixed(1)}%\n\n${summary}`;

          BotUpdateHelper.notifyWarning(message, this.botId, "broadcast", {
            asset: pair.from,
            pair: `${pair.from}/${pair.to}`,
            pct: pct.toFixed(2),
            oldPrice: pair.lastPrice,
            newPrice: current,
          });

          logger.info("Spike alert sent", {
            pair: `${pair.from}/${pair.to}`,
            summary,
          });
        }

        pair.lastPrice = current;
      } catch (err) {
        logger.error(`Spike check failed for ${pair.from}/${pair.to}`, err);
      }
    }
  }
}

// Default instance watching the main pairs
export const priceSpikeAlertService = new PriceSpikeAlertService([
  { from: "XLM", to: "USDC" },
  { from: "XLM", to: "USDT" },
]);
