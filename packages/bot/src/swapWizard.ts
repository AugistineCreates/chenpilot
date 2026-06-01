import {
  Workflow,
  WorkflowResult,
  WorkflowState,
  botWorkflowManager,
} from "./services/workflowService";

export class SwapWizard implements Workflow {
  public type = "swap_wizard";

  async checkPolicy(
    userId: string,
    platform: "discord" | "telegram"
  ): Promise<{ allowed: boolean; message?: string }> {
    const policy = await botWorkflowManager.checkRiskPolicy(userId, "high");
    if (!policy.allowed) {
      return {
        allowed: false,
        message: `⚠️ Swapping assets is a high-risk operation on ${platform}. Your current risk tolerance prevents this. Please update your settings.`,
      };
    }
    return { allowed: true };
  }

  start(userId: string, platform: "discord" | "telegram"): WorkflowResult {
    return {
      message: `🔄 **Swap Wizard (${platform})**\n\nStep 1/3: Which asset do you want to sell, user ${userId}? (e.g., XLM, USDC)`,
      nextStep: 1,
      data: {},
    };
  }

  async processInput(
    state: WorkflowState,
    input: string
  ): Promise<WorkflowResult> {
    const step = state.step;

    switch (step) {
      case 1:
        state.data.fromAsset = input.toUpperCase();
        return {
          message: `✅ Selling ${state.data.fromAsset}.\n\nStep 2/3: Which asset do you want to buy?`,
          nextStep: 2,
          data: state.data,
        };
      case 2:
        state.data.toAsset = input.toUpperCase();
        return {
          message: `✅ Buying ${state.data.toAsset}.\n\nStep 3/3: How much ${state.data.fromAsset} do you want to swap?`,
          nextStep: 3,
          data: state.data,
        };
      case 3:
        state.data.amount = input;
        return {
          message: `🚀 **Swap Summary**\n\nSell: ${state.data.amount} ${state.data.fromAsset}\nBuy: ${state.data.toAsset}\n\nType 'confirm' to execute the swap!`,
          nextStep: 4,
          data: state.data,
        };
      case 4:
        if (input.toLowerCase() === "confirm") {
          return {
            message: `✅ Swap executed! (Mock)\n\nYou swapped ${state.data.amount} ${state.data.fromAsset} for ${state.data.toAsset}.`,
            isComplete: true,
          };
        }
        return { message: "⚠️ Please type 'confirm' or 'cancel'." };
      default:
        return { message: "❌ Invalid step.", isComplete: true };
    }
  }

  getStepMessage(state: WorkflowState): string {
    switch (state.step) {
      case 1:
        return "Which asset do you want to sell?";
      case 2:
        return "Which asset do you want to buy?";
      case 3:
        return "How much do you want to swap?";
      case 4:
        return "Type 'confirm' to execute the swap.";
      default:
        return "Invalid step.";
    }
  }
}
