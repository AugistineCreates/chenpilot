import { Request } from "express";
import { durableOperationService } from "../Reliability/DurableOperationService";

/**
 * Telegram webhook payload structure
 */
export interface TelegramWebhookPayload {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    date: number;
    text?: string;
    voice?: {
      file_id: string;
      file_unique_id: string;
      duration: number;
      mime_type?: string;
      file_size?: number;
    };
  };
  callback_query?: {
    id: string;
    from: {
      id: number;
      first_name: string;
      username?: string;
    };
    data: string;
  };
}

/**
 * Discord webhook payload structure
 */
export interface DiscordWebhookPayload {
  id: string;
  type: number;
  timestamp: string;
  channel_id?: string;
  guild_id?: string;
  author?: {
    id: string;
    username: string;
    discriminator: string;
  };
  content?: string;
  embeds?: unknown[];
}

export interface WebhookProcessResult {
  success: boolean;
  message: string;
  isDuplicate?: boolean;
  data?: unknown;
}

/**
 * Service for handling Telegram and Discord webhooks with durable idempotency
 */
export class PlatformWebhookService {
  private readonly TELEGRAM_SECRET: string;
  private readonly DISCORD_PUBLIC_KEY: string;

  constructor() {
    this.TELEGRAM_SECRET = process.env.TELEGRAM_BOT_TOKEN || "";
    this.DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || "";

    // Register handlers for durable webhook processing
    durableOperationService.registerHandler("telegram_webhook", async (payload) => {
      return this.handleTelegramUpdate(payload);
    });

    durableOperationService.registerHandler("discord_webhook", async (payload) => {
      return this.handleDiscordUpdate(payload);
    });
  }

  /**
   * Process Telegram webhook
   */
  async processTelegramWebhook(req: Request): Promise<WebhookProcessResult> {
    try {
      const payload: TelegramWebhookPayload = req.body;
      if (!payload.update_id) return { success: false, message: "Invalid payload" };

      const idempotentKey = `telegram_${payload.update_id}`;

      // Execute as a durable operation
      await durableOperationService.execute({
        category: "telegram_webhook",
        idempotentKey,
        payload,
      });

      return {
        success: true,
        message: "Telegram webhook accepted for durable processing",
      };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : "Internal error" };
    }
  }

  /**
   * Process Discord webhook
   */
  async processDiscordWebhook(req: Request): Promise<WebhookProcessResult> {
    try {
      const payload: DiscordWebhookPayload = req.body;
      if (!payload.id) return { success: false, message: "Invalid payload" };

      const idempotentKey = `discord_${payload.id}`;

      await durableOperationService.execute({
        category: "discord_webhook",
        idempotentKey,
        payload,
      });

      return {
        success: true,
        message: "Discord webhook accepted for durable processing",
      };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : "Internal error" };
    }
  }

  private async handleTelegramUpdate(payload: TelegramWebhookPayload): Promise<{ status: string }> {
    // Original business logic for telegram would go here
    console.log("Durable handling of telegram update", payload.update_id);
    return { status: "processed" };
  }

  private async handleDiscordUpdate(payload: DiscordWebhookPayload): Promise<{ status: string }> {
    // Original business logic for discord would go here
    console.log("Durable handling of discord update", payload.id);
    return { status: "processed" };
  }
}

