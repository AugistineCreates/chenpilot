import type { CommandContext, CommandHandler, CommandReply } from "../types";

export const startHandler: CommandHandler = {
  name: "start",
  description: "Welcome message and bot introduction",

  async execute(_ctx: CommandContext): Promise<CommandReply> {
    return {
      text: "Welcome to Chen Pilot! I am your AI-powered Stellar DeFi assistant. Use /help to see what I can do!",
    };
  },
};
