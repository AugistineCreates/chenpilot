import type { CommandContext, CommandHandler, CommandReply } from "../types";
import { AgentClient } from "@chen-pilot/sdk-core";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000";

let agentClient: AgentClient | undefined;
function getClient(): AgentClient {
  agentClient ??= new AgentClient({ baseUrl: BACKEND_URL });
  return agentClient;
}

export const swapHandler: CommandHandler = {
  name: "swap",
  description: "Swap one Stellar asset for another (DM only)",
  dmOnly: true,

  async execute(ctx: CommandContext): Promise<CommandReply> {
    const [fromAsset, toAsset, amountStr] = ctx.args;

    if (!fromAsset || !toAsset || !amountStr) {
      return {
        text: "Usage: /swap <fromAsset> <toAsset> <amount>\nExample: /swap XLM USDC 100",
      };
    }

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      return { text: "❌ Amount must be a positive number." };
    }

    const response = await getClient().query({
      userId: ctx.userId,
      query: `swap ${amount} ${fromAsset} to ${toAsset}`,
    });

    const result = response.result;

    if (typeof result === "string") {
      return { text: result };
    }

    const r = result as {
      successful?: boolean;
      from?: string;
      amount?: string;
      to?: string;
      estimatedOutput?: string;
      txHash?: string;
      message?: string;
    };

    if (r.successful) {
      return {
        text:
          `✅ Swap Successful!\n\n` +
          `From: ${r.from} ${r.amount}\n` +
          `To: ${r.to}\n` +
          `Estimated Output: ${r.estimatedOutput}\n` +
          `Tx Hash: ${r.txHash}`,
        ephemeral: true,
      };
    }

    return {
      text: `❌ Swap failed: ${r.message ?? "Unknown error"}`,
    };
  },
};
