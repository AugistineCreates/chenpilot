import { Telegraf } from "telegraf";
import {
  TransactionNotificationData,
  Button,
  ButtonInteraction as GenericButtonInteraction,
  ButtonHandler,
} from "../types";
import { AssetVerificationService } from "../assetVerification";
import {
  RateLimiter,
  DEFAULT_RATE_LIMIT,
  STRICT_RATE_LIMIT,
} from "../rateLimiter";
import { botWorkflowManager } from "../services/workflowService";
import { MarketOverviewService } from "../marketOverview";
import { DigestTarget } from "../services/marketDigestScheduler";
import { commandRegistry } from "../commands/registry";
import { fromTelegrafCtx } from "../commands/adapters/telegramContext";
import { AgentClient } from "@chen-pilot/sdk-core";

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.API_BASE_URL ||
  "http://localhost:2333";

const HORIZON_URL =
  process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";
const DEBOUNCE_MS = 1000; // 1 second debounce between commands

// Market digest target chat used by createDigestTarget()
const MARKET_OVERVIEW_CHAT_ID =
  process.env.TELEGRAM_MARKET_OVERVIEW_CHAT_ID || "";

// Commands that require stricter rate limiting
const SENSITIVE_COMMANDS = ["/trustline", "/validate"];

export class TelegramAdapter {
  private bot: Telegraf | undefined;
  private token: string;
  private userChatIds: Map<string, string> = new Map(); // userId -> chatId
  // #145: Track last command timestamp per user
  private lastCommandTime: Map<number, number> = new Map();
  // #123: Rate limit limiters for bot commands
  private defaultRateLimiter: RateLimiter;
  private strictRateLimiter: RateLimiter;
  private verificationService: AssetVerificationService;
  // Button handlers map: buttonId -> ButtonHandler
  private buttonHandlers: Map<string, ButtonHandler> = new Map();
  // #114: AI agent client
  private agentClient: AgentClient;
  // Market overview service â€” used by createDigestTarget()
  private marketOverviewService: MarketOverviewService;

  constructor(token: string) {
    this.token = token;
    this.verificationService = new AssetVerificationService(HORIZON_URL);
    // #123: Initialize rate limiters
    this.defaultRateLimiter = new RateLimiter(DEFAULT_RATE_LIMIT);
    this.strictRateLimiter = new RateLimiter(STRICT_RATE_LIMIT);
    // #114: Initialize AI agent client
    this.agentClient = new AgentClient({ baseUrl: BACKEND_URL });
    // Market overview service
    this.marketOverviewService = new MarketOverviewService();
  }

  // #145: Returns true if the user is flooding (within debounce window)
  private isFlooding(userId: number): boolean {
    const now = Date.now();
    const last = this.lastCommandTime.get(userId) ?? 0;
    if (now - last < DEBOUNCE_MS) return true;
    this.lastCommandTime.set(userId, now);
    return false;
  }

  // #123: Check rate limit for a user and command
  private checkRateLimit(
    userId: number,
    command: string
  ): { allowed: boolean; message?: string } {
    // Determine which rate limiter to use based on command
    const isSensitive = SENSITIVE_COMMANDS.some((cmd) =>
      command.startsWith(cmd)
    );
    const rateLimiter = isSensitive
      ? this.strictRateLimiter
      : this.defaultRateLimiter;

    const status = rateLimiter.check(String(userId));

    if (!status.allowed) {
      const retryAfter = status.retryAfter || 60;
      return {
        allowed: false,
        message: `â³ Rate limit exceeded. Please wait ${retryAfter} seconds before trying again.`,
      };
    }

    return { allowed: true };
  }

  async init() {
    if (!this.token) {
      console.warn(
        "âš ï¸ Telegram: No token provided, skipping initialization."
      );
      return;
    }

    this.bot = new Telegraf(this.token);

    // #145: Middleware to debounce all incoming messages/commands
    this.bot.use(async (ctx: Context, next: () => Promise<void>) => {
      const userId: number | undefined = ctx.from?.id;
      if (userId && this.isFlooding(userId)) {
        await ctx.reply(
          "â³ Please wait a moment before sending another command."
        );
        return;
      }

      // #123: Rate limit check
      const text = ctx.message && "text" in ctx.message ? ctx.message.text : "";
      const command = text.split(" ")[0] || "";
      if (userId) {
        const rateLimitResult = this.checkRateLimit(userId, command);
        if (!rateLimitResult.allowed) {
          await ctx.reply(rateLimitResult.message!);
          return;
        }
      }

      return next();
    });

    // Handle callback queries (button presses)
    this.bot.on("callback_query", async (ctx: any) => {
      const buttonId = ctx.callbackQuery.data;
      const userId = String(ctx.from?.id || "unknown");
      const chatId = String(ctx.chat?.id || "");

      const genericInteraction: GenericButtonInteraction = {
        platform: "telegram",
        userId: userId,
        buttonId: buttonId,
        chatId: chatId,
        raw: ctx,
        reply: async (message: string) => {
          await ctx.answerCbQuery(); // Acknowledge the callback query
          await ctx.reply(message);
        },
      };

      const handler = this.buttonHandlers.get(buttonId);
      if (handler) {
        try {
          await handler(genericInteraction);
        } catch (error) {
          console.error("Error handling button interaction:", error);
          await ctx.answerCbQuery(
            "âŒ An error occurred while processing your button click."
          );
        }
      } else {
        await ctx.answerCbQuery("âš ï¸ No handler found for this button.");
      }
    });

    // â”€â”€ Shared command dispatch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // All commands that have shared handlers are wired through a single
    // factory.  The Telegraf `command()` call is just the entry-point; the
    // actual logic lives in the platform-neutral CommandRegistry.

    const dispatchCommand = (commandName: string) => async (ctx: any) => {
      const text: string = ctx.message?.text ?? "";
      const args = text.split(" ").slice(1).filter(Boolean);
      const cmdCtx = fromTelegrafCtx(ctx, commandName, args);
      await commandRegistry.dispatch(cmdCtx);
    };

    this.bot.start(dispatchCommand("start"));
    this.bot.help(dispatchCommand("help"));

    this.bot.command("ping", dispatchCommand("ping"));
    this.bot.command("dashboard", dispatchCommand("dashboard"));
    this.bot.command("trustline", dispatchCommand("trustline"));
    this.bot.command("validate", dispatchCommand("validate"));
    this.bot.command("sponsor", dispatchCommand("sponsor"));
    this.bot.command("multisig", dispatchCommand("multisig"));
    this.bot.command("swap", dispatchCommand("swap"));
    this.bot.command("portfolio", dispatchCommand("portfolio"));
    this.bot.command("currency", dispatchCommand("currency"));
    this.bot.command("alert", dispatchCommand("alert"));
    this.bot.command("alerts", dispatchCommand("alerts"));
    this.bot.command("discover", dispatchCommand("discover"));
    this.bot.command("feedback", dispatchCommand("feedback"));

    // â”€â”€ Telegram-specific: settings (WebApp) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.bot.command("settings", async (ctx: any) => {
      const settingsUrl = `${BACKEND_URL}/settings`;
      await ctx.replyWithHTML("âš™ï¸ <b>Open Settings</b>", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Open Settings", web_app: { url: settingsUrl } }],
          ],
        },
      });
    });

    // â”€â”€ Telegram-specific: inline asset search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.bot.on("inline_query", async (ctx: any) => {
      const query: string = ctx.inlineQuery.query.trim();
      if (query.length < 2) {
        return ctx.answerInlineQuery([]);
      }
      try {
        const res = await fetch(
          `${BACKEND_URL}/api/assets/search?q=${encodeURIComponent(query)}&limit=5`
        );
        if (!res.ok) return ctx.answerInlineQuery([]);
        const assets = (await res.json()) as Array<{
          code: string;
          issuer?: string;
          domain?: string;
          price?: number;
          priceChange24h?: number;
        }>;
        const results = assets.map((asset, index) => ({
          type: "article",
          id: `${asset.code}-${asset.issuer ?? "native"}-${index}`,
          title: `${asset.code}${asset.domain ? ` (${asset.domain})` : ""}`,
          description: asset.price
            ? `Price: $${asset.price.toFixed(4)}${asset.priceChange24h !== undefined ? ` | 24h: ${asset.priceChange24h >= 0 ? "+" : ""}${asset.priceChange24h.toFixed(2)}%` : ""}`
            : "Stellar asset",
          input_message_content: {
            message_text: this.formatAssetInlineResult(asset),
            parse_mode: "HTML",
          },
          thumb_url: asset.domain
            ? `https://www.google.com/s2/favicons?domain=${asset.domain}`
            : undefined,
        }));
        await ctx.answerInlineQuery(results, { cache_time: 300 });
      } catch {
        return ctx.answerInlineQuery([]);
      }
    });

    // â”€â”€ Wizard input handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.bot.use(async (ctx: any, next: () => Promise<void>) => {
      const userId = String(ctx.from?.id ?? "unknown");
      const text: string = ctx.message?.text ?? "";
      const response = await botWorkflowManager.handleInput(
        userId,
        "telegram",
        text
      );
      if (response) {
        await ctx.reply(response.message);
        return;
      }
      return next();
    });

    // Set bot commands for mobile menu
    await this.bot.telegram.setMyCommands([
      { command: "start", description: "Start the bot" },
      { command: "portfolio", description: "Portfolio summary & net worth" },
      { command: "swap", description: "Swap assets (DM only)" },
      { command: "trustline", description: "Add trustline" },
      { command: "multisig", description: "Setup multisig wallet (DM only)" },
      { command: "alert", description: "Set a price alert" },
      { command: "alerts", description: "List your price alerts" },
      { command: "currency", description: "Set reporting currency" },
      { command: "feedback", description: "Send feedback or report bugs" },
      { command: "settings", description: "Open settings" },
      { command: "help", description: "Show help" },
    ]);

    this.bot.launch();
    console.log("âœ… Telegram bot initialized.");
  }

  // #147: Announce a new GitHub release to a specific chat
  async announceRelease(
    chatId: string,
    release: { tag_name: string; name: string; html_url: string; body?: string }
  ): Promise<boolean> {
    if (!this.bot) {
      console.warn("âš ï¸ Telegram bot not initialized");
      return false;
    }

    const body = release.body
      ? `\n\n${release.body.slice(0, 500)}${release.body.length > 500 ? "..." : ""}`
      : "";
    const message = `ðŸš€ <b>New Release: ${release.name || release.tag_name}</b>${body}\n\nðŸ”— <a href="${release.html_url}">View on GitHub</a>`;

    try {
      await this.bot.telegram.sendMessage(chatId, message, {
        parse_mode: "HTML",
      });
      return true;
    } catch (error) {
      console.error("Error sending release announcement:", error);
      return false;
    }
  }

  async registerUser(userId: string, chatId: string): Promise<boolean> {
    this.userChatIds.set(userId, chatId);
    return true;
  }

  async sendTransactionNotification(
    userId: string,
    data: TransactionNotificationData
  ): Promise<boolean> {
    if (!this.bot) {
      console.warn("âš ï¸ Telegram bot not initialized");
      console.warn("⚠️ Telegram bot not initialized");
      return false;
    }

    const chatId = this.userChatIds.get(userId);
    if (!chatId) {
      console.warn(`⚠️ No chat ID found for user ${userId}`);
      return false;
    }

    const message = this.formatTransactionMessage(data);

    try {
      await this.bot.telegram.sendMessage(chatId, message, {
        parse_mode: "HTML",
      });
      return true;
    } catch (error) {
      console.error("Error sending Telegram notification:", error);
      return false;
    }
  }

  private formatTransactionMessage(data: TransactionNotificationData): string {
    const statusEmoji = data.successful ? "âœ…" : "âŒ";
    const timestamp = new Date(data.timestamp).toLocaleString();

    let message = `<b>Transaction ${data.successful ? "Confirmed" : "Failed"}</b> ${statusEmoji}\n\n`;
    message += `ðŸ“‹ <b>Hash:</b> <code>${data.hash.slice(0, 8)}...${data.hash.slice(-8)}</code>\n`;
    message += `ðŸ’° <b>Amount:</b> ${data.amount} ${data.asset}\n`;
    message += `ðŸ“¤ <b>From:</b> <code>${data.from.slice(0, 4)}...${data.from.slice(-4)}</code>\n`;
    message += `ðŸ“¥ <b>To:</b> <code>${data.to.slice(0, 4)}...${data.to.slice(-4)}</code>\n`;
    message += `â±ï¸ <b>Time:</b> ${timestamp}\n`;

    if (data.fee) {
      message += `ðŸ’µ <b>Fee:</b> ${data.fee} XLM\n`;
    }

    if (data.memo) {
      message += `ðŸ“ <b>Memo:</b> ${data.memo}\n`;
    }

    return message;
  }

  // #112: Format asset result for inline query
  private formatAssetInlineResult(asset: {
    code: string;
    issuer?: string;
    domain?: string;
    price?: number;
    priceChange24h?: number;
  }): string {
    let message = `ðŸ’Ž <b>${asset.code}</b>\n\n`;

    if (asset.domain) {
      message += `<b>Issuer:</b> ${asset.domain}\n`;
    }

    if (asset.price !== undefined) {
      message += `<b>Price:</b> $${asset.price.toFixed(4)}\n`;

      if (asset.priceChange24h !== undefined) {
        const changeEmoji = asset.priceChange24h >= 0 ? "ðŸ“ˆ" : "ðŸ“‰";
        const changeSign = asset.priceChange24h >= 0 ? "+" : "";
        message += `<b>24h:</b> ${changeEmoji} ${changeSign}${asset.priceChange24h.toFixed(2)}%\n`;
      }
    }

    message += `\n<i>Data from Chen Pilot</i>`;
    return message;
  }

  async sendNotification(userId: string, message: string): Promise<boolean> {
    if (!this.bot) {
      console.warn("âš ï¸ Telegram bot not initialized");
      return false;
    }

    const chatId = this.userChatIds.get(userId);
    if (!chatId) {
      return false;
    }

    try {
      await this.bot.telegram.sendMessage(chatId, message, {
        parse_mode: "HTML",
      });
      return true;
    } catch (error) {
      console.error("Error sending Telegram notification:", error);
      return false;
    }
  }

  /**
   * Register a handler for button interactions
   */
  registerButtonHandler(buttonId: string, handler: ButtonHandler): void {
    this.buttonHandlers.set(buttonId, handler);
  }

  /**
   * Send a message with buttons to a specific chat
   */
  async sendWithButtons(
    chatId: string,
    content: string,
    buttons: Button[]
  ): Promise<boolean> {
    if (!this.bot) {
      console.warn("âš ï¸ Telegram bot not initialized");
      return false;
    }

    try {
      // Build inline keyboard
      const keyboard = buttons.map((btn) => {
        if (btn.url) {
          return [{ text: btn.label, url: btn.url }];
        } else {
          return [{ text: btn.label, callback_data: btn.id }];
        }
      });

      await this.bot.telegram.sendMessage(chatId, content, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: keyboard,
        },
      });

      return true;
    } catch (error) {
      console.error("Error sending message with buttons:", error);
      return false;
    }
  }

  /**
   * Create a DigestTarget for the MarketDigestScheduler.
   * Register the returned target with the scheduler in index.ts.
   *
   * The target posts to TELEGRAM_MARKET_OVERVIEW_CHAT_ID using HTML parse mode.
   * Returns null when no chat ID is configured so the caller can skip
   * registration gracefully.
   */
  createDigestTarget(): DigestTarget | null {
    if (!MARKET_OVERVIEW_CHAT_ID) {
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const adapter = this;
    const chatId = MARKET_OVERVIEW_CHAT_ID;

    return {
      label: `telegram:${chatId}`,
      async post(data) {
        if (!adapter.bot) {
          throw new Error("Telegram bot not initialized");
        }
        const message = adapter.marketOverviewService.formatForTelegram(data);
        await adapter.bot.telegram.sendMessage(chatId, message, {
          parse_mode: "HTML",
        });
      },
    };
  }
}
