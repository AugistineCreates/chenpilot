import type { CommandContext, CommandHandler, CommandReply } from "../types";
import { botWorkflowManager } from "../../services/workflowService";

export const multisigHandler: CommandHandler = {
  name: "multisig",
  description: "Start the multi-signature wallet setup wizard (DM only)",
  dmOnly: true,

  async execute(ctx: CommandContext): Promise<CommandReply> {
    const result = await botWorkflowManager.startWorkflow(
      ctx.userId,
      ctx.platform,
      "multisig_wizard"
    );
    return { text: result.message, ephemeral: true };
  },
};
