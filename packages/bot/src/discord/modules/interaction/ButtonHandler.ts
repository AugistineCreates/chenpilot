/**
 * Button Handler
 * Handles button interactions in Discord
 */

import {
  DiscordInteraction,
  InteractionResult,
} from './types';

type ButtonCallback = (interaction: DiscordInteraction, data: any) => Promise<InteractionResult<any>>;

export class ButtonHandler {
  private handlers: Map<string, ButtonCallback>;
  private rateLimits: Map<string, { count: number; resetTime: number }>;

  constructor() {
    this.handlers = new Map();
    this.rateLimits = new Map();
  }

  /**
   * Register a button handler
   */
  registerButton(customId: string, callback: ButtonCallback): void {
    this.handlers.set(customId, callback);
  }

  /**
   * Unregister a button handler
   */
  unregisterButton(customId: string): void {
    this.handlers.delete(customId);
  }

  /**
   * Handle a button interaction
   */
  async handleButton(interaction: DiscordInteraction): Promise<InteractionResult<any>> {
    const customId = interaction.data?.customId;

    if (!customId) {
      return {
        success: false,
        error: {
          code: 'INVALID_INTERACTION',
          message: 'Button interaction missing customId',
          recoverable: false,
        },
      };
    }

    const handler = this.handlers.get(customId);
    if (!handler) {
      return {
        success: false,
        error: {
          code: 'INVALID_INTERACTION',
          message: `No handler registered for button: ${customId}`,
          recoverable: false,
        },
      };
    }

    // Check rate limit
    if (!this.checkRateLimit(interaction.userId)) {
      return {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Button interaction rate limit exceeded',
          recoverable: true,
          userMessage: 'Please wait before clicking again',
        },
      };
    }

    try {
      return await handler(interaction, interaction.data);
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'BACKEND_ERROR',
          message: error instanceof Error ? error.message : String(error),
          recoverable: true,
        },
      };
    }
  }

  /**
   * Check rate limit for user
   */
  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const entry = this.rateLimits.get(userId);

    if (!entry || now > entry.resetTime) {
      this.rateLimits.set(userId, { count: 1, resetTime: now + 5000 }); // 5 second window
      return true;
    }

    if (entry.count >= 10) {
      return false;
    }

    entry.count++;
    return true;
  }

  /**
   * Clear all rate limits
   */
  clearRateLimits(): void {
    this.rateLimits.clear();
  }
}
