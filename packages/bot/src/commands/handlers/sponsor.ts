import type { CommandContext, CommandHandler, CommandReply } from "../types";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000";

export const sponsorHandler: CommandHandler = {
  name: "sponsor",
  description: "Request free Stellar account sponsorship (DM only for security)",
  dmOnly: true,
  strictRateLimit: true,

  async execute(ctx: CommandContext): Promise<CommandReply> {
    const res = await fetch(`${BACKEND_URL}/api/account/${ctx.userId}/sponsor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = (await res.json()) as {
      success: boolean;
      message: string;
      address?: string;
    };

    if (data.success) {
      return {
        text: `✅ Account sponsored successfully!\n📬 Address: ${data.address}`,
        ephemeral: true,
      };
    }

    return {
      text: `❌ Sponsorship failed: ${data.message}`,
      ephemeral: true,
    };
  },
};
