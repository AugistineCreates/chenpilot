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
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const http_1 = __importDefault(require("http"));
const telegram_1 = require("./adapters/telegram");
const discord_1 = require("./adapters/discord");
const releaseWebhook_1 = require("./releaseWebhook");
dotenv_1.default.config();
function bootstrap() {
  return __awaiter(this, void 0, void 0, function* () {
    console.log("🤖 Starting Chen Pilot Bot Services...");
    const tgBot = new telegram_1.TelegramAdapter(
      process.env.TELEGRAM_BOT_TOKEN || ""
    );
    const discordBot = new discord_1.DiscordAdapter(
      process.env.DISCORD_BOT_TOKEN || ""
    );
    yield Promise.all([tgBot.init(), discordBot.init()]);
    // #147: Mount GitHub release webhook if announcement targets are configured
    const discordAnnouncementChannelId =
      process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID;
    const telegramAnnouncementChatId =
      process.env.TELEGRAM_ANNOUNCEMENT_CHAT_ID;
    if (discordAnnouncementChannelId || telegramAnnouncementChatId) {
      const announcers = [];
      if (discordAnnouncementChannelId) {
        announcers.push({
          id: discordAnnouncementChannelId,
          announcer: discordBot,
        });
      }
      if (telegramAnnouncementChatId) {
        announcers.push({ id: telegramAnnouncementChatId, announcer: tgBot });
      }
      const handler = (0, releaseWebhook_1.createReleaseWebhookHandler)(
        announcers
      );
      const port = parseInt(process.env.BOT_WEBHOOK_PORT || "3001", 10);
      http_1.default
        .createServer(handler)
        .listen(port, () =>
          console.log(`🔗 Release webhook listening on port ${port}`)
        );
    }
    console.log("🚀 All bots are online!");
  });
}
bootstrap().catch((err) => {
  console.error("❌ Failed to start bots:", err);
  process.exit(1);
});
