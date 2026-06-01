"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const memos_1 = require("../../packages/sdk/src/memos");
describe("Memo Utility", () => {
  const validHex = "a".repeat(64);
  const invalidHexShort = "a".repeat(63);
  const invalidHexLong = "a".repeat(65);
  const invalidHexChars = "g".repeat(64);
  describe("Validation", () => {
    it("should validate valid 32-byte hex strings", () => {
      expect((0, memos_1.validateMemoHash)(validHex)).toBe(true);
      expect((0, memos_1.validateMemoReturn)(validHex)).toBe(true);
    });
    it("should reject invalid hex strings (wrong length)", () => {
      expect((0, memos_1.validateMemoHash)(invalidHexShort)).toBe(false);
      expect((0, memos_1.validateMemoHash)(invalidHexLong)).toBe(false);
      expect((0, memos_1.validateMemoReturn)(invalidHexShort)).toBe(false);
      expect((0, memos_1.validateMemoReturn)(invalidHexLong)).toBe(false);
    });
    it("should reject invalid hex strings (non-hex chars)", () => {
      expect((0, memos_1.validateMemoHash)(invalidHexChars)).toBe(false);
      expect((0, memos_1.validateMemoReturn)(invalidHexChars)).toBe(false);
    });
    it("should reject non-string inputs", () => {
      expect((0, memos_1.validateMemoHash)(123)).toBe(false);
      expect((0, memos_1.validateMemoHash)(null)).toBe(false);
    });
  });
  describe("Building", () => {
    it("should build Buffer from valid hex string", () => {
      const hashBuffer = (0, memos_1.buildMemoHash)(validHex);
      expect(hashBuffer).toBeInstanceOf(Buffer);
      expect(hashBuffer.length).toBe(32);
      expect(hashBuffer.toString("hex")).toBe(validHex);
      const returnBuffer = (0, memos_1.buildMemoReturn)(validHex);
      expect(returnBuffer).toBeInstanceOf(Buffer);
      expect(returnBuffer.length).toBe(32);
      expect(returnBuffer.toString("hex")).toBe(validHex);
    });
    it("should throw error for invalid hex string", () => {
      expect(() => (0, memos_1.buildMemoHash)(invalidHexShort)).toThrow(
        "Invalid Hash memo"
      );
      expect(() => (0, memos_1.buildMemoReturn)(invalidHexShort)).toThrow(
        "Invalid Return memo"
      );
    });
  });
});
