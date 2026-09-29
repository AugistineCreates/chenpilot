import type { CommandContext, CommandHandler, CommandReply } from "../types";
import { searchFeatures, formatHelpMessage, formatAiHelpMessage } from "../../services/helpProvider";
import { AgentClient } from "@chen-pilot/sdk-core";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000";

// Lazy-init so it only costs something when the command actually runs.
let agentClient: AgentClient | undefined;
function getAgentClient(): AgentClient {
  agentClient ??= new AgentClient({ baseUrl: BACKEND_URL });
  return agentClient;
}

/** Words that trigger keyword search instead of the AI fallback. */
const KEYWORD_COMMANDS = new Set([
  "swap", "balance", "trustline", "sponsor", "notify",
  "status", "price", "help",
]);

function isNaturalLanguage(query: string): boolean {
  return (
    query.includes(" ") &&
    !KEYWORD_COMMANDS.has(query.toLowerCase())
  );
}

export const helpHandler: CommandHandler = {
  name: "help",
  description: "List available features or search for a specific one",

  async execute(ctx: CommandContext): Promise<CommandReply> {
    const query = ctx.args.join(" ").trim();
    const format = ctx.platform === "discord" ? "markdown" : "html";

    if (query.length === 0) {
      const features = searchFeatures("");
      return { text: formatHelpMessage(features, false, format) };
    }

    if (isNaturalLanguage(query)) {
      try {
        const response = await getAgentClient().query({ userId: ctx.userId, query });
        const aiText =
          typeof response.result === "string"
            ? response.result
            : ((response.result as { message?: string }).message ?? "Sorry, I couldn't help with that.");
        return { text: formatAiHelpMessage(aiText, format) };
      } catch {
        // Fall through to keyword search
      }
    }

    const features = searchFeatures(query);
    return { text: formatHelpMessage(features, true, format) };
  },
};
