/**
 * Modular Discord Adapter
 * Main Discord adapter using modular components
 */

import {
  Client,
  GatewayIntentBits,
  Message,
  TextChannel,
  ChannelType,
} from 'discord.js';
import { ButtonHandler } from './modules/interaction/ButtonHandler';
import { ThreadSafety } from './modules/thread/ThreadSafety';
import { RoleGate } from './modules/role/RoleGate';
import { SafeBackendClient } from '../commands/services/BackendClient';
import {
  ModerationPolicyEngine,
  InMemoryAuditSink,
  createDefaultModerationPolicy,
  isModerationEnabled,
  discordMessageToModerationEvent,
  type ModerationResult,
} from '../moderation/index';

/**
 * Channels that can receive a plain-text follow-up (warning notice or
 * mod-log escalation). Threads and regular text channels both expose
 * `.send()`; other channel types (voice, forum, category, …) do not.
 */
type SendableChannel = TextChannel;

function isSendableChannel(channel: unknown): channel is SendableChannel {
  const type = (channel as { type?: ChannelType } | null)?.type;
  return (
    type === ChannelType.GuildText ||
    type === ChannelType.GuildPublicThread ||
    type === ChannelType.GuildPrivateThread ||
    type === ChannelType.GuildAnnouncement
  );
}

export interface DiscordAdapterConfig {
  token: string;
  backendUrl: string;
  adminRoleIds: string[];
  intents?: GatewayIntentBits[];
  /**
   * Channel that receives moderation audit notices for "escalate" decisions.
   * Falls back to MODERATION_LOG_CHANNEL_ID, then DISCORD_AUDIT_LOG_CHANNEL_ID
   * (shared with the legacy adapter's audit log) when omitted.
   */
  moderationLogChannelId?: string;
}

export class DiscordAdapter {
  private client: Client;
  private buttonHandler: ButtonHandler;
  private threadSafety: ThreadSafety;
  private roleGate: RoleGate;
  private backendClient: SafeBackendClient;
  private moderationEngine: ModerationPolicyEngine;
  private moderationAuditSink: InMemoryAuditSink;
  private moderationEnabled: boolean;
  private moderationLogChannelId?: string;
  private config: DiscordAdapterConfig;

  constructor(config: DiscordAdapterConfig) {
    this.config = config;

    // Initialize Discord client
    this.client = new Client({
      intents: config.intents || [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ],
    });

    // Initialize modular components
    this.buttonHandler = new ButtonHandler();
    this.threadSafety = new ThreadSafety();
    this.roleGate = new RoleGate();
    this.backendClient = new SafeBackendClient(config.backendUrl);

    // Configure role gate
    this.roleGate.setAdminRoleIds(config.adminRoleIds);

    // Initialize the shared moderation policy engine. Audit sink failures
    // never propagate — see ModerationPolicyEngine.audit().
    this.moderationEnabled = isModerationEnabled();
    this.moderationLogChannelId =
      config.moderationLogChannelId ||
      process.env.MODERATION_LOG_CHANNEL_ID ||
      process.env.DISCORD_AUDIT_LOG_CHANNEL_ID;
    this.moderationAuditSink = new InMemoryAuditSink();
    const { rules, escalation } = createDefaultModerationPolicy();
    this.moderationEngine = new ModerationPolicyEngine({
      rules,
      escalation,
      auditSinks: [this.moderationAuditSink],
    });

    // Setup event handlers
    this.setupEventHandlers();
  }

  /**
   * Start the Discord adapter
   */
  async start(): Promise<void> {
    await this.client.login(this.config.token);
  }

  /**
   * Stop the Discord adapter
   */
  async stop(): Promise<void> {
    await this.client.destroy();
    this.threadSafety.clearAllHistory();
    this.roleGate.clearCache();
  }

  /**
   * Setup Discord event handlers
   */
  private setupEventHandlers(): void {
    this.client.on('ready', () => {
      // TODO: Log ready state
    });

    this.client.on('interactionCreate', async (interaction) => {
      await this.handleInteraction(interaction);
    });

    this.client.on('messageCreate', async (message) => {
      await this.handleMessage(message);
    });
  }

  /**
   * Handle Discord interactions
   */
  private async handleInteraction(interaction: any): Promise<void> {
    try {
      if (interaction.isButton()) {
        await this.handleButtonInteraction(interaction);
      } else if (interaction.isModalSubmit()) {
        await this.handleModalInteraction();
      } else if (interaction.isStringSelectMenu()) {
        await this.handleSelectInteraction();
      } else if (interaction.isChatInputCommand()) {
        await this.handleCommandInteraction(interaction);
      }
    } catch {
      // TODO: Log error
    }
  }

  /**
   * Handle button interaction
   */
  private async handleButtonInteraction(interaction: any): Promise<void> {
    const discordInteraction = {
      type: 'button' as const,
      id: interaction.id,
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      data: {
        customId: interaction.customId,
      },
      metadata: {
        timestamp: Date.now(),
        threadId: interaction.channel?.isThread() ? interaction.channelId : undefined,
        parentChannelId: interaction.channel?.parentId,
      },
    };

    const result = await this.buttonHandler.handleButton(discordInteraction);

    if (result.success) {
      await interaction.reply({
        content: result.response?.content || 'Success',
        ephemeral: result.response?.ephemeral,
      });
    } else {
      await interaction.reply({
        content: result.error?.userMessage || result.error?.message || 'An error occurred',
        ephemeral: true,
      });
    }
  }

  /**
   * Handle modal interaction
   */
  private async handleModalInteraction(): Promise<void> {
    // TODO: Implement modal handling
  }

  /**
   * Handle select interaction
   */
  private async handleSelectInteraction(): Promise<void> {
    // TODO: Implement select handling
  }

  /**
   * Handle command interaction
   */
  private async handleCommandInteraction(interaction: any): Promise<void> {
    const commandName = interaction.commandName;

    // Check role gate
    if (interaction.guildId) {
      const canExecute = await this.roleGate.checkGate(
        commandName,
        interaction.user.id,
        interaction.guildId
      );

      if (!canExecute) {
        await interaction.reply({
          content: 'You do not have permission to use this command',
          ephemeral: true,
        });
        return;
      }
    }

    // TODO: Execute command via backend
    try {
      const result = await this.backendClient.executeCommand(
        commandName,
        interaction.options.data,
        interaction.user.id
      );

      await interaction.reply({
        content: JSON.stringify(result),
        ephemeral: false,
      });
    } catch {
      await interaction.reply({
        content: 'Failed to execute command',
        ephemeral: true,
      });
    }
  }

  /**
   * Handle message
   */
  private async handleMessage(message: Message): Promise<void> {
    // Ignore bot messages
    if (message.author.bot) return;

    await this.runModeration(message);

    // TODO: Handle legacy commands
  }

  /**
   * Run the shared moderation policy engine against an incoming message and
   * enforce its decision. Never throws — a moderation failure must not take
   * down message handling for the rest of the bot.
   */
  private async runModeration(message: Message): Promise<void> {
    if (!this.moderationEnabled) return;

    try {
      const event = discordMessageToModerationEvent({
        id: message.id,
        content: message.content,
        channelId: message.channelId,
        guildId: message.guildId,
        createdTimestamp: message.createdTimestamp,
        author: { id: message.author.id, bot: message.author.bot },
      });

      const result = await this.moderationEngine.moderate(event);
      if (result.decision === 'allow') return;

      await this.enforceModerationDecision(message, result);
    } catch (error) {
      // Moderation must never break normal message handling.
      console.error('[DiscordAdapter] Moderation error:', error);
    }
  }

  /**
   * Apply the engine's decision to the originating Discord message:
   *  - warn:     reply in-channel with the notice, message stays.
   *  - delete:   delete the message, then post the notice in-channel.
   *  - escalate: delete the message and forward a report to the mod-log
   *              channel in addition to the in-channel notice.
   */
  private async enforceModerationDecision(
    message: Message,
    result: ModerationResult
  ): Promise<void> {
    const notice = result.userMessage ?? 'This message violates our moderation policy.';

    if (result.decision === 'delete' || result.decision === 'escalate') {
      try {
        await message.delete();
      } catch (error) {
        // Message may already be gone, or the bot may lack permissions —
        // still proceed to notify/escalate so moderators see the flag.
        console.error('[DiscordAdapter] Failed to delete moderated message:', error);
      }
    }

    if (isSendableChannel(message.channel)) {
      await message.channel.send(notice);
    }

    if (result.decision === 'escalate') {
      await this.postToModerationLog(message, result);
    }
  }

  /**
   * Forward an escalated moderation decision to the configured mod-log
   * channel. Silently no-ops when no channel is configured or the channel
   * can't be resolved — audit failures must not affect enforcement.
   */
  private async postToModerationLog(
    message: Message,
    result: ModerationResult
  ): Promise<void> {
    if (!this.moderationLogChannelId) return;

    try {
      const channel = await this.client.channels.fetch(this.moderationLogChannelId);
      if (!isSendableChannel(channel)) return;

      const report =
        `🚨 **Moderation Escalation**\n` +
        `**User:** <@${message.author.id}> (\`${message.author.id}\`)\n` +
        `**Channel:** <#${message.channelId}>\n` +
        `**Rule:** \`${result.ruleId ?? 'unknown'}\`\n` +
        `**Reason:** ${result.reason ?? 'Policy violation'}\n` +
        `**Strikes:** ${result.strikes}\n` +
        `**Content:** ${message.content.slice(0, 500)}`;

      await channel.send(report);
    } catch (error) {
      console.error('[DiscordAdapter] Failed to post moderation escalation log:', error);
    }
  }

  /**
   * Read-only access to the moderation audit trail — used by tests and
   * admin tooling that needs to inspect recent decisions.
   */
  getModerationAuditSink(): InMemoryAuditSink {
    return this.moderationAuditSink;
  }

  /**
   * Get button handler for registration
   */
  getButtonHandler(): ButtonHandler {
    return this.buttonHandler;
  }

  /**
   * Get thread safety module
   */
  getThreadSafety(): ThreadSafety {
    return this.threadSafety;
  }

  /**
   * Get role gate module
   */
  getRoleGate(): RoleGate {
    return this.roleGate;
  }

  /**
   * Get backend client
   */
  getBackendClient(): SafeBackendClient {
    return this.backendClient;
  }

  /**
   * Get Discord client
   */
  getClient(): Client {
    return this.client;
  }
}
