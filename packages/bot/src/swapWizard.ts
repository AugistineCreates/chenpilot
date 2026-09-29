// packages/bot/src/swapWizard.ts
// Issue #557 — Swap wizard refactored to use typed inline-keyboard callbacks.

import {
  Workflow,
  WorkflowResult,
  WorkflowState,
  botWorkflowManager,
} from "./services/workflowService";
import { CallbackAction, inlineBtn, unpackCallback } from "./callbackUtils";

/** Supported swap assets. */
const SWAP_ASSETS = ["XLM", "USDC", "USDT"] as const;

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

  // ── Step 0: Entry point ──────────────────────────────────────────────
  start(userId: string, platform: "discord" | "telegram"): WorkflowResult {
    return {
      message:
        `🔄 **Swap Wizard (${platform})**\n\n` +
        `Step 1/3: Which asset do you want to **sell**, ${userId}?`,
      nextStep: 1,
      data: {},
      buttons: this.assetButtons(CallbackAction.SELECT_FROM_ASSET),
    };
  }

  // ── Step router ──────────────────────────────────────────────────────
  async processInput(
    state: WorkflowState,
    input: string
  ): Promise<WorkflowResult> {
    // Try to interpret `input` as a packed callback first.
    // When the adapter receives a callback_query it forwards the
    // callback_data string here instead of the raw text.
    const cb = unpackCallback(input);

    if (cb) {
      return this.handleCallback(state, cb.action, cb.payload);
    }

    // Fallback: plain-text input for platforms/steps that don't use buttons
    return this.handleTextInput(state, input);
  }

  // ── Callback handler (typed, from inline keyboards) ──────────────────
  private handleCallback(
    state: WorkflowState,
    action: CallbackAction,
    payload?: Record<string, unknown>
  ): WorkflowResult {
    switch (action) {
      // Step 1 → select source asset
      case CallbackAction.SELECT_FROM_ASSET: {
        const asset = (payload?.a as string) ?? "";
        state.data.fromAsset = asset;
        return {
          message:
            `✅ Selling **${asset}**.\n\n` +
            `Step 2/3: Which asset do you want to **buy**?`,
          nextStep: 2,
          data: state.data,
          buttons: this.assetButtons(
            CallbackAction.SELECT_TO_ASSET,
            asset // exclude the source asset
          ),
        };
      }

      // Step 2 → select destination asset
      case CallbackAction.SELECT_TO_ASSET: {
        const asset = (payload?.a as string) ?? "";
        state.data.toAsset = asset;
        return {
          message:
            `✅ Buying **${asset}**.\n\n` +
            `Step 3/3: How much **${state.data.fromAsset}** do you want to swap?\n\n` +
            `Type the amount (e.g. \`100\`).`,
          nextStep: 3,
          data: state.data,
        };
      }

      // Step 4 → confirm swap
      case CallbackAction.CONFIRM_SWAP:
        return {
          message:
            `✅ Swap executed! (Mock)\n\n` +
            `You swapped ${state.data.amount} ${state.data.fromAsset} for ${state.data.toAsset}.`,
          isComplete: true,
        };

      // Cancel at any step
      case CallbackAction.CANCEL_SWAP:
      case CallbackAction.CANCEL:
        return {
          message: "❌ Swap cancelled.",
          isComplete: true,
        };

      // Go back
      case CallbackAction.BACK: {
        const prevStep = Math.max(1, (state.step ?? 1) - 1);
        return {
          message: this.getStepMessage({ ...state, step: prevStep }),
          nextStep: prevStep,
          data: state.data,
          buttons:
            prevStep === 1
              ? this.assetButtons(CallbackAction.SELECT_FROM_ASSET)
              : prevStep === 2
                ? this.assetButtons(
                    CallbackAction.SELECT_TO_ASSET,
                    state.data.fromAsset as string
                  )
                : undefined,
        };
      }

      default:
        return { message: "⚠️ Unknown action." };
    }
  }

  // ── Plain-text fallback (step 3: amount entry) ───────────────────────
  private handleTextInput(state: WorkflowState, input: string): WorkflowResult {
    const step = state.step;

    switch (step) {
      // Step 1 fallback — accept typed asset name
      case 1: {
        const asset = input.trim().toUpperCase();
        if (!SWAP_ASSETS.includes(asset as (typeof SWAP_ASSETS)[number])) {
          return {
            message: `⚠️ Unknown asset "${input}". Please pick from the buttons or type one of: ${SWAP_ASSETS.join(", ")}`,
            buttons: this.assetButtons(CallbackAction.SELECT_FROM_ASSET),
          };
        }
        return this.handleCallback(state, CallbackAction.SELECT_FROM_ASSET, {
          a: asset,
        });
      }

      // Step 2 fallback — accept typed asset name
      case 2: {
        const asset = input.trim().toUpperCase();
        if (!SWAP_ASSETS.includes(asset as (typeof SWAP_ASSETS)[number])) {
          return {
            message: `⚠️ Unknown asset "${input}". Please pick from the buttons or type one of: ${SWAP_ASSETS.join(", ")}`,
            buttons: this.assetButtons(
              CallbackAction.SELECT_TO_ASSET,
              state.data.fromAsset as string
            ),
          };
        }
        if (asset === state.data.fromAsset) {
          return {
            message: `⚠️ Source and destination assets must be different.`,
            buttons: this.assetButtons(
              CallbackAction.SELECT_TO_ASSET,
              state.data.fromAsset as string
            ),
          };
        }
        return this.handleCallback(state, CallbackAction.SELECT_TO_ASSET, {
          a: asset,
        });
      }

      // Step 3 — amount (always text, keyboards aren't practical here)
      case 3: {
        const amount = parseFloat(input);
        if (isNaN(amount) || amount <= 0) {
          return { message: "⚠️ Please enter a valid positive number." };
        }
        state.data.amount = input;
        return {
          message:
            `🚀 **Swap Summary**\n\n` +
            `Sell: ${state.data.amount} ${state.data.fromAsset}\n` +
            `Buy: ${state.data.toAsset}\n\n` +
            `Tap **Confirm** to execute or **Cancel** to abort.`,
          nextStep: 4,
          data: state.data,
          buttons: [
            [
              inlineBtn("✅ Confirm", CallbackAction.CONFIRM_SWAP),
              inlineBtn("❌ Cancel", CallbackAction.CANCEL_SWAP),
            ],
          ],
        };
      }

      // Step 4 — text fallback for confirm
      case 4: {
        const lower = input.toLowerCase().trim();
        if (lower === "confirm" || lower === "yes") {
          return this.handleCallback(state, CallbackAction.CONFIRM_SWAP);
        }
        if (lower === "cancel" || lower === "no") {
          return this.handleCallback(state, CallbackAction.CANCEL_SWAP);
        }
        return {
          message: "⚠️ Please tap a button or type 'confirm' / 'cancel'.",
          buttons: [
            [
              inlineBtn("✅ Confirm", CallbackAction.CONFIRM_SWAP),
              inlineBtn("❌ Cancel", CallbackAction.CANCEL_SWAP),
            ],
          ],
        };
      }

      default:
        return { message: "❌ Invalid step.", isComplete: true };
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /** Build a row of asset-selection buttons, optionally excluding one. */
  private assetButtons(
    action: CallbackAction,
    exclude?: string
  ): Array<Array<{ text: string; callback_data: string }>> {
    const assets = SWAP_ASSETS.filter((a) => a !== exclude);
    return [
      assets.map((asset) => inlineBtn(asset, action, { a: asset })),
      [inlineBtn("❌ Cancel", CallbackAction.CANCEL_SWAP)],
    ];
  }

  getStepMessage(state: WorkflowState): string {
    switch (state.step) {
      case 1:
        return "Which asset do you want to sell?";
      case 2:
        return "Which asset do you want to buy?";
      case 3:
        return `How much ${state.data.fromAsset || ""} do you want to swap?`;
      case 4:
        return "Tap Confirm to execute the swap.";
      default:
        return "Invalid step.";
    }
  }
}
