import { Telegraf } from "telegraf";
import { TransactionNotificationData } from "../types";
import { createTrustlineOperation } from "@chen-pilot/sdk-core";
import { searchFeatures, formatHelpMessage } from "../services/helpProvider";
import { AssetVerificationService } from '../assetVerification';
import { RateLimiter, DEFAULT_RATE_LIMIT, STRICT_RATE_LIMIT } from '../rateLimiter';
import { withPerformanceProfiling, extractCommandName } from '../performanceProfiler';

const DASHBOARD_URL = process.env.DASHBOARD_URL || `${process.env.API_BASE_URL || 'http://localhost:2333'}/dashboard`;
const HORIZON_URL = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const DEBOUNCE_MS = 1000; // 1 second debounce between commands

// Commands that involve personal account data and must only be used in DMs
const DM_ONLY_COMMANDS = ['/balance'];

// Commands that require stricter rate limiting
const SENSITIVE_COMMANDS = ['/trustline', '/validate'];

function isDM(ctx: Parameters<Parameters<Telegraf['command']>[1]>[0]): boolean {
  return ctx.chat?.type === 'private';
}

async function rejectPublicChannel(ctx: Parameters<Parameters<Telegraf['command']>[1]>[0]): Promise<void> {
  await ctx.reply('🔒 This command contains sensitive account data and can only be used in a private message (DM) with the bot.');
}

export class TelegramAdapter {
  private bot: Telegraf | undefined;
  private token: string;
  private userChatIds: Map<string, string> = new Map(); // userId -> chatId
  // #145: Track last command timestamp per user
  private lastCommandTime: Map<number, number> = new Map();
  // #123: Rate limiters for bot commands
  private defaultRateLimiter: RateLimiter;
  private strictRateLimiter: RateLimiter;
  private verificationService: AssetVerificationService;

  constructor(token: string) {
    this.token = token;
    this.verificationService = new AssetVerificationService(HORIZON_URL);
    // #123: Initialize rate limiters
    this.defaultRateLimiter = new RateLimiter(DEFAULT_RATE_LIMIT);
    this.strictRateLimiter = new RateLimiter(STRICT_RATE_LIMIT);
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
  private checkRateLimit(userId: number, command: string): { allowed: boolean; message?: string } {
    // Determine which rate limiter to use based on command
    const isSensitive = SENSITIVE_COMMANDS.some(cmd => command.startsWith(cmd));
    const rateLimiter = isSensitive ? this.strictRateLimiter : this.defaultRateLimiter;
    
    const status = rateLimiter.check(String(userId));
    
    if (!status.allowed) {
      const retryAfter = status.retryAfter || 60;
      return {
        allowed: false,
        message: `⏳ Rate limit exceeded. Please wait ${retryAfter} seconds before trying again.`
      };
    }
    
    return { allowed: true };
  }

  async init() {
    if (!this.token) {
      console.warn("⚠️ Telegram: No token provided, skipping initialization.");
      return;
    }

    this.bot = new Telegraf(this.token);

    // #145: Middleware to debounce all incoming messages/commands
    this.bot.use(async (ctx: any, next: () => Promise<void>) => {
      const userId: number | undefined = ctx.from?.id;
      if (userId && this.isFlooding(userId)) {
        await ctx.reply("⏳ Please wait a moment before sending another command.");
        return;
      }
      
      // #123: Rate limit check
      const command = ctx.message?.text?.split(' ')[0] || '';
      if (userId) {
        const rateLimitResult = this.checkRateLimit(userId, command);
        if (!rateLimitResult.allowed) {
          await ctx.reply(rateLimitResult.message);
          return;
        }
      }
      
      return next();
    });

    this.bot.start(async (ctx: any) => {
      const userId = String(ctx.from?.id || 'unknown');
      await withPerformanceProfiling('/start', 'telegram', userId, () => ctx.reply('Welcome to Chen Pilot! I am your AI-powered Stellar DeFi assistant.'))();
    });
    this.bot.help(async (ctx: any) => {
      const userId = String(ctx.from?.id || 'unknown');
      await withPerformanceProfiling('/help', 'telegram', userId, () => ctx.reply('Commands: /start, /balance, /swap, /trustline, /dashboard, /validate'))();
    });

    this.bot.command('trustline', async (ctx: any) => {
      const userId = String(ctx.from?.id || 'unknown');
      const commandName = extractCommandName(ctx.message.text, 'telegram');
      await withPerformanceProfiling(commandName, 'telegram', userId, async () => {
        const args = ctx.message.text.split(' ').slice(1);
        if (args.length < 1) {
          return ctx.reply(
            "Usage: /trustline <assetCode> [issuerDomain|issuerAddress]\nExample: /trustline USDC circle.com"
          );
        }

        const assetCode = args[0];
        const assetIssuer = args[1];

        if (!assetIssuer) {
          return ctx.reply(
            `Please provide an issuer domain or address for ${assetCode}.`
          );
        }

        try {
          await ctx.reply(
            `🔍 Looking up asset ${assetCode} from ${assetIssuer}...`
          );
          const op = await createTrustlineOperation(assetCode, assetIssuer);

          // In a real scenario, we would generate a signing link (e.g., Albedo or Stellar Laboratory)
          // For now, we'll return the operation details
          let message = `✅ Found asset ${assetCode}!\n\n`;
          message += `To add this trustline, you can use the following details in your wallet:\n`;
          message += `<b>Asset:</b> ${assetCode}\n`;
          message += `<b>Issuer:</b> <code>${(op as any).asset.issuer}</code>\n\n`;
          message += `<i>Note: In a future update, I will provide a direct signing link.</i>`;

          await ctx.reply(message, { parse_mode: "HTML" });
        } catch (error) {
          await ctx.reply(
            `❌ Error: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      })();
    });

    // #146: Dashboard command
    this.bot.command('dashboard', async (ctx: any) => {
      const userId = String(ctx.from?.id || 'unknown');
      await withPerformanceProfiling('/dashboard', 'telegram', userId, async () => {
        await ctx.reply(
          `📊 <b>Chen Pilot Dashboard</b>\n\nAccess your admin dashboard here:\n🔗 <a href="${DASHBOARD_URL}">Open Dashboard</a>\n\n<i>Note: You must be logged in to view the dashboard.</i>`,
          { parse_mode: 'HTML' }
        );
      })();
    });

    // #148: /validate command for Stellar asset verification
    this.bot.command('validate', async (ctx: any) => {
      const userId = String(ctx.from?.id || 'unknown');
      const commandName = extractCommandName(ctx.message.text, 'telegram');
      await withPerformanceProfiling(commandName, 'telegram', userId, async () => {
        const args = ctx.message.text.split(' ').slice(1);
        if (args.length < 2) {
          return ctx.reply('Usage: /validate <assetCode> <issuerAddress>\nExample: /validate USDC GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
        }

        const [assetCode, issuerAddress] = args;
        await ctx.reply(`🔍 Verifying asset <b>${assetCode}</b> from issuer <code>${issuerAddress.slice(0, 8)}...</code>`, { parse_mode: 'HTML' });

        try {
          const result = await this.verificationService.verifyAsset(assetCode, issuerAddress);
          const statusEmoji = result.status === 'VERIFIED' ? '✅' : result.status === 'MALICIOUS' ? '🚨' : '⚠️';

          let reply = `${statusEmoji} <b>Asset Verification: ${result.status}</b>\n\n`;
          reply += `<b>Asset:</b> ${assetCode}\n`;
          reply += `<b>Issuer:</b> <code>${issuerAddress}</code>\n`;
          if (result.domain) reply += `<b>Domain:</b> ${result.domain}\n`;
          if (result.details) reply += `<b>Details:</b> ${result.details}\n`;
          reply += `\n<b>Safe to use:</b> ${result.isSafe ? 'Yes ✅' : 'No ❌'}`;

          await ctx.reply(reply, { parse_mode: 'HTML' });
        } catch (error) {
          await ctx.reply(`❌ Verification error: ${error instanceof Error ? error.message : String(error)}`);
        }
      })();
    });

    // Set bot commands for mobile menu
    await this.bot.telegram.setMyCommands([
      { command: "start", description: "Start the bot" },
      { command: "balance", description: "Check wallet balance" },
      { command: "swap", description: "Swap assets" },
      { command: "trustline", description: "Add trustline" },
      { command: "help", description: "Show help" },
    ]);

    this.bot.launch();
    console.log("✅ Telegram bot initialized.");
  }

  // #147: Announce a new GitHub release to a specific chat
  async announceRelease(chatId: string, release: { tag_name: string; name: string; html_url: string; body?: string }): Promise<boolean> {
    if (!this.bot) {
      console.warn("⚠️ Telegram bot not initialized");
      return false;
    }

    const body = release.body ? `\n\n${release.body.slice(0, 500)}${release.body.length > 500 ? '...' : ''}` : '';
    const message = `🚀 <b>New Release: ${release.name || release.tag_name}</b>${body}\n\n🔗 <a href="${release.html_url}">View on GitHub</a>`;

    try {
      await this.bot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' });
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
    const statusEmoji = data.successful ? "✅" : "❌";
    const timestamp = new Date(data.timestamp).toLocaleString();

    let message = `<b>Transaction ${data.successful ? "Confirmed" : "Failed"}</b> ${statusEmoji}\n\n`;
    message += `📋 <b>Hash:</b> <code>${data.hash.slice(0, 8)}...${data.hash.slice(-8)}</code>\n`;
    message += `💰 <b>Amount:</b> ${data.amount} ${data.asset}\n`;
    message += `📤 <b>From:</b> <code>${data.from.slice(0, 4)}...${data.from.slice(-4)}</code>\n`;
    message += `📥 <b>To:</b> <code>${data.to.slice(0, 4)}...${data.to.slice(-4)}</code>\n`;
    message += `⏱️ <b>Time:</b> ${timestamp}\n`;

    if (data.fee) {
      message += `💵 <b>Fee:</b> ${data.fee} XLM\n`;
    }

    if (data.memo) {
      message += `📝 <b>Memo:</b> ${data.memo}\n`;
    }

    return message;
  }

  async sendNotification(userId: string, message: string): Promise<boolean> {
    if (!this.bot) {
      console.warn("⚠️ Telegram bot not initialized");
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
}
