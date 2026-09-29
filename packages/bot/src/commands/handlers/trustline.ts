import type { CommandContext, CommandHandler, CommandReply } from "../types";
import { createTrustlineOperation } from "@chen-pilot/sdk-core";

export const trustlineHandler: CommandHandler = {
  name: "trustline",
  description: "Look up a Stellar asset trustline",
  strictRateLimit: true,

  async execute(ctx: CommandContext): Promise<CommandReply> {
    const [assetCode, assetIssuer] = ctx.args;

    if (!assetCode) {
      return {
        text: "Usage: /trustline <assetCode> <issuerDomain|issuerAddress>\nExample: /trustline USDC circle.com",
      };
    }

    if (!assetIssuer) {
      return {
        text: `Please provide an issuer domain or address for ${assetCode}.`,
      };
    }

    const op = await createTrustlineOperation(assetCode, assetIssuer);
    const issuer = (op as { asset: { issuer: string } }).asset.issuer;

    const text =
      `✅ Found asset ${assetCode}!\n\n` +
      `To add this trustline, use the following details in your wallet:\n` +
      `Asset: ${assetCode}\n` +
      `Issuer: ${issuer}\n\n` +
      `Note: In a future update, I will provide a direct signing link.`;

    return { text };
  },
};
