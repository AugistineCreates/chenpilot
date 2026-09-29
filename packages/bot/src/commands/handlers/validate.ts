import type { CommandContext, CommandHandler, CommandReply } from "../types";
import { AssetVerificationService } from "../../assetVerification";

const HORIZON_URL =
  process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";

// Shared singleton — the service itself is stateless.
const verificationService = new AssetVerificationService(HORIZON_URL);

export const validateHandler: CommandHandler = {
  name: "validate",
  description: "Verify a Stellar asset for safety",
  strictRateLimit: true,

  async execute(ctx: CommandContext): Promise<CommandReply> {
    const [assetCode, issuerAddress] = ctx.args;

    if (!assetCode || !issuerAddress) {
      return {
        text: "Usage: /validate <assetCode> <issuerAddress>\nExample: /validate USDC GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      };
    }

    const result = await verificationService.verifyAsset(assetCode, issuerAddress);

    const statusEmoji =
      result.status === "VERIFIED"
        ? "✅"
        : result.status === "MALICIOUS"
          ? "🚨"
          : "⚠️";

    let text =
      `${statusEmoji} Asset Verification: ${result.status}\n\n` +
      `Asset: ${assetCode}\n` +
      `Issuer: ${issuerAddress}\n`;

    if (result.domain) text += `Domain: ${result.domain}\n`;
    if (result.details) text += `Details: ${result.details}\n`;
    text += `\nSafe to use: ${result.isSafe ? "Yes ✅" : "No ❌"}`;

    return { text };
  },
};
