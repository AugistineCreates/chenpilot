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
exports.TelegramAdapter = void 0;
const telegraf_1 = require("telegraf");
const sdk_core_1 = require("@chen-pilot/sdk-core");
const assetVerification_1 = require("../assetVerification");
const performanceProfiler_1 = require("../performanceProfiler");
const DASHBOARD_URL = process.env.DASHBOARD_URL || `${process.env.API_BASE_URL || 'http://localhost:2333'}/dashboard`;
const HORIZON_URL = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const DEBOUNCE_MS = 1000; // 1 second debounce between commands
// Commands that involve personal account data and must only be used in DMs
const DM_ONLY_COMMANDS = ['/balance'];
function isDM(ctx) {
    var _a;
    return ((_a = ctx.chat) === null || _a === void 0 ? void 0 : _a.type) === 'private';
}
function rejectPublicChannel(ctx) {
    return __awaiter(this, void 0, void 0, function* () {
        yield ctx.reply('🔒 This command contains sensitive account data and can only be used in a private message (DM) with the bot.');
    });
}
class TelegramAdapter {
    constructor(token) {
        this.userChatIds = new Map(); // userId -> chatId
        // #145: Track last command timestamp per user
        this.lastCommandTime = new Map();
        this.token = token;
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
            if (!this.token) {
                console.warn("⚠️ Telegram: No token provided, skipping initialization.");
                return;
            }
            this.bot = new telegraf_1.Telegraf(this.token);
            // #145: Middleware to debounce all incoming messages/commands
            this.bot.use((ctx, next) => __awaiter(this, void 0, void 0, function* () {
                var _a;
                const userId = (_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id;
                if (userId && this.isFlooding(userId)) {
                    yield ctx.reply("⏳ Please wait a moment before sending another command.");
                    return;
                }
                return next();
            }));
            this.bot.start((ctx) => __awaiter(this, void 0, void 0, function* () {
                var _a;
                const userId = String(((_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id) || 'unknown');
                yield (0, performanceProfiler_1.withPerformanceProfiling)('/start', 'telegram', userId, () => ctx.reply('Welcome to Chen Pilot! I am your AI-powered Stellar DeFi assistant.'))();
            }));
            this.bot.help((ctx) => __awaiter(this, void 0, void 0, function* () {
                var _a;
                const userId = String(((_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id) || 'unknown');
                yield (0, performanceProfiler_1.withPerformanceProfiling)('/help', 'telegram', userId, () => ctx.reply('Commands: /start, /balance, /swap, /trustline, /dashboard, /validate'))();
            }));
            this.bot.command('trustline', (ctx) => __awaiter(this, void 0, void 0, function* () {
                var _a;
                const userId = String(((_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id) || 'unknown');
                const commandName = (0, performanceProfiler_1.extractCommandName)(ctx.message.text, 'telegram');
                yield (0, performanceProfiler_1.withPerformanceProfiling)(commandName, 'telegram', userId, () => __awaiter(this, void 0, void 0, function* () {
                    const args = ctx.message.text.split(' ').slice(1);
                    if (args.length < 1) {
                        return ctx.reply("Usage: /trustline <assetCode> [issuerDomain|issuerAddress]\nExample: /trustline USDC circle.com");
                    }
                    const assetCode = args[0];
                    const assetIssuer = args[1];
                    if (!assetIssuer) {
                        return ctx.reply(`Please provide an issuer domain or address for ${assetCode}.`);
                    }
                    try {
                        yield ctx.reply(`🔍 Looking up asset ${assetCode} from ${assetIssuer}...`);
                        const op = yield (0, sdk_core_1.createTrustlineOperation)(assetCode, assetIssuer);
                        // In a real scenario, we would generate a signing link (e.g., Albedo or Stellar Laboratory)
                        // For now, we'll return the operation details
                        let message = `✅ Found asset ${assetCode}!\n\n`;
                        message += `To add this trustline, you can use the following details in your wallet:\n`;
                        message += `<b>Asset:</b> ${assetCode}\n`;
                        message += `<b>Issuer:</b> <code>${op.asset.issuer}</code>\n\n`;
                        message += `<i>Note: In a future update, I will provide a direct signing link.</i>`;
                        yield ctx.reply(message, { parse_mode: "HTML" });
                    }
                    catch (error) {
                        yield ctx.reply(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }))();
            }));
            // #146: Dashboard command
            this.bot.command('dashboard', (ctx) => __awaiter(this, void 0, void 0, function* () {
                var _a;
                const userId = String(((_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id) || 'unknown');
                yield (0, performanceProfiler_1.withPerformanceProfiling)('/dashboard', 'telegram', userId, () => __awaiter(this, void 0, void 0, function* () {
                    yield ctx.reply(`📊 <b>Chen Pilot Dashboard</b>\n\nAccess your admin dashboard here:\n🔗 <a href="${DASHBOARD_URL}">Open Dashboard</a>\n\n<i>Note: You must be logged in to view the dashboard.</i>`, { parse_mode: 'HTML' });
                }))();
            }));
            // #148: /validate command for Stellar asset verification
            this.bot.command('validate', (ctx) => __awaiter(this, void 0, void 0, function* () {
                var _a;
                const userId = String(((_a = ctx.from) === null || _a === void 0 ? void 0 : _a.id) || 'unknown');
                const commandName = (0, performanceProfiler_1.extractCommandName)(ctx.message.text, 'telegram');
                yield (0, performanceProfiler_1.withPerformanceProfiling)(commandName, 'telegram', userId, () => __awaiter(this, void 0, void 0, function* () {
                    const args = ctx.message.text.split(' ').slice(1);
                    if (args.length < 2) {
                        return ctx.reply('Usage: /validate <assetCode> <issuerAddress>\nExample: /validate USDC GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
                    }
                    const [assetCode, issuerAddress] = args;
                    yield ctx.reply(`🔍 Verifying asset <b>${assetCode}</b> from issuer <code>${issuerAddress.slice(0, 8)}...</code>`, { parse_mode: 'HTML' });
                    try {
                        const result = yield this.verificationService.verifyAsset(assetCode, issuerAddress);
                        const statusEmoji = result.status === 'VERIFIED' ? '✅' : result.status === 'MALICIOUS' ? '🚨' : '⚠️';
                        let reply = `${statusEmoji} <b>Asset Verification: ${result.status}</b>\n\n`;
                        reply += `<b>Asset:</b> ${assetCode}\n`;
                        reply += `<b>Issuer:</b> <code>${issuerAddress}</code>\n`;
                        if (result.domain)
                            reply += `<b>Domain:</b> ${result.domain}\n`;
                        if (result.details)
                            reply += `<b>Details:</b> ${result.details}\n`;
                        reply += `\n<b>Safe to use:</b> ${result.isSafe ? 'Yes ✅' : 'No ❌'}`;
                        yield ctx.reply(reply, { parse_mode: 'HTML' });
                    }
                    catch (error) {
                        yield ctx.reply(`❌ Verification error: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }))();
            }));
            // Set bot commands for mobile menu
            yield this.bot.telegram.setMyCommands([
                { command: "start", description: "Start the bot" },
                { command: "balance", description: "Check wallet balance" },
                { command: "swap", description: "Swap assets" },
                { command: "trustline", description: "Add trustline" },
                { command: "help", description: "Show help" },
            ]);
            this.bot.launch();
            console.log("✅ Telegram bot initialized.");
        });
    }
    // #147: Announce a new GitHub release to a specific chat
    announceRelease(chatId, release) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.bot) {
                console.warn("⚠️ Telegram bot not initialized");
                return false;
            }
            const body = release.body ? `\n\n${release.body.slice(0, 500)}${release.body.length > 500 ? '...' : ''}` : '';
            const message = `🚀 <b>New Release: ${release.name || release.tag_name}</b>${body}\n\n🔗 <a href="${release.html_url}">View on GitHub</a>`;
            try {
                yield this.bot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' });
                return true;
            }
            catch (error) {
                console.error("Error sending release announcement:", error);
                return false;
            }
        });
    }
    registerUser(userId, chatId) {
        return __awaiter(this, void 0, void 0, function* () {
            this.userChatIds.set(userId, chatId);
            return true;
        });
    }
    sendTransactionNotification(userId, data) {
        return __awaiter(this, void 0, void 0, function* () {
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
                yield this.bot.telegram.sendMessage(chatId, message, {
                    parse_mode: "HTML",
                });
                return true;
            }
            catch (error) {
                console.error("Error sending Telegram notification:", error);
                return false;
            }
        });
    }
    formatTransactionMessage(data) {
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
    sendNotification(userId, message) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.bot) {
                console.warn("⚠️ Telegram bot not initialized");
                return false;
            }
            const chatId = this.userChatIds.get(userId);
            if (!chatId) {
                return false;
            }
            try {
                yield this.bot.telegram.sendMessage(chatId, message, {
                    parse_mode: "HTML",
                });
                return true;
            }
            catch (error) {
                console.error("Error sending Telegram notification:", error);
                return false;
            }
        });
    }
}
exports.TelegramAdapter = TelegramAdapter;
