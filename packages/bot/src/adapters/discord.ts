import {
  Client,
  GatewayIntentBits,
  Message,
  TextChannel,
  ThreadChannel,
  ChannelType,
  TextBasedChannel,
  ActivityType,
} from "discord.js";
import { TransactionNotificationData } from "../types";
import {
  createTrustlineOperation,
  getNetworkStatus,
} from "@chen-pilot/sdk-core";
import { searchFeatures, formatHelpMessage } from "../services/helpProvider";
import { AssetVerificationService } from '../assetVerification';
import { RateLimiter, DEFAULT_RATE_LIMIT, STRICT_RATE_LIMIT } from '../rateLimiter';
import { withPerformanceProfiling, extractCommandName } from '../performanceProfiler';

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";
const DASHBOARD_URL = process.env.DASHBOARD_URL || `${BACKEND_URL}/dashboard`;
const HORIZON_URL = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const DEBOUNCE_MS = 1000; // 1 second debounce between commands

// Commands that involve personal account data and must only be used in DMs
const DM_ONLY_COMMANDS = ['!balance', '!sponsor'];

// Commands that require stricter rate limiting
const SENSITIVE_COMMANDS = ['!sponsor', '!trustline', '!validate'];

function isDM(message: Message): boolean {
  return message.channel.type === ChannelType.DM;
}

async function rejectPublicChannel(message: Message): Promise<void> {
  await message.reply('🔒 This command contains sensitive account data and can only be used in a Direct Message (DM) with the bot.');
}

export class DiscordAdapter {
  private client: Client;
  private userChannels: Map<string, string> = new Map(); // userId -> channelId
  private token: string;
  // #145: Track last command timestamp per user
  private lastCommandTime: Map<string, number> = new Map();
  // #123: Rate limiters for bot commands
  private defaultRateLimiter: RateLimiter;
  private strictRateLimiter: RateLimiter;
  private verificationService: AssetVerificationService;

  constructor(token: string, auditLogChannelId?: string) {
    this.token = token;
    this.auditLogChannelId = auditLogChannelId || process.env.DISCORD_AUDIT_LOG_CHANNEL_ID;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
    this.verificationService = new AssetVerificationService(HORIZON_URL);
    // #123: Initialize rate limiters
    this.defaultRateLimiter = new RateLimiter(DEFAULT_RATE_LIMIT);
    this.strictRateLimiter = new RateLimiter(STRICT_RATE_LIMIT);
  }

  // #145: Returns true if the user is flooding (within debounce window)
  private isFlooding(userId: string): boolean {
    const now = Date.now();
    const last = this.lastCommandTime.get(userId) ?? 0;
    if (now - last < DEBOUNCE_MS) return true;
    this.lastCommandTime.set(userId, now);
    return false;
  }

  // #123: Check rate limit for a user and command
  private checkRateLimit(userId: string, command: string): { allowed: boolean; message?: string } {
    // Determine which rate limiter to use based on command
    const isSensitive = SENSITIVE_COMMANDS.some(cmd => command.startsWith(cmd));
    const rateLimiter = isSensitive ? this.strictRateLimiter : this.defaultRateLimiter;
    
    const status = rateLimiter.check(userId);
    
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
    const token = process.env.DISCORD_BOT_TOKEN || this.token;
    if (!token) {
      console.warn("⚠️ Discord: No token provided, skipping initialization.");
      return;
    }

    this.client.once("ready", () => {
      console.log(`✅ Discord bot logged in as ${this.client.user?.tag}`);
      this.startStatusUpdates();
    });

    this.client.on("messageCreate", withPerformanceProfiling(
      'messageCreate',
      'discord',
      'system',
      async (message: Message) => {
        if (message.author.bot) return;

        const userId = message.author.id;
        const command = message.content.split(' ')[0];
        const commandName = extractCommandName(message.content, 'discord');

        // #145: Anti-flood check for all commands
        if (this.isFlooding(userId)) {
          await message.reply("⏳ Please wait a moment before sending another command.");
          return;
        }

        // #123: Rate limit check
        const rateLimitResult = this.checkRateLimit(userId, command);
        if (!rateLimitResult.allowed) {
          await message.reply(rateLimitResult.message);
          return;
        }

        // Wrap each command handler with performance profiling
        if (message.content === "!start") {
          await withPerformanceProfiling('!start', 'discord', userId, async () => {
            await message.reply(
              "Welcome to Chen Pilot! I am your AI-powered Stellar DeFi assistant. Type !help to see what I can do!"
            );
          })();
        }

        if (message.content.startsWith("!help")) {
          await withPerformanceProfiling(commandName, 'discord', userId, async () => {
            const query = message.content.replace("!help", "").trim();
            const results = searchFeatures(query);
            const isSearch = query.length > 0;
            await message.reply(formatHelpMessage(results, isSearch, "markdown"));
          })();
        }

        if (message.content === "!thread") {
          await withPerformanceProfiling('!thread', 'discord', userId, async () => {
            if (message.channel.type === ChannelType.GuildText) {
              try {
                const thread = await message.startThread({
                  name: `Chen Pilot Session - ${message.author.username}`,
                  autoArchiveDuration: 60,
                });
                await thread.send(
                  `👋 Hello ${message.author.username}! I've started this thread to keep our conversation organized. How can I help you with Stellar DeFi today?`
                );
              } catch (error) {
                console.error("Error creating thread:", error);
                await message.reply(
                  "❌ I couldn't start a thread. Please make sure I have the 'Create Public Threads' permission."
                );
              }
            } else if (message.channel.isThread()) {
              await message.reply(
                "🧵 We are already in a thread! I'm ready to assist you here."
              );
            } else {
              await message.reply(
                "❌ Threads can only be started in text channels."
              );
            }
          })();
        }

        if (message.content === "!sponsor") {
          await withPerformanceProfiling('!sponsor', 'discord', userId, async () => {
            await message.reply("⏳ Requesting account sponsorship...");

            try {
              const response = await fetch(
                `${BACKEND_URL}/api/account/${userId}/sponsor`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                }
              );
              const data = (await response.json()) as {
                success: boolean;
                message: string;
                address?: string;
              };

              if (data.success) {
                await message.reply(
                  `✅ Account sponsored successfully!\n📬 Address: \`${data.address}\``
                );
                await this.logAuditAction({
                  action: 'SPONSOR_ACCOUNT',
                  triggeredBy: userId,
                  details: `Address: ${data.address}`,
                  success: true,
                  timestamp: new Date().toISOString(),
                });
              } else {
                await message.reply(`❌ Sponsorship failed: ${data.message}`);
                await this.logAuditAction({
                  action: 'SPONSOR_ACCOUNT',
                  triggeredBy: userId,
                  details: `Failed: ${data.message}`,
                  success: false,
                  timestamp: new Date().toISOString(),
                });
              }
            } catch (error) {
              console.error("Sponsor command error:", error);
              await message.reply(
                "❌ Could not reach the sponsorship service. Please try again later."
              );
            }
          })();
        }

        if (message.content.startsWith("!trustline")) {
          await withPerformanceProfiling(commandName, 'discord', userId, async () => {
            const args = message.content.split(" ").slice(1);
            if (args.length < 1) {
              return message.reply(
                "Usage: !trustline <assetCode> [issuerDomain|issuerAddress]\nExample: !trustline USDC circle.com"
              );
            }

            const assetCode = args[0];
            const assetIssuer = args[1];

            if (!assetIssuer) {
              return message.reply(
                `Please provide an issuer domain or address for ${assetCode}.`
              );
            }

            try {
              await message.reply(
                `🔍 Looking up asset ${assetCode} from ${assetIssuer}...`
              );
              const op = await createTrustlineOperation(assetCode, assetIssuer);

              let response = `✅ Found asset ${assetCode}!\n\n`;
              response += `To add this trustline, you can use the following details in your wallet:\n`;
              response += `**Asset:** ${assetCode}\n`;
              response += `**Issuer:** \`${(op as any).asset.issuer}\`\n\n`;
              response += `*Note: In a future update, I will provide a direct signing link.*`;

              await message.reply(response);
              await this.logAuditAction({
                action: 'TRUSTLINE_LOOKUP',
                triggeredBy: message.author.id,
                details: `Asset: ${assetCode}, Issuer: ${assetIssuer}`,
                success: true,
                timestamp: new Date().toISOString(),
              });
            } catch (error) {
              await message.reply(
                `❌ Error: ${error instanceof Error ? error.message : String(error)}`
              );
            }
          })();
        }

        // #146: Dashboard command
        if (message.content === '!dashboard') {
          await withPerformanceProfiling('!dashboard', 'discord', userId, async () => {
            await message.reply(
              `📊 **Chen Pilot Dashboard**\n\nAccess your admin dashboard here:\n🔗 ${DASHBOARD_URL}\n\n*Note: You must be logged in to view the dashboard.*`
            );
          })();
        }

        // #148: /validate command for Stellar asset verification
        if (message.content.startsWith('!validate')) {
          await withPerformanceProfiling(commandName, 'discord', userId, async () => {
            const args = message.content.split(' ').slice(1);
            if (args.length < 2) {
              return message.reply('Usage: !validate <assetCode> <issuerAddress>\nExample: !validate USDC GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
            }

            const [assetCode, issuerAddress] = args;
            await message.reply(`🔍 Verifying asset **${assetCode}** from issuer \`${issuerAddress.slice(0, 8)}...\``);

            try {
              const result = await this.verificationService.verifyAsset(assetCode, issuerAddress);
              const statusEmoji = result.status === 'VERIFIED' ? '✅' : result.status === 'MALICIOUS' ? '🚨' : '⚠️';

              let reply = `${statusEmoji} **Asset Verification: ${result.status}**\n\n`;
              reply += `**Asset:** ${assetCode}\n`;
              reply += `**Issuer:** \`${issuerAddress}\`\n`;
              if (result.domain) reply += `**Domain:** ${result.domain}\n`;
              if (result.details) reply += `**Details:** ${result.details}\n`;
              reply += `\n**Safe to use:** ${result.isSafe ? 'Yes ✅' : 'No ❌'}`;

              await message.reply(reply);
            } catch (error) {
              await message.reply(`❌ Verification error: ${error instanceof Error ? error.message : String(error)}`);
            }
          })();
        }
      }
    ));

    await this.client.login(token);
    console.log("✅ Discord bot initialized.");
  }

  // #147: Announce a new GitHub release to all registered announcement channels
  async announceRelease(channelId: string, release: { tag_name: string; name: string; html_url: string; body?: string }): Promise<boolean> {
    if (!this.client?.user) {
      console.warn("⚠️ Discord bot not initialized");
      return false;
    }

    const channel = this.client.channels.cache.get(channelId) as TextChannel;
    if (!channel) {
      console.warn(`⚠️ Announcement channel ${channelId} not found`);
      return false;
    }

    const body = release.body ? `\n\n${release.body.slice(0, 500)}${release.body.length > 500 ? '...' : ''}` : '';
    const message = `🚀 **New Release: ${release.name || release.tag_name}**${body}\n\n🔗 ${release.html_url}`;

    try {
      await channel.send(message);
      return true;
    } catch (error) {
      console.error("Error sending release announcement:", error);
      return false;
    }
  }

  async registerUser(userId: string, channelId: string): Promise<boolean> {
    this.userChannels.set(userId, channelId);
    return true;
  }

  async sendTransactionNotification(
    userId: string,
    data: TransactionNotificationData
  ): Promise<boolean> {
    if (!this.client || !this.client.user) {
      console.warn("⚠️ Discord bot not initialized");
      return false;
    }

    const channelId = this.userChannels.get(userId);
    if (!channelId) {
      console.warn(`⚠️ No channel ID found for user ${userId}`);
      return false;
    }

    const channel = this.client.channels.cache.get(
      channelId
    ) as TextBasedChannel;
    if (!channel) {
      console.warn(`⚠️ Channel or Thread ${channelId} not found`);
      return false;
    }

    const message = this.formatTransactionMessage(data);

    try {
      await channel.send(message);
      await this.logAuditAction({
        action: 'SEND_TRANSACTION_NOTIFICATION',
        triggeredBy: userId,
        details: `Hash: ${data.hash.slice(0, 8)}...${data.hash.slice(-8)}, Success: ${data.successful}`,
        success: true,
        timestamp: new Date().toISOString(),
      });
      return true;
    } catch (error) {
      console.error("Error sending Discord notification:", error);
      return false;
    }
  }

  private formatTransactionMessage(data: TransactionNotificationData): string {
    const statusEmoji = data.successful ? "✅" : "❌";
    const timestamp = new Date(data.timestamp).toLocaleString();

    let message = `**Transaction ${data.successful ? "Confirmed" : "Failed"}** ${statusEmoji}\n\n`;
    message += `📋 **Hash:** \`${data.hash.slice(0, 8)}...${data.hash.slice(-8)}\`\n`;
    message += `💰 **Amount:** ${data.amount} ${data.asset}\n`;
    message += `📤 **From:** \`${data.from.slice(0, 4)}...${data.from.slice(-4)}\`\n`;
    message += `📥 **To:** \`${data.to.slice(0, 4)}...${data.to.slice(-4)}\`\n`;
    message += `⏱️ **Time:** ${timestamp}\n`;

    if (data.fee) {
      message += `💵 **Fee:** ${data.fee} XLM\n`;
    }

    if (data.memo) {
      message += `📝 **Memo:** ${data.memo}\n`;
    }

    return message;
  }

  async sendNotification(userId: string, message: string): Promise<boolean> {
    if (!this.client || !this.client.user) {
      console.warn("⚠️ Discord bot not initialized");
      return false;
    }

    const channelId = this.userChannels.get(userId);
    if (!channelId) {
      return false;
    }

    const channel = this.client.channels.cache.get(
      channelId
    ) as TextBasedChannel;
    if (!channel) {
      return false;
    }

    try {
      await channel.send(message);
      return true;
    } catch (error) {
      console.error("Error sending Discord notification:", error);
      return false;
    }
  }

  getClient(): Client {
    return this.client;
  }

  /**
   * Start periodic status updates
   */
  private startStatusUpdates() {
    // Initial update
    this.updateBotStatus();

    // Update every 5 minutes
    setInterval(
      () => {
        this.updateBotStatus();
      },
      5 * 60 * 1000
    );
  }

  /**
   * Update the bot's Discord activity status
   */
  private async updateBotStatus() {
    if (!this.client.user) return;

    try {
      // Toggle between network status and a welcoming message
      const useNetworkStatus = Math.random() > 0.5;

      if (useNetworkStatus) {
        const status = await getNetworkStatus({ network: "mainnet" });
        const healthEmoji = status.health.isHealthy ? "🟢" : "🔴";
        const ledgerInfo = `L:${status.health.latestLedger}`;

        this.client.user.setActivity(
          `${healthEmoji} Stellar Network | ${ledgerInfo}`,
          {
            type: ActivityType.Watching,
          }
        );
      } else {
        this.client.user.setActivity("🚀 Stellar DeFi | !help", {
          type: ActivityType.Playing,
        });
      }
    } catch (error) {
      console.error("Error updating bot status:", error);
      // Fallback status
      this.client.user.setActivity("Stellar DeFi Assistant", {
        type: ActivityType.Custom,
      });
    }
  }
}
