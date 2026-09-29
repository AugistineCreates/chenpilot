import type { CommandContext, CommandHandler, CommandReply } from "../types";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000";

export const feedbackHandler: CommandHandler = {
  name: "feedback",
  description: "Send feedback or report bugs to the development team",
  // Available on both platforms, but primarily used on Telegram
  platforms: ["discord", "telegram"],

  async execute(ctx: CommandContext): Promise<CommandReply> {
    const message = ctx.args.join(" ").trim();

    if (!message) {
      return {
        text:
          "📝 Feedback Command\n\n" +
          "Usage: /feedback <your message>\n\n" +
          "Example: /feedback The balance command is not working properly\n\n" +
          "Your feedback will be automatically forwarded to the development team.",
      };
    }

    const feedbackData = {
      userId: ctx.userId,
      message,
      timestamp: new Date().toISOString(),
      platform: ctx.platform,
    };

    const res = await fetch(`${BACKEND_URL}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(feedbackData),
    });

    if (res.ok) {
      return {
        text:
          "✅ Feedback Received\n\n" +
          "Thank you for your feedback! It has been automatically forwarded to the development team.\n\n" +
          "We will review it and take appropriate action.",
      };
    }

    return {
      text: "⚠️ Feedback Submission Failed\n\nSorry, we couldn't submit your feedback at this time. Please try again later.",
    };
  },
};
