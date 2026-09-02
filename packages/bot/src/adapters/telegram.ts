import { Telegraf } from 'telegraf';
import { TransactionNotificationData } from './types';
import { createTrustlineOperation } from '@chen-pilot/sdk-core';
import { getAliases } from '../commands';

const BACKEND_URL = process.env.NODE_URL || 'http://localhost:3000';

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

    this.bot.command(getAliases('start'), (ctx) => ctx.reply('Welcome to Chen Pilot! I am your AI-powered Stellar DeFi assistant.'));
    this.bot.command(getAliases('help'), (ctx) => ctx.reply('Commands: /start, /balance, /swap, /trustline\n\nYou can also use short aliases like /b for balance, /t for trustline, etc.'));

    this.bot.command('trustline', async (ctx) => {
      const text = ctx.message.text.split(' ').slice(1).join(' ');
      if (!text) {
        return ctx.reply('Usage: /trustline <assetCode> [issuerDomain|issuerAddress] OR /trustline <description>\nExample: /trustline USDC circle.com OR /trustline the dollar stablecoin');
      }

      const args = text.split(' ');
      let assetCode = args[0];
      let assetIssuer = args[1];

      try {
        // If we only have one arg or it doesn't look like a code + issuer, try AI recognition
        if (!assetIssuer || assetCode.length > 12) {
          await ctx.reply(`🔍 AI is identifying the asset: "${text}"...`);
          const recognized = await this.recognizeAsset(text, ctx.from.id.toString());
          
          if (recognized) {
            assetCode = recognized.assetCode;
            assetIssuer = recognized.issuer;
            await ctx.reply(`💡 AI recognized this as <b>${assetCode}</b>${assetIssuer ? ` from <code>${assetIssuer}</code>` : ''}.\n${recognized.description}`, { parse_mode: 'HTML' });
          } else if (!assetIssuer) {
            return ctx.reply(`❌ Could not recognize asset from "${text}". Please provide an asset code and issuer address/domain.`);
          }
        }

        if (!assetIssuer && assetCode !== 'XLM') {
          return ctx.reply(`Please provide an issuer domain or address for ${assetCode}.`);
        }

        await ctx.reply(`🔍 Looking up asset ${assetCode}${assetIssuer ? ` from ${assetIssuer}` : ''}...`);
        const op = await createTrustlineOperation(assetCode, assetIssuer || 'native');
        
        let message = `✅ Found asset ${assetCode}!\n\n`;
        message += `To add this trustline, you can use the following details in your wallet:\n`;
        message += `<b>Asset:</b> ${assetCode}\n`;
        message += `<b>Issuer:</b> <code>${(op as any).asset.issuer || 'native'}</code>\n\n`;
        message += `<i>Note: In a future update, I will provide a direct signing link.</i>`;
        
        await ctx.reply(message, { parse_mode: 'HTML' });
      } catch (error) {
        await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    // Handle natural language asset recognition
    this.bot.on('text', async (ctx, next) => {
      const text = ctx.message.text;
      if (text.startsWith('/') || text.toLowerCase().includes('trustline')) {
        return next();
      }

      // Simple heuristic: if message mentions "add", "trustline", "asset", or "coin"
      const keywords = ['add', 'trustline', 'asset', 'coin', 'stablecoin', 'token'];
      const lowercaseText = text.toLowerCase();
      
      if (keywords.some(k => lowercaseText.includes(k))) {
        try {
          const recognized = await this.recognizeAsset(text, ctx.from.id.toString());
          if (recognized && recognized.confidence > 0.8) {
            let message = `🤖 It sounds like you're talking about <b>${recognized.assetCode}</b>!\n\n`;
            message += `${recognized.description}\n\n`;
            message += `Would you like to add a trustline for this asset? Use <code>/trustline ${recognized.assetCode} ${recognized.issuer || ''}</code>`;
            
            await ctx.reply(message, { parse_mode: 'HTML' });
          }
        } catch (error) {
          // Silent error for passive recognition
          console.error("Passive AI recognition error:", error);
        }
      }
      return next();
    });

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

  /**
   * Calls the backend AI asset recognition service
   */
  private async recognizeAsset(query: string, userId: string): Promise<any> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/assets/recognize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, query })
      });

      const data = await response.json() as any;
      if (data.success) {
        return data.asset;
      }
      return null;
    } catch (error) {
      console.error("Error calling asset recognition API:", error);
      return null;
    }
  }

  /**
   * Register a user to receive notifications
   */
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
