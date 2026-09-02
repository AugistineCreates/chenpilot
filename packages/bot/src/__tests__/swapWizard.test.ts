import { describe, it, expect, beforeEach } from "@jest/globals";
import { SwapWizard } from "../swapWizard";
import { WorkflowState } from "../services/workflowService";
import { CallbackAction, packCallback } from "../callbackUtils";

describe("SwapWizard", () => {
  let wizard: SwapWizard;

  beforeEach(() => {
    wizard = new SwapWizard();
  });

  describe("start()", () => {
    it("should return initial step and inline buttons", () => {
      const res = wizard.start("user1", "telegram");
      expect(res.nextStep).toBe(1);
      expect(res.message).toMatch(/Which asset do you want to \*\*sell\*\*/);
      expect(res.buttons).toBeDefined();
      expect(res.buttons![0].length).toBeGreaterThan(1);
    });
  });

  describe("processInput() - typed callback transitions", () => {
    it("should process SELECT_FROM_ASSET callback", async () => {
      const state: WorkflowState = {
        workflowId: "test",
        userId: "user1",
        platform: "telegram",
        type: "swap_wizard",
        step: 1,
        data: {},
        isComplete: false,
      };

      const input = packCallback(CallbackAction.SELECT_FROM_ASSET, {
        a: "XLM",
      });
      const res = await wizard.processInput(state, input);

      expect(res.nextStep).toBe(2);
      expect(res.data?.fromAsset).toBe("XLM");
      expect(res.buttons).toBeDefined();
      expect(res.message).toMatch(/Selling \*\*XLM\*\*/);
    });

    it("should process SELECT_TO_ASSET callback", async () => {
      const state: WorkflowState = {
        workflowId: "test",
        userId: "user1",
        platform: "telegram",
        type: "swap_wizard",
        step: 2,
        data: { fromAsset: "XLM" },
        isComplete: false,
      };

      const input = packCallback(CallbackAction.SELECT_TO_ASSET, { a: "USDC" });
      const res = await wizard.processInput(state, input);

      expect(res.nextStep).toBe(3);
      expect(res.data?.toAsset).toBe("USDC");
      expect(res.message).toMatch(/How much/);
      expect(res.buttons).toBeUndefined(); // text input step
    });

    it("should process CONFIRM_SWAP callback", async () => {
      const state: WorkflowState = {
        workflowId: "test",
        userId: "user1",
        platform: "telegram",
        type: "swap_wizard",
        step: 4,
        data: { fromAsset: "XLM", toAsset: "USDC", amount: "100" },
        isComplete: false,
      };

      const input = packCallback(CallbackAction.CONFIRM_SWAP);
      const res = await wizard.processInput(state, input);

      expect(res.isComplete).toBe(true);
      expect(res.message).toMatch(/Swap executed/);
    });
  });

  describe("processInput() - text fallback transitions", () => {
    it("should process valid text input for asset selection", async () => {
      const state: WorkflowState = {
        workflowId: "test",
        userId: "user1",
        platform: "telegram",
        type: "swap_wizard",
        step: 1,
        data: {},
        isComplete: false,
      };

      const res = await wizard.processInput(state, "xlm");

      expect(res.nextStep).toBe(2);
      expect(res.data?.fromAsset).toBe("XLM");
    });

    it("should reject invalid text input for asset selection", async () => {
      const state: WorkflowState = {
        workflowId: "test",
        userId: "user1",
        platform: "telegram",
        type: "swap_wizard",
        step: 1,
        data: {},
        isComplete: false,
      };

      const res = await wizard.processInput(state, "unknown_asset");

      expect(res.nextStep).toBeUndefined(); // Stays on same step
      expect(res.message).toMatch(/Unknown asset/);
      expect(res.buttons).toBeDefined();
    });

    it("should process valid text input for amount", async () => {
      const state: WorkflowState = {
        workflowId: "test",
        userId: "user1",
        platform: "telegram",
        type: "swap_wizard",
        step: 3,
        data: { fromAsset: "XLM", toAsset: "USDC" },
        isComplete: false,
      };

      const res = await wizard.processInput(state, "50.5");

      expect(res.nextStep).toBe(4);
      expect(res.data?.amount).toBe("50.5");
      expect(res.buttons).toBeDefined();
    });
  });

  describe("processInput() - invalid / unexpected actions", () => {
    it("should safely handle unknown callback actions", async () => {
      const state: WorkflowState = {
        workflowId: "test",
        userId: "user1",
        platform: "telegram",
        type: "swap_wizard",
        step: 2,
        data: {},
        isComplete: false,
      };

      // Create a typed callback with a valid action code that isn't handled here
      const input = packCallback(CallbackAction.SET_THRESHOLD);
      const res = await wizard.processInput(state, input);

      expect(res.message).toMatch(/Unknown action/);
    });
  });
});
