/**
 * Discord → CommandContext adapters.
 *
 * Two factory functions:
 *   - fromSlashInteraction  — for slash commands (ChatInputCommandInteraction)
 *   - fromMessage           — for legacy ! prefix messages (kept as a shim while
 *                             the deprecation notice is in place)
 *
 * Both produce a CommandContext that the shared CommandRegistry can consume.
 */

import type { ChatInputCommandInteraction, Message, GuildMember, ChannelType } from "discord.js";
import type { CommandContext } from "../types";

// ─── Slash interaction ────────────────────────────────────────────────────────

/**
 * Build a CommandContext from a Discord slash-command interaction.
 *
 * @param interaction  The raw ChatInputCommandInteraction from discord.js
 * @param args         Pre-parsed argument strings (adapters pull these with
 *                     interaction.options.getString / getNumber etc. and pass
 *                     them as a plain array so the handler stays framework-neutral)
 */
export function fromSlashInteraction(
  interaction: ChatInputCommandInteraction,
  args: string[] = []
): CommandContext {
  const roles =
    interaction.member instanceof Object && "roles" in interaction.member
      ? getRoleNames(interaction.member as GuildMember)
      : [];

  // Determine if this is a DM channel
  const isDM = !interaction.guildId;

  return {
    command: interaction.commandName,
    args,
    userId: interaction.user.id,
    platform: "discord",
    isDM,
    roles,
    raw: interaction,

    async reply(text: string) {
      const formatted = applyDiscordFormatting(text);
      if (interaction.deferred) {
        await interaction.editReply(formatted);
      } else if (interaction.replied) {
        await interaction.followUp({ content: formatted, ephemeral: true });
      } else {
        await interaction.reply({ content: formatted, ephemeral: true });
      }
    },
  };
}

// ─── Legacy message (! prefix) ───────────────────────────────────────────────

/**
 * Build a CommandContext from a Discord legacy message.
 * The command name is extracted from the first word (stripping the ! prefix).
 */
export function fromMessage(message: Message): CommandContext {
  const parts = message.content.trim().split(/\s+/);
  const rawCmd = parts[0] ?? "";
  const command = rawCmd.replace(/^[!/]/, "").toLowerCase();
  const args = parts.slice(1);

  // Determine DM
  const { ChannelType: CT } = require("discord.js") as typeof import("discord.js");
  const isDM = message.channel.type === CT.DM;

  const roles =
    message.member ? getRoleNames(message.member) : [];

  return {
    command,
    args,
    userId: message.author.id,
    platform: "discord",
    isDM,
    roles,
    raw: message,

    async reply(text: string) {
      await message.reply(applyDiscordFormatting(text));
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRoleNames(member: GuildMember): string[] {
  return member.roles.cache.map((r) => r.name);
}

/**
 * Convert plain-text command output to Discord markdown.
 *
 * Commands intentionally return neutral text (no platform-specific bold or
 * italics markers) so they are testable without any Discord SDK.  This
 * function adds Discord markdown bold/italic/code decorators based on simple
 * heuristics:
 *   - Lines that start with a keyword followed by a colon → bold the key
 *   - Stellar addresses (56-char uppercase) → inline code
 *
 * Adapters that need finer-grained control can override ctx.reply before
 * passing the context to dispatch().
 */
export function applyDiscordFormatting(text: string): string {
  return (
    text
      // Wrap bare Stellar addresses in backticks
      .replace(/\b([A-Z]{1}[A-Z0-9]{55})\b/g, "`$1`")
      // Bold "Key: value" patterns (e.g. "Asset: XLM")
      .replace(/^([A-Z][A-Za-z ]+):/gm, "**$1:**")
  );
}
