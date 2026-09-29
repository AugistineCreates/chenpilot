import dotenv from "dotenv";
import http from "http";
import { TelegramAdapter } from "./adapters/telegram";
import { DiscordAdapter } from "./adapters/discord";
import { createReleaseWebhookHandler } from "./releaseWebhook";
import { botWorkflowManager } from "./services/workflowService";
import { marketDigestScheduler } from "./services/marketDigestScheduler";
import { registerAllCommands } from "./commands";
import { MultisigWizard } from "./multisigWizard";
import { SwapWizard } from "./swapWizard";

dotenv.config();

async function bootstrap() {
  console.log("🤖 Starting Chen Pilot Bot Services...");

  // ── Register all shared command handlers ──────────────────────────────────
  registerAllCommands();

  // Register workflows
  botWorkflowManager.registerWorkflow(new MultisigWizard());
  botWorkflowManager.registerWorkflow(new SwapWizard());

  const tgBot = new TelegramAdapter(process.env.TELEGRAM_BOT_TOKEN || "");
  const discordBot = new DiscordAdapter(process.env.DISCORD_BOT_TOKEN || "");

  await Promise.all([tgBot.init(), discordBot.init()]);

  // Register market digest targets and start the shared scheduler.
  // Each adapter returns null when its target channel/chat is not configured,
  // so unregistered platforms are silently skipped.
  const discordTarget = discordBot.createDigestTarget();
  if (discordTarget) marketDigestScheduler.addTarget(discordTarget);

  const telegramTarget = tgBot.createDigestTarget();
  if (telegramTarget) marketDigestScheduler.addTarget(telegramTarget);

  marketDigestScheduler.start();

  // #147: Mount GitHub release webhook if announcement targets are configured
  const discordAnnouncementChannelId =
    process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID;
  const telegramAnnouncementChatId = process.env.TELEGRAM_ANNOUNCEMENT_CHAT_ID;

  if (discordAnnouncementChannelId || telegramAnnouncementChatId) {
    interface ReleasePayload {
      tag_name: string;
      name: string;
      html_url: string;
      body?: string;
    }
    const announcers: {
      id: string;
      announcer: {
        announceRelease: (
          id: string,
          release: ReleasePayload
        ) => Promise<boolean>;
      };
    }[] = [];

    if (discordAnnouncementChannelId) {
      announcers.push({
        id: discordAnnouncementChannelId,
        announcer: discordBot,
      });
    }
    if (telegramAnnouncementChatId) {
      announcers.push({ id: telegramAnnouncementChatId, announcer: tgBot });
    }

    const handler = createReleaseWebhookHandler(announcers);
    const port = parseInt(process.env.BOT_WEBHOOK_PORT || "3001", 10);
    http
      .createServer(handler)
      .listen(port, () =>
        console.log(`🔗 Release webhook listening on port ${port}`)
      );
  }

  console.log("🚀 All bots are online!");
}

bootstrap().catch((err) => {
  console.error("❌ Failed to start bots:", err);
  process.exit(1);
});
