import { describe, it, expect } from "@jest/globals";
import {
  CallbackAction,
  packCallback,
  unpackCallback,
  inlineBtn,
  inlineKeyboard,
} from "../callbackUtils";

describe("callbackUtils", () => {
  describe("packCallback / unpackCallback", () => {
    it("should round-trip an action without a payload", () => {
      const packed = packCallback(CallbackAction.CONFIRM_SWAP);
      expect(packed).toBe("cs");
      const unpacked = unpackCallback(packed);
      expect(unpacked).toEqual({ action: CallbackAction.CONFIRM_SWAP });
    });

    it("should round-trip an action with a payload", () => {
      const packed = packCallback(CallbackAction.SELECT_FROM_ASSET, {
        a: "XLM",
      });
      expect(packed).toBe('sf:{"a":"XLM"}');
      const unpacked = unpackCallback(packed);
      expect(unpacked).toEqual({
        action: CallbackAction.SELECT_FROM_ASSET,
        payload: { a: "XLM" },
      });
    });

    it("should enforce the 64-byte limit", () => {
      const hugePayload = { a: "X".repeat(100) };
      expect(() => {
        packCallback(CallbackAction.SELECT_FROM_ASSET, hugePayload);
      }).toThrow(/Callback data exceeds Telegram's 64-byte limit/);
    });

    it("should handle malformed input safely without throwing", () => {
      expect(unpackCallback("invalid_action")).toBeNull();
      expect(unpackCallback("")).toBeNull();
      expect(unpackCallback(null as any)).toBeNull();
      expect(unpackCallback(undefined as any)).toBeNull();

      // Unknown action but looks like a payload
      expect(unpackCallback('xx:{"a":1}')).toBeNull();

      // Valid action but invalid JSON payload
      const validAction = CallbackAction.SELECT_FROM_ASSET;
      expect(unpackCallback(`${validAction}:invalid_json`)).toEqual({
        action: validAction,
      });

      // Valid action but array payload (we ignore non-object payloads)
      expect(unpackCallback(`${validAction}:[1,2,3]`)).toEqual({
        action: validAction,
      });

      // Valid action but null payload
      expect(unpackCallback(`${validAction}:null`)).toEqual({
        action: validAction,
      });
    });
  });

  describe("UI builders", () => {
    it("inlineBtn should format correctly", () => {
      const btn = inlineBtn("Confirm", CallbackAction.CONFIRM_SWAP);
      expect(btn).toEqual({
        text: "Confirm",
        callback_data: "cs",
      });
    });

    it("inlineKeyboard should structure correctly", () => {
      const btn = inlineBtn("Confirm", CallbackAction.CONFIRM_SWAP);
      const kb = inlineKeyboard([[btn]]);
      expect(kb).toEqual({
        reply_markup: {
          inline_keyboard: [[btn]],
        },
      });
    });
  });
});
