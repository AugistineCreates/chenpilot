import type { CommandContext, CommandHandler, CommandReply } from "../types";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000";

export const pingHandler: CommandHandler = {
  name: "ping",
  description: "Check bot latency and backend health",

  async execute(ctx: CommandContext): Promise<CommandReply> {
    const start = Date.now();

    try {
      const controller = new AbortController();
      const timerId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${BACKEND_URL}/api/health`, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timerId);
      const ms = Date.now() - start;

      const text = res.ok
        ? `🏓 Pong!\n\n📡 End-to-End Latency: ${ms}ms\n✅ Backend: Online`
        : `🏓 Pong!\n\n📡 End-to-End Latency: ${ms}ms\n⚠️ Backend: HTTP ${res.status}`;

      return { text };
    } catch {
      const ms = Date.now() - start;
      return {
        text: `🏓 Pong!\n\n📡 End-to-End Latency: ${ms}ms\n❌ Backend: Unreachable`,
      };
    }
  },
};
