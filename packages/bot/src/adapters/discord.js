"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiscordAdapter = void 0;
const discord_js_1 = require("discord.js");
const sdk_core_1 = require("@chen-pilot/sdk-core");
const helpProvider_1 = require("../services/helpProvider");
const assetVerification_1 = require("../assetVerification");
const performanceProfiler_1 = require("../performanceProfiler");
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";
const DASHBOARD_URL = process.env.DASHBOARD_URL || `${BACKEND_URL}/dashboard`;
const HORIZON_URL = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const DEBOUNCE_MS = 1000; // 1 second debounce between commands
// Commands that involve personal account data and must only be used in DMs
const DM_ONLY_COMMANDS = ['!balance', '!sponsor'];
function isDM(message) {
    return message.channel.type === discord_js_1.ChannelType.DM;
}
function rejectPublicChannel(message) {
    return __awaiter(this, void 0, void 0, function* () {
        yield message.reply('🔒 This command contains sensitive account data and can only be used in a Direct Message (DM) with the bot.');
    });
}
// Commands that involve personal account data and must only be used in DMs
const DM_ONLY_COMMANDS = ['!balance', '!sponsor'];
function isDM(message) {
    return message.channel.type === discord_js_1.ChannelType.DM;
}
function rejectPublicChannel(message) {
    return __awaiter(this, void 0, void 0, function* () {
        yield message.reply('🔒 This command contains sensitive account data and can only be used in a Direct Message (DM) with the bot.');
    });
}
class DiscordAdapter {
    constructor(token, auditLogChannelId) {
        this.userChannels = new Map(); // userId -> channelId
        // #145: Track last command timestamp per user
        this.lastCommandTime = new Map();
        this.token = token;
        this.auditLogChannelId = auditLogChannelId || process.env.DISCORD_AUDIT_LOG_CHANNEL_ID;
        this.client = new discord_js_1.Client({
            intents: [
                discord_js_1.GatewayIntentBits.Guilds,
                discord_js_1.GatewayIntentBits.GuildMessages,
                discord_js_1.GatewayIntentBits.MessageContent,
            ],
        });
        this.verificationService = new assetVerification_1.AssetVerificationService(HORIZON_URL);
    }
    // #145: Returns true if the user is flooding (within debounce window)
    isFlooding(userId) {
        var _a;
        const now = Date.now();
        const last = (_a = this.lastCommandTime.get(userId)) !== null && _a !== void 0 ? _a : 0;
        if (now - last < DEBOUNCE_MS)
            return true;
        this.lastCommandTime.set(userId, now);
        return false;
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
                console.log(`✅ Discord bot logged in as ${(_a = this.client.user) === null || _a === void 0 ? void 0 : _a.tag}`);
                this.startStatusUpdates();
            });
            this.client.on("messageCreate", (0, performanceProfiler_1.withPerformanceProfiling)('messageCreate', 'discord', 'system', (message) => __awaiter(this, void 0, void 0, function* () {
                if (message.author.bot)
                    return;
                const userId = message.author.id;
                const commandName = (0, performanceProfiler_1.extractCommandName)(message.content, 'discord');
                // #145: Anti-flood check for all commands
                if (this.isFlooding(userId)) {
                    yield message.reply("⏳ Please wait a moment before sending another command.");
                    return;
                }
                // Wrap each command handler with performance profiling
                if (message.content === "!start") {
                    yield (0, performanceProfiler_1.withPerformanceProfiling)('!start', 'discord', userId, () => __awaiter(this, void 0, void 0, function* () {
                        yield message.reply("Welcome to Chen Pilot! I am your AI-powered Stellar DeFi assistant. Type !help to see what I can do!");
                    }))();
                }
                if (message.content.startsWith("!help")) {
                    yield (0, performanceProfiler_1.withPerformanceProfiling)(commandName, 'discord', userId, () => __awaiter(this, void 0, void 0, function* () {
                        const query = message.content.replace("!help", "").trim();
                        const results = (0, helpProvider_1.searchFeatures)(query);
                        const isSearch = query.length > 0;
                        yield message.reply((0, helpProvider_1.formatHelpMessage)(results, isSearch, "markdown"));
                    }))();
                }
                if (message.content === "!thread") {
                    yield (0, performanceProfiler_1.withPerformanceProfiling)('!thread', 'discord', userId, () => __awaiter(this, void 0, void 0, function* () {
                        if (message.channel.type === discord_js_1.ChannelType.GuildText) {
                            try {
                                const thread = yield message.startThread({
                                    name: `Chen Pilot Session - ${message.author.username}`,
                                    autoArchiveDuration: 60,
                                });
                                yield thread.send(`👋 Hello ${message.author.username}! I've started this thread to keep our conversation organized. How can I help you with Stellar DeFi today?`);
                            }
                            catch (error) {
                                console.error("Error creating thread:", error);
                                yield message.reply("❌ I couldn't start a thread. Please make sure I have the 'Create Public Threads' permission.");
                            }
                        }
                        else if (message.channel.isThread()) {
                            yield message.reply("🧵 We are already in a thread! I'm ready to assist you here.");
                        }
                        else {
                            yield message.reply("❌ Threads can only be started in text channels.");
                        }
                    }))();
                }
                if (message.content === "!sponsor") {
                    yield (0, performanceProfiler_1.withPerformanceProfiling)('!sponsor', 'discord', userId, () => __awaiter(this, void 0, void 0, function* () {
                        yield message.reply("⏳ Requesting account sponsorship...");
                        try {
                            const response = yield fetch(`${BACKEND_URL}/api/account/${userId}/sponsor`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                            });
                            const data = (yield response.json());
                            if (data.success) {
                                yield message.reply(`✅ Account sponsored successfully!\n📬 Address: \`${data.address}\``);
                                yield this.logAuditAction({
                                    action: 'SPONSOR_ACCOUNT',
                                    triggeredBy: userId,
                                    details: `Address: ${data.address}`,
                                    success: true,
                                    timestamp: new Date().toISOString(),
                                });
                            }
                            else {
                                yield message.reply(`❌ Sponsorship failed: ${data.message}`);
                                yield this.logAuditAction({
                                    action: 'SPONSOR_ACCOUNT',
                                    triggeredBy: userId,
                                    details: `Failed: ${data.message}`,
                                    success: false,
                                    timestamp: new Date().toISOString(),
                                });
                            }
                        }
                        catch (error) {
                            console.error("Sponsor command error:", error);
                            yield message.reply("❌ Could not reach the sponsorship service. Please try again later.");
                        }
                    }))();
                }
                if (message.content.startsWith("!trustline")) {
                    yield (0, performanceProfiler_1.withPerformanceProfiling)(commandName, 'discord', userId, () => __awaiter(this, void 0, void 0, function* () {
                        const args = message.content.split(" ").slice(1);
                        if (args.length < 1) {
                            return message.reply("Usage: !trustline <assetCode> [issuerDomain|issuerAddress]\nExample: !trustline USDC circle.com");
                        }
                        const assetCode = args[0];
                        const assetIssuer = args[1];
                        if (!assetIssuer) {
                            return message.reply(`Please provide an issuer domain or address for ${assetCode}.`);
                        }
                        try {
                            yield message.reply(`🔍 Looking up asset ${assetCode} from ${assetIssuer}...`);
                            const op = yield (0, sdk_core_1.createTrustlineOperation)(assetCode, assetIssuer);
                            let response = `✅ Found asset ${assetCode}!\n\n`;
                            response += `To add this trustline, you can use the following details in your wallet:\n`;
                            response += `**Asset:** ${assetCode}\n`;
                            response += `**Issuer:** \`${op.asset.issuer}\`\n\n`;
                            response += `*Note: In a future update, I will provide a direct signing link.*`;
                            yield message.reply(response);
                            yield this.logAuditAction({
                                action: 'TRUSTLINE_LOOKUP',
                                triggeredBy: message.author.id,
                                details: `Asset: ${assetCode}, Issuer: ${assetIssuer}`,
                                success: true,
                                timestamp: new Date().toISOString(),
                            });
                        }
                        catch (error) {
                            yield message.reply(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
                        }
                    }))();
                }
                // #146: Dashboard command
                if (message.content === '!dashboard') {
                    yield (0, performanceProfiler_1.withPerformanceProfiling)('!dashboard', 'discord', userId, () => __awaiter(this, void 0, void 0, function* () {
                        yield message.reply(`📊 **Chen Pilot Dashboard**\n\nAccess your admin dashboard here:\n🔗 ${DASHBOARD_URL}\n\n*Note: You must be logged in to view the dashboard.*`);
                    }))();
                }
                // #148: /validate command for Stellar asset verification
                if (message.content.startsWith('!validate')) {
                    yield (0, performanceProfiler_1.withPerformanceProfiling)(commandName, 'discord', userId, () => __awaiter(this, void 0, void 0, function* () {
                        const args = message.content.split(' ').slice(1);
                        if (args.length < 2) {
                            return message.reply('Usage: !validate <assetCode> <issuerAddress>\nExample: !validate USDC GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
                        }
                        const [assetCode, issuerAddress] = args;
                        yield message.reply(`🔍 Verifying asset **${assetCode}** from issuer \`${issuerAddress.slice(0, 8)}...\``);
                        try {
                            const result = yield this.verificationService.verifyAsset(assetCode, issuerAddress);
                            const statusEmoji = result.status === 'VERIFIED' ? '✅' : result.status === 'MALICIOUS' ? '🚨' : '⚠️';
                            let reply = `${statusEmoji} **Asset Verification: ${result.status}**\n\n`;
                            reply += `**Asset:** ${assetCode}\n`;
                            reply += `**Issuer:** \`${issuerAddress}\`\n`;
                            if (result.domain)
                                reply += `**Domain:** ${result.domain}\n`;
                            if (result.details)
                                reply += `**Details:** ${result.details}\n`;
                            reply += `\n**Safe to use:** ${result.isSafe ? 'Yes ✅' : 'No ❌'}`;
                            yield message.reply(reply);
                        }
                        catch (error) {
                            yield message.reply(`❌ Verification error: ${error instanceof Error ? error.message : String(error)}`);
                        }
                    }))();
                }
            })));
            yield this.client.login(token);
            console.log("✅ Discord bot initialized.");
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
            const body = release.body ? `\n\n${release.body.slice(0, 500)}${release.body.length > 500 ? '...' : ''}` : '';
            const message = `🚀 **New Release: ${release.name || release.tag_name}**${body}\n\n🔗 ${release.html_url}`;
            try {
                yield channel.send(message);
                return true;
            }
            catch (error) {
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
                    action: 'SEND_TRANSACTION_NOTIFICATION',
                    triggeredBy: userId,
                    details: `Hash: ${data.hash.slice(0, 8)}...${data.hash.slice(-8)}, Success: ${data.successful}`,
                    success: true,
                    timestamp: new Date().toISOString(),
                });
                return true;
            }
            catch (error) {
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
            }
            catch (error) {
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
        setInterval(() => {
            this.updateBotStatus();
        }, 5 * 60 * 1000);
    }
    /**
     * Update the bot's Discord activity status
     */
    updateBotStatus() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.client.user)
                return;
            try {
                // Toggle between network status and a welcoming message
                const useNetworkStatus = Math.random() > 0.5;
                if (useNetworkStatus) {
                    const status = yield (0, sdk_core_1.getNetworkStatus)({ network: "mainnet" });
                    const healthEmoji = status.health.isHealthy ? "🟢" : "🔴";
                    const ledgerInfo = `L:${status.health.latestLedger}`;
                    this.client.user.setActivity(`${healthEmoji} Stellar Network | ${ledgerInfo}`, {
                        type: discord_js_1.ActivityType.Watching,
                    });
                }
                else {
                    this.client.user.setActivity("🚀 Stellar DeFi | !help", {
                        type: discord_js_1.ActivityType.Playing,
                    });
                }
            }
            catch (error) {
                console.error("Error updating bot status:", error);
                // Fallback status
                this.client.user.setActivity("Stellar DeFi Assistant", {
                    type: discord_js_1.ActivityType.Custom,
                });
            }
        });
    }
}
exports.DiscordAdapter = DiscordAdapter;
