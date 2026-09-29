import type { CommandContext, CommandHandler, CommandReply } from "../types";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000";
const DASHBOARD_URL = process.env.DASHBOARD_URL ?? `${BACKEND_URL}/dashboard`;

export const dashboardHandler: CommandHandler = {
  name: "dashboard",
  description: "Get a link to the Chen Pilot admin dashboard",

  async execute(_ctx: CommandContext): Promise<CommandReply> {
    return {
      text: `📊 Chen Pilot Dashboard\n\nAccess your admin dashboard here:\n🔗 ${DASHBOARD_URL}\n\nNote: You must be logged in to view the dashboard.`,
      ephemeral: true,
    };
  },
};
