"use strict";
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done
          ? resolve(result.value)
          : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiscordAdapter = void 0;
const discord_js_1 = require("discord.js");
const sdk_core_1 = require("@chen-pilot/sdk-core");
const helpProvider_1 = require("../services/helpProvider");
const assetVerification_1 = require("../assetVerification");
const rateLimiter_1 = require("../rateLimiter");
const performanceProfiler_1 = require("../performanceProfiler");
const multisigWizard_1 = require("../multisigWizard");
const scamDetection_1 = require("../scamDetection");
const marketOverview_1 = require("../marketOverview");
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";
const DASHBOARD_URL = process.env.DASHBOARD_URL || `${BACKEND_URL}/dashboard`;
const HORIZON_URL =
  process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";
const DEBOUNCE_MS = 2000;
// Role names required for advanced commands (#120)
const ADVANCED_ROLE_NAMES = (
  process.env.DISCORD_ADVANCED_ROLES || "DeFi Pro,Whale,Admin"
)
  .split(",")
  .map((r) => r.trim());
// Supported currencies for reports (#118)
const SUPPORTED_CURRENCIES = ["USD", "XLM", "BTC"];
// Commands that involve personal account data and must only be used in DMs
const DM_ONLY_COMMANDS = ["!balance", "!sponsor"];
// Commands that start a wizard
const WIZARD_COMMANDS = ["!multisig"];
// Commands that require stricter rate limiting
const SENSITIVE_COMMANDS = ["!sponsor", "!trustline", "!validate"];
// #124: Scam detection configuration
const SCAM_DETECTION_ENABLED =
  process.env.DISCORD_SCAM_DETECTION_ENABLED !== "false";
const SCAM_DETECTION_ACTION =
  process.env.DISCORD_SCAM_DETECTION_ACTION || "flag";
const SCAM_DETECTION_CHANNELS = (
  process.env.DISCORD_SCAM_DETECTION_CHANNELS || ""
)
  .split(",")
  .filter((c) => c.trim());
// #128: Daily market overview digest configuration
const MARKET_OVERVIEW_ENABLED =
  process.env.DISCORD_MARKET_OVERVIEW_ENABLED === "true";
const MARKET_OVERVIEW_CHANNEL_ID =
  process.env.DISCORD_MARKET_OVERVIEW_CHANNEL_ID || "";
const MARKET_OVERVIEW_TIME =
  process.env.DISCORD_MARKET_OVERVIEW_TIME || "09:00"; // Format: HH:MM in UTC
function isDM(message) {
  return message.channel.type === discord_js_1.ChannelType.DM;
}
function rejectPublicChannel(message) {
  return __awaiter(this, void 0, void 0, function* () {
    yield message.reply(
      "🔒 This command contains sensitive account data and can only be used in a Direct Message (DM) with the bot."
    );
  });
}
class DiscordAdapter {
  constructor(token, auditLogChannelId) {
    this.userChannels = new Map(); // userId -> channelId
    // #145: Track last command timestamp per user
    this.lastCommandTime = new Map();
    // #118: User preferred currency (userId -> currency)
    this.userCurrency = new Map();
    // #119: Active price alerts
    this.priceAlerts = new Map();
    this.token = token;
    this.auditLogChannelId =
      auditLogChannelId || process.env.DISCORD_AUDIT_LOG_CHANNEL_ID;
    this.client = new discord_js_1.Client({
      intents: [
        discord_js_1.GatewayIntentBits.Guilds,
        discord_js_1.GatewayIntentBits.GuildMessages,
        discord_js_1.GatewayIntentBits.MessageContent,
        discord_js_1.GatewayIntentBits.GuildMembers,
      ],
    });
    this.verificationService = new assetVerification_1.AssetVerificationService(
      HORIZON_URL
    );
    // #125: Initialize multisig wizard
    this.multisigWizard = new multisigWizard_1.MultisigWizard();
    // #123: Initialize rate limiters
    this.defaultRateLimiter = new rateLimiter_1.RateLimiter(
      rateLimiter_1.DEFAULT_RATE_LIMIT
    );
    this.strictRateLimiter = new rateLimiter_1.RateLimiter(
      rateLimiter_1.STRICT_RATE_LIMIT
    );
    // #124: Initialize scam detection service
    this.scamDetectionService = new scamDetection_1.ScamDetectionService();
    // #128: Initialize market overview service
    this.marketOverviewService = new marketOverview_1.MarketOverviewService();
  }
  // #145: Returns true if the user is flooding (within debounce window)
  isFlooding(userId) {
    var _a;
    const now = Date.now();
    const last =
      (_a = this.lastCommandTime.get(userId)) !== null && _a !== void 0
        ? _a
        : 0;
    if (now - last < DEBOUNCE_MS) return true;
    this.lastCommandTime.set(userId, now);
    return false;
  }
  // #123: Check rate limit for a user and command
  checkRateLimit(userId, command) {
    // Determine which rate limiter to use based on command
    const isSensitive = SENSITIVE_COMMANDS.some((cmd) =>
      command.startsWith(cmd)
    );
    const rateLimiter = isSensitive
      ? this.strictRateLimiter
      : this.defaultRateLimiter;
    const status = rateLimiter.check(userId);
    if (!status.allowed) {
      const retryAfter = status.retryAfter || 60;
      return {
        allowed: false,
        message: `⏳ Rate limit exceeded. Please wait ${retryAfter} seconds before trying again.`,
      };
    }
    return { allowed: true };
  }
  // #124: Check if scam detection should be applied to a channel
  shouldScanForScams(message) {
    if (!SCAM_DETECTION_ENABLED) return false;
    if (isDM(message)) return false; // Don't scan DMs
    // If specific channels are configured, only scan those
    if (SCAM_DETECTION_CHANNELS.length > 0) {
      return SCAM_DETECTION_CHANNELS.includes(message.channelId);
    }
    // Otherwise, scan all public channels
    return true;
  }
  // #124: Handle detected scam links
  handleScamDetection(message, result) {
    return __awaiter(this, void 0, void 0, function* () {
      const warningMessage =
        `🚨 **Potential Scam Link Detected**\n\n` +
        `**Reason:** ${result.reason}\n` +
        `**Pattern:** \`${result.matchedPattern}\`\n\n` +
        `This message has been ${SCAM_DETECTION_ACTION === "block" ? "blocked" : "flagged"} for your safety.`;
      if (SCAM_DETECTION_ACTION === "block") {
        yield message.delete();
        // Cast to TextChannel since we only scan public channels
        if (
          message.channel.type === discord_js_1.ChannelType.GuildText ||
          message.channel.type === discord_js_1.ChannelType.GuildPublicThread ||
          message.channel.type === discord_js_1.ChannelType.GuildPrivateThread
        ) {
          yield message.channel.send(warningMessage);
        }
      } else {
        yield message.reply(warningMessage);
      }
      // Log to audit channel if configured
      yield this.logAuditAction({
        action: "SCAM_LINK_DETECTED",
        triggeredBy: message.author.id,
        details: `Reason: ${result.reason}, Pattern: ${result.matchedPattern}, Action: ${SCAM_DETECTION_ACTION}`,
        success: true,
        timestamp: new Date().toISOString(),
      });
    });
  }
  // #128: Calculate milliseconds until next scheduled market overview post
  getTimeUntilNextSchedule() {
    const [hours, minutes] = MARKET_OVERVIEW_TIME.split(":").map(Number);
    const now = new Date();
    const scheduledTime = new Date();
    scheduledTime.setUTCHours(hours, minutes, 0, 0);
    // If the scheduled time has already passed today, schedule for tomorrow
    if (scheduledTime <= now) {
      scheduledTime.setDate(scheduledTime.getDate() + 1);
    }
    return scheduledTime.getTime() - now.getTime();
  }
  // #128: Post daily market overview to configured channel
  postMarketOverview() {
    return __awaiter(this, void 0, void 0, function* () {
      if (!MARKET_OVERVIEW_CHANNEL_ID) {
        console.warn(
          "⚠️ Market overview channel ID not configured, skipping digest"
        );
        return;
      }
      try {
        console.log("📊 Fetching daily market overview...");
        const marketData =
          yield this.marketOverviewService.fetchMarketOverview();
        const message =
          this.marketOverviewService.formatMarketOverviewMessage(marketData);
        const channel = this.client.channels.cache.get(
          MARKET_OVERVIEW_CHANNEL_ID
        );
        if (!channel) {
          console.error(
            `❌ Market overview channel ${MARKET_OVERVIEW_CHANNEL_ID} not found`
          );
          return;
        }
        yield channel.send(message);
        console.log("✅ Daily market overview posted successfully");
        yield this.logAuditAction({
          action: "MARKET_OVERVIEW_POSTED",
          triggeredBy: "system",
          details: `Channel: ${MARKET_OVERVIEW_CHANNEL_ID}`,
          success: true,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("❌ Error posting market overview:", error);
        yield this.logAuditAction({
          action: "MARKET_OVERVIEW_FAILED",
          triggeredBy: "system",
          details: `Error: ${error instanceof Error ? error.message : String(error)}`,
          success: false,
          timestamp: new Date().toISOString(),
        });
      }
    });
  }
  // #128: Start the daily market overview scheduler
  startMarketOverviewScheduler() {
    if (!MARKET_OVERVIEW_ENABLED || !MARKET_OVERVIEW_CHANNEL_ID) {
      console.log("ℹ️ Market overview digest disabled or not configured");
      return;
    }
    const initialDelay = this.getTimeUntilNextSchedule();
    console.log(
      `📅 Market overview digest scheduled for ${MARKET_OVERVIEW_TIME} UTC (next post in ${Math.round(initialDelay / 1000 / 60)} minutes)`
    );
    // Schedule the first post
    setTimeout(
      () =>
        __awaiter(this, void 0, void 0, function* () {
          yield this.postMarketOverview();
          // Then schedule daily posts (24 hours = 86400000 ms)
          this.marketOverviewInterval = setInterval(
            () =>
              __awaiter(this, void 0, void 0, function* () {
                yield this.postMarketOverview();
              }),
            24 * 60 * 60 * 1000
          );
        }),
      initialDelay
    );
  }
  init() {
    return __awaiter(this, void 0, void 0, function* () {
      const token = process.env.DISCORD_BOT_TOKEN || this.token;
      if (!token) {
        console.warn("⚠️ Discord: No token provided, skipping initialization.");
        return;
      }
      this.client.once("ready", () => {
        var _a;
        console.log(
          `✅ Discord bot logged in as ${(_a = this.client.user) === null || _a === void 0 ? void 0 : _a.tag}`
        );
        this.startStatusUpdates();
        // #117: Automated welcome flow for new server members
        this.client.on("guildMemberAdd", (member) =>
          __awaiter(this, void 0, void 0, function* () {
            try {
              yield this.sendWelcomeMessage(member);
            } catch (error) {
              console.error("❌ Error sending welcome message:", error);
            }
          })
        );
      });
      this.client.on(
        "messageCreate",
        (0, performanceProfiler_1.withPerformanceProfiling)(
          "messageCreate",
          "discord",
          "system",
          (message) =>
            __awaiter(this, void 0, void 0, function* () {
              var _a, _b, _c, _d, _e, _f;
              if (message.author.bot) return;
              // #124: Scan for scam links in public channels
              if (this.shouldScanForScams(message)) {
                const scamResult = this.scamDetectionService.detectScamLinks(
                  message.content
                );
                if (scamResult.isScam) {
                  yield this.handleScamDetection(message, scamResult);
                  return; // Stop processing if scam is detected and blocked
                }
              }
              const userId = message.author.id;
              const command = message.content.split(" ")[0];
              const commandName = (0, performanceProfiler_1.extractCommandName)(
                message.content,
                "discord"
              );
              // #145: Anti-flood check for all commands
              if (this.isFlooding(userId)) {
                yield message.reply(
                  "⏳ Please wait a moment before sending another command."
                );
                return;
              }
              // #123: Rate limit check
              const rateLimitResult = this.checkRateLimit(userId, command);
              if (!rateLimitResult.allowed) {
                yield message.reply(
                  (_a = rateLimitResult.message) !== null && _a !== void 0
                    ? _a
                    : "⏳ Rate limit exceeded. Please try again later."
                );
                return;
              }
              // Wrap each command handler with performance profiling
              if (message.content === "!start") {
                yield (0, performanceProfiler_1.withPerformanceProfiling)(
                  "!start",
                  "discord",
                  userId,
                  () =>
                    __awaiter(this, void 0, void 0, function* () {
                      yield message.reply(
                        "Welcome to Chen Pilot! I am your AI-powered Stellar DeFi assistant. Type !help to see what I can do!"
                      );
                    })
                )();
              }
              // #134: Ping command — measure end-to-end latency
              if (message.content === "!ping") {
                yield (0, performanceProfiler_1.withPerformanceProfiling)(
                  "!ping",
                  "discord",
                  userId,
                  () =>
                    __awaiter(this, void 0, void 0, function* () {
                      const startTime = Date.now();
                      try {
                        const controller = new AbortController();
                        const timeout = setTimeout(
                          () => controller.abort(),
                          5000
                        );
                        const response = yield fetch(
                          `${BACKEND_URL}/api/health`,
                          {
                            method: "GET",
                            signal: controller.signal,
                          }
                        );
                        clearTimeout(timeout);
                        const roundtripMs = Date.now() - startTime;
                        if (response.ok) {
                          yield message.reply(
                            `🏓 **Pong!**\n\n📡 **End-to-End Latency:** ${roundtripMs}ms\n✅ Backend: Online`
                          );
                        } else {
                          yield message.reply(
                            `🏓 **Pong!**\n\n📡 **End-to-End Latency:** ${roundtripMs}ms\n⚠️ Backend: Returned HTTP ${response.status}`
                          );
                        }
                      } catch (_a) {
                        const roundtripMs = Date.now() - startTime;
                        yield message.reply(
                          `🏓 **Pong!**\n\n📡 **End-to-End Latency:** ${roundtripMs}ms\n❌ Backend: Unreachable`
                        );
                      }
                    })
                )();
              }
              if (message.content.startsWith("!help")) {
                yield (0, performanceProfiler_1.withPerformanceProfiling)(
                  commandName,
                  "discord",
                  userId,
                  () =>
                    __awaiter(this, void 0, void 0, function* () {
                      const query = message.content.replace("!help", "").trim();
                      const results = (0, helpProvider_1.searchFeatures)(query);
                      const isSearch = query.length > 0;
                      yield message.reply(
                        (0, helpProvider_1.formatHelpMessage)(
                          results,
                          isSearch,
                          "markdown"
                        )
                      );
                    })
                )();
              }
              if (message.content === "!thread") {
                yield (0, performanceProfiler_1.withPerformanceProfiling)(
                  "!thread",
                  "discord",
                  userId,
                  () =>
                    __awaiter(this, void 0, void 0, function* () {
                      if (
                        message.channel.type ===
                        discord_js_1.ChannelType.GuildText
                      ) {
                        try {
                          const thread = yield message.startThread({
                            name: `Chen Pilot Session - ${message.author.username}`,
                            autoArchiveDuration: 60,
                          });
                          yield thread.send(
                            `👋 Hello ${message.author.username}! I've started this thread to keep our conversation organized. How can I help you with Stellar DeFi today?`
                          );
                        } catch (error) {
                          console.error("Error creating thread:", error);
                          yield message.reply(
                            "❌ I couldn't start a thread. Please make sure I have the 'Create Public Threads' permission."
                          );
                        }
                      } else if (message.channel.isThread()) {
                        yield message.reply(
                          "🧵 We are already in a thread! I'm ready to assist you here."
                        );
                      } else {
                        yield message.reply(
                          "❌ Threads can only be started in text channels."
                        );
                      }
                    })
                )();
              }
              if (message.content === "!sponsor") {
                yield (0, performanceProfiler_1.withPerformanceProfiling)(
                  "!sponsor",
                  "discord",
                  userId,
                  () =>
                    __awaiter(this, void 0, void 0, function* () {
                      yield message.reply(
                        "⏳ Requesting account sponsorship..."
                      );
                      try {
                        const response = yield fetch(
                          `${BACKEND_URL}/api/account/${userId}/sponsor`,
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                          }
                        );
                        const data = yield response.json();
                        if (data.success) {
                          yield message.reply(
                            `✅ Account sponsored successfully!\n📬 Address: \`${data.address}\``
                          );
                          yield this.logAuditAction({
                            action: "SPONSOR_ACCOUNT",
                            triggeredBy: userId,
                            details: `Address: ${data.address}`,
                            success: true,
                            timestamp: new Date().toISOString(),
                          });
                        } else {
                          yield message.reply(
                            `❌ Sponsorship failed: ${data.message}`
                          );
                          yield this.logAuditAction({
                            action: "SPONSOR_ACCOUNT",
                            triggeredBy: userId,
                            details: `Failed: ${data.message}`,
                            success: false,
                            timestamp: new Date().toISOString(),
                          });
                        }
                      } catch (error) {
                        console.error("Sponsor command error:", error);
                        yield message.reply(
                          "❌ Could not reach the sponsorship service. Please try again later."
                        );
                      }
                    })
                )();
              }
              if (message.content.startsWith("!trustline")) {
                yield (0, performanceProfiler_1.withPerformanceProfiling)(
                  commandName,
                  "discord",
                  userId,
                  () =>
                    __awaiter(this, void 0, void 0, function* () {
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
                        yield message.reply(
                          `🔍 Looking up asset ${assetCode} from ${assetIssuer}...`
                        );
                        const op = yield (0,
                        sdk_core_1.createTrustlineOperation)(
                          assetCode,
                          assetIssuer
                        );
                        let response = `✅ Found asset ${assetCode}!\n\n`;
                        response += `To add this trustline, you can use the following details in your wallet:\n`;
                        response += `**Asset:** ${assetCode}\n`;
                        response += `**Issuer:** \`${op.asset.issuer}\`\n\n`;
                        response += `*Note: In a future update, I will provide a direct signing link.*`;
                        yield message.reply(response);
                        yield this.logAuditAction({
                          action: "TRUSTLINE_LOOKUP",
                          triggeredBy: message.author.id,
                          details: `Asset: ${assetCode}, Issuer: ${assetIssuer}`,
                          success: true,
                          timestamp: new Date().toISOString(),
                        });
                      } catch (error) {
                        yield message.reply(
                          `❌ Error: ${error instanceof Error ? error.message : String(error)}`
                        );
                      }
                    })
                )();
              }
              // #146: Dashboard command
              if (message.content === "!dashboard") {
                yield (0, performanceProfiler_1.withPerformanceProfiling)(
                  "!dashboard",
                  "discord",
                  userId,
                  () =>
                    __awaiter(this, void 0, void 0, function* () {
                      yield message.reply(
                        `📊 **Chen Pilot Dashboard**\n\nAccess your admin dashboard here:\n🔗 ${DASHBOARD_URL}\n\n*Note: You must be logged in to view the dashboard.*`
                      );
                    })
                )();
              }
              // #148: /validate command for Stellar asset verification
              if (message.content.startsWith("!validate")) {
                yield (0, performanceProfiler_1.withPerformanceProfiling)(
                  commandName,
                  "discord",
                  userId,
                  () =>
                    __awaiter(this, void 0, void 0, function* () {
                      const args = message.content.split(" ").slice(1);
                      if (args.length < 2) {
                        return message.reply(
                          "Usage: !validate <assetCode> <issuerAddress>\nExample: !validate USDC GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
                        );
                      }
                      const [assetCode, issuerAddress] = args;
                      yield message.reply(
                        `🔍 Verifying asset **${assetCode}** from issuer \`${issuerAddress.slice(0, 8)}...\``
                      );
                      try {
                        const result =
                          yield this.verificationService.verifyAsset(
                            assetCode,
                            issuerAddress
                          );
                        const statusEmoji =
                          result.status === "VERIFIED"
                            ? "✅"
                            : result.status === "MALICIOUS"
                              ? "🚨"
                              : "⚠️";
                        let reply = `${statusEmoji} **Asset Verification: ${result.status}**\n\n`;
                        reply += `**Asset:** ${assetCode}\n`;
                        reply += `**Issuer:** \`${issuerAddress}\`\n`;
                        if (result.domain)
                          reply += `**Domain:** ${result.domain}\n`;
                        if (result.details)
                          reply += `**Details:** ${result.details}\n`;
                        reply += `\n**Safe to use:** ${result.isSafe ? "Yes ✅" : "No ❌"}`;
                        yield message.reply(reply);
                      } catch (error) {
                        yield message.reply(
                          `❌ Verification error: ${error instanceof Error ? error.message : String(error)}`
                        );
                      }
                    })
                )();
              }
              // #125: Multisig wizard command
              if (message.content === "!multisig") {
                if (!isDM(message)) {
                  yield rejectPublicChannel(message);
                  return;
                }
                const response = this.multisigWizard.startWizard(
                  userId,
                  "discord"
                );
                yield message.reply(response.message);
              }
              // Handle wizard input (for active wizard sessions)
              const wizardState = this.multisigWizard.getWizardState(
                userId,
                "discord"
              );
              if (
                wizardState &&
                !WIZARD_COMMANDS.includes(message.content.split(" ")[0])
              ) {
                const response = this.multisigWizard.processInput(
                  userId,
                  "discord",
                  message.content
                );
                yield message.reply(response.message);
              }
              // #118: !currency command — set preferred report currency
              if (message.content.startsWith("!currency")) {
                const arg =
                  (_b = message.content.split(" ")[1]) === null || _b === void 0
                    ? void 0
                    : _b.toUpperCase();
                if (!arg || !SUPPORTED_CURRENCIES.includes(arg)) {
                  return message.reply(
                    `Usage: !currency <USD|XLM|BTC>\nCurrent: **${(_c = this.userCurrency.get(userId)) !== null && _c !== void 0 ? _c : "USD"}**`
                  );
                }
                this.userCurrency.set(userId, arg);
                return message.reply(`✅ Report currency set to **${arg}**`);
              }
              // #118: !report command — portfolio report in preferred currency
              if (message.content.startsWith("!report")) {
                const currency =
                  (_d = this.userCurrency.get(userId)) !== null && _d !== void 0
                    ? _d
                    : "USD";
                yield message.reply(
                  `⏳ Fetching portfolio report in **${currency}**...`
                );
                try {
                  const res = yield fetch(
                    `${BACKEND_URL}/api/portfolio/${userId}?currency=${currency}`
                  );
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  const data = yield res.json();
                  let reply = `📊 **Portfolio Report (${currency})**\n\n`;
                  reply += `**Total Value:** ${data.totalValue.toFixed(4)} ${currency}\n\n`;
                  for (const a of data.assets) {
                    reply += `• **${a.code}**: ${a.balance} ≈ ${a.value.toFixed(4)} ${currency}\n`;
                  }
                  return message.reply(reply);
                } catch (_g) {
                  return message.reply(
                    `❌ Could not fetch portfolio. Make sure your account is registered.`
                  );
                }
              }
              // #119: !alert command — set a price alert
              if (message.content.startsWith("!alert")) {
                const args = message.content.split(" ").slice(1);
                if (args.length < 3) {
                  return message.reply(
                    "Usage: !alert <assetCode> <above|below> <price> [USD|XLM|BTC]\nExample: !alert XLM above 0.15 USD"
                  );
                }
                const [assetCode, conditionRaw, priceRaw, currencyRaw] = args;
                const condition = conditionRaw.toLowerCase();
                if (condition !== "above" && condition !== "below") {
                  return message.reply(
                    "❌ Condition must be `above` or `below`."
                  );
                }
                const targetPrice = parseFloat(priceRaw);
                if (isNaN(targetPrice) || targetPrice <= 0) {
                  return message.reply("❌ Price must be a positive number.");
                }
                const currency =
                  (_f =
                    (_e =
                      currencyRaw === null || currencyRaw === void 0
                        ? void 0
                        : currencyRaw.toUpperCase()) !== null && _e !== void 0
                      ? _e
                      : this.userCurrency.get(userId)) !== null && _f !== void 0
                    ? _f
                    : "USD";
                if (!SUPPORTED_CURRENCIES.includes(currency)) {
                  return message.reply(
                    `❌ Currency must be one of: ${SUPPORTED_CURRENCIES.join(", ")}`
                  );
                }
                const alertId = `${userId}-${assetCode}-${Date.now()}`;
                const alert = {
                  id: alertId,
                  userId,
                  assetCode: assetCode.toUpperCase(),
                  targetPrice,
                  currency,
                  condition,
                  createdAt: new Date().toISOString(),
                  triggered: false,
                };
                this.priceAlerts.set(alertId, alert);
                // Register channel for DM delivery
                if (!this.userChannels.has(userId))
                  this.userChannels.set(userId, message.channelId);
                return message.reply(
                  `🔔 Alert set: notify me when **${assetCode.toUpperCase()}** is ${condition} **${targetPrice} ${currency}**`
                );
              }
              // #119: !alerts — list active alerts
              if (message.content === "!alerts") {
                const userAlerts = [...this.priceAlerts.values()].filter(
                  (a) => a.userId === userId && !a.triggered
                );
                if (userAlerts.length === 0)
                  return message.reply(
                    "📭 You have no active price alerts. Use `!alert` to set one."
                  );
                let reply = `🔔 **Your Active Alerts**\n\n`;
                for (const a of userAlerts) {
                  reply += `• **${a.assetCode}** ${a.condition} ${a.targetPrice} ${a.currency} (ID: \`${a.id.slice(-6)}\`)\n`;
                }
                return message.reply(reply);
              }
              // #120: !advanced — role-gated command example
              if (message.content.startsWith("!advanced")) {
                if (!this.hasAdvancedRole(message)) {
                  return message.reply(
                    `🔒 This command requires one of the following roles: **${ADVANCED_ROLE_NAMES.join(", ")}**`
                  );
                }
                return message.reply(
                  "✅ Advanced command executed. (Role check passed)"
                );
              }
              // #121: !discover — suggest trending Stellar assets
              if (message.content === "!discover") {
                if (!this.hasAdvancedRole(message)) {
                  return message.reply(
                    `🔒 \`!discover\` requires one of the following roles: **${ADVANCED_ROLE_NAMES.join(", ")}**`
                  );
                }
                yield message.reply(
                  "🔍 Discovering trending Stellar assets..."
                );
                try {
                  const res = yield fetch(`${BACKEND_URL}/api/assets/trending`);
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  const assets = yield res.json();
                  if (!assets.length)
                    return message.reply(
                      "📭 No trending assets found at this time."
                    );
                  let reply = `🌟 **Trending Stellar Assets**\n\n`;
                  for (const a of assets.slice(0, 5)) {
                    const change =
                      a.priceChange24h >= 0
                        ? `+${a.priceChange24h.toFixed(2)}%`
                        : `${a.priceChange24h.toFixed(2)}%`;
                    const emoji = a.priceChange24h >= 0 ? "📈" : "📉";
                    reply += `${emoji} **${a.assetCode}**${a.domain ? ` (${a.domain})` : ""}\n`;
                    reply += `  24h Change: ${change} | Volume: ${a.volume24h.toLocaleString()} | Holders: ${a.holders.toLocaleString()}\n\n`;
                  }
                  return message.reply(reply);
                } catch (_h) {
                  return message.reply(
                    "❌ Could not fetch trending assets. Please try again later."
                  );
                }
              }
            })
        )
      );
      yield this.client.login(token);
      this.startAlertPolling();
      // #128: Start market overview scheduler
      this.startMarketOverviewScheduler();
      console.log("✅ Discord bot initialized.");
    });
  }
  // #120: Check if message author has an advanced role
  hasAdvancedRole(message) {
    if (!message.member) return false;
    return message.member.roles.cache.some((r) =>
      ADVANCED_ROLE_NAMES.includes(r.name)
    );
  }
  // #119: Poll prices and fire triggered alerts via DM
  startAlertPolling() {
    this.alertCheckInterval = setInterval(
      () =>
        __awaiter(this, void 0, void 0, function* () {
          const pending = [...this.priceAlerts.values()].filter(
            (a) => !a.triggered
          );
          if (!pending.length) return;
          for (const alert of pending) {
            try {
              const res = yield fetch(
                `${BACKEND_URL}/api/price/${alert.assetCode}?currency=${alert.currency}`
              );
              if (!res.ok) continue;
              const { price } = yield res.json();
              const triggered =
                alert.condition === "above"
                  ? price >= alert.targetPrice
                  : price <= alert.targetPrice;
              if (!triggered) continue;
              alert.triggered = true;
              const channelId = this.userChannels.get(alert.userId);
              if (!channelId) continue;
              const channel = this.client.channels.cache.get(channelId);
              if (!channel) continue;
              yield channel.send(
                `🔔 **Price Alert Triggered!**\n**${alert.assetCode}** is now ${alert.condition} **${alert.targetPrice} ${alert.currency}** (current: ${price} ${alert.currency})`
              );
            } catch (/* ignore per-alert errors */ _a) {
              /* ignore per-alert errors */
            }
          }
        }),
      60000
    ); // check every minute
  }
  logAuditAction(entry) {
    return __awaiter(this, void 0, void 0, function* () {
      var _a;
      if (!this.auditLogChannelId || !this.client) return;
      try {
        const ch = this.client.channels.cache.get(this.auditLogChannelId);
        if (ch && typeof ch.send === "function") {
          yield ch.send(
            `📝 Audit: ${entry.action} by ${entry.triggeredBy} — ${(_a = entry.details) !== null && _a !== void 0 ? _a : ""}`
          );
        }
      } catch (e) {
        console.error("Audit log failed", e);
      }
    });
  }
  // #147: Announce a new GitHub release to all registered announcement channels
  announceRelease(channelId, release) {
    return __awaiter(this, void 0, void 0, function* () {
      var _a;
      if (!((_a = this.client) === null || _a === void 0 ? void 0 : _a.user)) {
        console.warn("⚠️ Discord bot not initialized");
        return false;
      }
      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        console.warn(`⚠️ Announcement channel ${channelId} not found`);
        return false;
      }
      const body = release.body
        ? `\n\n${release.body.slice(0, 500)}${release.body.length > 500 ? "..." : ""}`
        : "";
      const message = `🚀 **New Release: ${release.name || release.tag_name}**${body}\n\n🔗 ${release.html_url}`;
      try {
        yield channel.send(message);
        return true;
      } catch (error) {
        console.error("Error sending release announcement:", error);
        return false;
      }
    });
  }
  registerUser(userId, channelId) {
    return __awaiter(this, void 0, void 0, function* () {
      this.userChannels.set(userId, channelId);
      return true;
    });
  }
  sendTransactionNotification(userId, data) {
    return __awaiter(this, void 0, void 0, function* () {
      if (!this.client || !this.client.user) {
        console.warn("⚠️ Discord bot not initialized");
        return false;
      }
      const channelId = this.userChannels.get(userId);
      if (!channelId) {
        console.warn(`⚠️ No channel ID found for user ${userId}`);
        return false;
      }
      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        console.warn(`⚠️ Channel or Thread ${channelId} not found`);
        return false;
      }
      const message = this.formatTransactionMessage(data);
      try {
        yield channel.send(message);
        yield this.logAuditAction({
          action: "SEND_TRANSACTION_NOTIFICATION",
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
    });
  }
  formatTransactionMessage(data) {
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
  sendNotification(userId, message) {
    return __awaiter(this, void 0, void 0, function* () {
      if (!this.client || !this.client.user) {
        console.warn("⚠️ Discord bot not initialized");
        return false;
      }
      const channelId = this.userChannels.get(userId);
      if (!channelId) {
        return false;
      }
      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        return false;
      }
      try {
        yield channel.send(message);
        return true;
      } catch (error) {
        console.error("Error sending Discord notification:", error);
        return false;
      }
    });
  }
  getClient() {
    return this.client;
  }
  /**
   * Start periodic status updates
   */
  startStatusUpdates() {
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
  updateBotStatus() {
    return __awaiter(this, void 0, void 0, function* () {
      if (!this.client.user) return;
      try {
        // Toggle between network status and a welcoming message
        const useNetworkStatus = Math.random() > 0.5;
        if (useNetworkStatus) {
          const status = yield (0, sdk_core_1.getNetworkStatus)({
            network: "mainnet",
          });
          const healthEmoji = status.health.isHealthy ? "🟢" : "🔴";
          const ledgerInfo = `L:${status.health.latestLedger}`;
          this.client.user.setActivity(
            `${healthEmoji} Stellar Network | ${ledgerInfo}`,
            {
              type: discord_js_1.ActivityType.Watching,
            }
          );
        } else {
          this.client.user.setActivity("🚀 Stellar DeFi | !help", {
            type: discord_js_1.ActivityType.Playing,
          });
        }
      } catch (error) {
        console.error("Error updating bot status:", error);
        // Fallback status
        this.client.user.setActivity("Stellar DeFi Assistant", {
          type: discord_js_1.ActivityType.Custom,
        });
      }
    });
  }
  // #117: Send interactive welcome message to new server members
  sendWelcomeMessage(member) {
    return __awaiter(this, void 0, void 0, function* () {
      const username = member.user.username;
      const welcomeChannel = member.guild.systemChannel;
      // Try to DM the member first, fall back to the server's system channel
      const sendMessage = (content) =>
        __awaiter(this, void 0, void 0, function* () {
          try {
            yield member.send(content);
            return "dm";
          } catch (_a) {
            // Cannot DM — member likely has DMs disabled
            if (welcomeChannel) {
              yield welcomeChannel.send({
                content,
                allowedMentions: { users: [member.id] },
              });
              return "channel";
            }
            return null;
          }
        });
      // Step 1: Initial welcome greeting
      const greeting = `🎉 **Welcome to the Chen Pilot Community, ${username}!** 🎉

I'm **Chen Pilot**, your AI-powered Stellar DeFi assistant! I'm here to help you navigate the Stellar ecosystem, manage your assets, and discover decentralized finance opportunities.

Let me walk you through everything you can do with me! 🚀`;
      const sentVia = yield sendMessage(greeting);
      if (!sentVia) {
        console.warn(
          `⚠️ Could not send welcome message to ${member.id}: no DM access and no system channel`
        );
        return;
      }
      // Log welcome event
      yield this.logAuditAction({
        action: "WELCOME_MESSAGE_SENT",
        triggeredBy: member.id,
        details: `Username: ${username}, Sent via: ${sentVia === "dm" ? "DM" : "system channel"}`,
        success: true,
        timestamp: new Date().toISOString(),
      });
      // Small delay between messages for readability
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      yield delay(1000);
      // Step 2: Wallet connection guide
      const walletGuide = `**🔗 Step 1: Connect Your Stellar Wallet**

To get started with DeFi on Stellar, you need a wallet. Here's how:

1️⃣ **Get a Wallet**: Download *Freighter* (Stellar's official browser extension) from \`freighter.app\`
2️⃣ **Fund Your Account**: Use \`!sponsor\` to request free account sponsorship (covers minimum balance)
3️⃣ **Trustlines**: Use \`!trustline <assetCode> <issuer>\` to add assets like **USDC**, **XLM**, etc.
4️⃣ **Verify**: Use \`!validate <assetCode> <issuer>\` to check if an asset is safe before interacting

> 💡 *Tip: Always verify unknown assets with \`!validate\` to avoid scams!*`;
      yield sendMessage(walletGuide);
      yield delay(1000);
      // Step 3: Essential commands overview
      const commandsOverview = `**📋 Step 2: Essential Commands**

Here are the key commands to get started:

• **!help** — List all available features
• **!balance** — Check your wallet balance (DM only)
• **!report** — Portfolio summary in your chosen currency
• **!currency <USD|XLM|BTC>** — Set your preferred reporting currency
• **!ping** — Check bot latency and backend health
• **!alert <asset> <above|below> <price>** — Set price alerts
• **!alerts** — View your active alerts
• **!discover** — Explore trending Stellar assets (requires role)
• **!dashboard** — Open the admin dashboard

> 🔒 *Commands marked "DM only" must be sent in a private message for security.*`;
      yield sendMessage(commandsOverview);
      yield delay(1000);
      // Step 4: Advanced features teaser
      const advancedTeaser = `**⚡ Step 3: Advanced Features**

Ready to level up? Here's what else I can do:

• **🔐 Multi-Sig Wallets**: Use \`!multisig\` in DMs to set up multi-signature security
• **🧵 Support Threads**: Type \`!thread\` to create a dedicated support session
• **📊 Price Alerts**: Stay on top of market movements with \`!alert\`
• **🔍 Asset Verification**: Protect yourself with \`!validate\`
• **📈 Market Overview**: Get daily market digests (if configured)

New features are constantly being added — type **!help** anytime to see what's new!

---

**🚀 Ready to dive in?** Start by setting your reporting currency with \`!currency\`, then use \`!sponsor\` to fund your account, and you're on your way!`;
      yield sendMessage(advancedTeaser);
      yield delay(1000);
      // Step 5: Final tips
      const finalTips = `**💡 Pro Tips**

✅ **Use DMs for sensitive commands** — Commands like \`!balance\` and \`!sponsor\` only work in DMs for your safety
✅ **Rate limits apply** — Please wait 2 seconds between commands to avoid flooding
✅ **Report scams** — Suspicious links are automatically detected and flagged
✅ **Stay updated** — Type \`!help\` anytime for the latest features

If you ever need help, just send \`!help\` or type \`!thread\` to start a support conversation.

**Welcome aboard, ${username}! Let's build the future of DeFi on Stellar together! 🌟**

— *Chen Pilot Team*`;
      yield sendMessage(finalTips);
    });
  }
}
exports.DiscordAdapter = DiscordAdapter;
