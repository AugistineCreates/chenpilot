/**
 * Discord Backend Integration
 * Provides better integration boundaries between Discord adapter and backend services
 */

import { SafeBackendClient } from '../../commands/services/BackendClient.js';
import { DiscordInteraction } from '../modules/interaction/types.js';

export interface DiscordContext {
  userId: string;
  guildId?: string;
  channelId: string;
  threadId?: string;
  platform: 'discord';
}

export interface DiscordBackendConfig {
  backendUrl: string;
  timeoutMs?: number;
  retryConfig?: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
  };
}

export class DiscordBackendIntegration {
  private backendClient: SafeBackendClient;
  private requestQueue: Map<string, Promise<any>>;

  constructor(config: DiscordBackendConfig) {
    this.backendClient = new SafeBackendClient(config.backendUrl, {
      timeoutMs: config.timeoutMs,
      retryConfig: config.retryConfig,
    });
    this.requestQueue = new Map();
  }

  /**
   * Execute a Discord-specific command through backend
   */
  async executeCommand<TInput, TOutput>(
    command: string,
    input: TInput,
    context: DiscordContext
  ): Promise<TOutput> {
    const requestKey = `${context.userId}:${command}`;

    // Check if there's an in-flight request for the same user/command
    const inFlight = this.requestQueue.get(requestKey);
    if (inFlight) {
      return inFlight;
    }

    // Create new request
    const request = this.backendClient.executeCommand<TInput, TOutput>(
      command,
      input,
      context.userId
    );

    this.requestQueue.set(requestKey, request);

    try {
      const result = await request;
      return result;
    } finally {
      this.requestQueue.delete(requestKey);
    }
  }

  /**
   * Execute a workflow step through backend
   */
  async executeWorkflow<TState>(
    workflow: string,
    state: TState,
    step: string,
    context: DiscordContext
  ): Promise<any> {
    const requestKey = `${context.userId}:${workflow}:${step}`;

    const inFlight = this.requestQueue.get(requestKey);
    if (inFlight) {
      return inFlight;
    }

    const request = this.backendClient.executeWorkflow<TState>(
      workflow,
      state,
      step
    );

    this.requestQueue.set(requestKey, request);

    try {
      const result = await request;
      return result;
    } finally {
      this.requestQueue.delete(requestKey);
    }
  }

  /**
   * Execute command from Discord interaction
   */
  async executeFromInteraction<TInput, TOutput>(
    command: string,
    input: TInput,
    interaction: DiscordInteraction
  ): Promise<TOutput> {
    const context: DiscordContext = {
      userId: interaction.userId,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      threadId: interaction.metadata.threadId,
      platform: 'discord',
    };

    return this.executeCommand<TInput, TOutput>(command, input, context);
  }

  /**
   * Batch execute multiple commands
   */
  async batchExecute<TInput, TOutput>(
    commands: Array<{ command: string; input: TInput; context: DiscordContext }>
  ): Promise<Map<string, TOutput>> {
    const results = new Map<string, TOutput>();

    await Promise.all(
      commands.map(async ({ command, input, context }) => {
        try {
          const result = await this.executeCommand<TInput, TOutput>(command, input, context);
          results.set(`${context.userId}:${command}`, result);
        } catch (error) {
          // Log error but continue with other commands
          // TODO: Add proper logging
        }
      })
    );

    return results;
  }

  /**
   * Get health status of backend connection
   */
  async getHealthStatus(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
    try {
      const start = Date.now();
      await this.backendClient.executeCommand('health', {}, 'system');
      const latency = Date.now() - start;

      return { healthy: true, latency };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get circuit breaker state
   */
  getCircuitBreakerState(): Record<string, any> {
    return this.backendClient.getCircuitBreakerState();
  }

  /**
   * Reset circuit breakers
   */
  resetCircuitBreakers(): void {
    this.backendClient.resetAllCircuitBreakers();
  }

  /**
   * Clear request queue
   */
  clearQueue(): void {
    this.requestQueue.clear();
  }

  /**
   * Get queue size
   */
  getQueueSize(): number {
    return this.requestQueue.size;
  }

  /**
   * Cancel specific request
   */
  cancelRequest(userId: string, command: string): boolean {
    const key = `${userId}:${command}`;
    return this.requestQueue.delete(key);
  }

  /**
   * Cancel all requests for a user
   */
  cancelUserRequests(userId: string): number {
    let cancelled = 0;
    for (const key of this.requestQueue.keys()) {
      if (key.startsWith(`${userId}:`)) {
        this.requestQueue.delete(key);
        cancelled++;
      }
    }
    return cancelled;
  }

  /**
   * Get backend client for direct access (use with caution)
   */
  getBackendClient(): SafeBackendClient {
    return this.backendClient;
  }
}
