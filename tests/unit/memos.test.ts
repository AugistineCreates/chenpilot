import {
  validateMemoHash,
  validateMemoReturn,
  buildMemoHash,
  buildMemoReturn,
} from "../../packages/sdk/src/memos";

describe("Memo Utility", () => {
  const validHex = "a".repeat(64);
  const invalidHexShort = "a".repeat(63);
  const invalidHexLong = "a".repeat(65);
  const invalidHexChars = "g".repeat(64);

  describe("Validation", () => {
    it("should validate valid 32-byte hex strings", () => {
      expect(validateMemoHash(validHex)).toBe(true);
      expect(validateMemoReturn(validHex)).toBe(true);
    });

    it("should reject invalid hex strings (wrong length)", () => {
      expect(validateMemoHash(invalidHexShort)).toBe(false);
      expect(validateMemoHash(invalidHexLong)).toBe(false);
      expect(validateMemoReturn(invalidHexShort)).toBe(false);
      expect(validateMemoReturn(invalidHexLong)).toBe(false);
    });

    it("should reject invalid hex strings (non-hex chars)", () => {
      expect(validateMemoHash(invalidHexChars)).toBe(false);
      expect(validateMemoReturn(invalidHexChars)).toBe(false);
    });

    it("should reject non-string inputs", () => {
      expect(validateMemoHash(123 as any)).toBe(false);
      expect(validateMemoHash(null as any)).toBe(false);
    });
  });

  describe("Building", () => {
    it("should build Buffer from valid hex string", () => {
      const hashBuffer = buildMemoHash(validHex);
      expect(hashBuffer).toBeInstanceOf(Buffer);
      expect(hashBuffer.length).toBe(32);
      expect(hashBuffer.toString("hex")).toBe(validHex);

      const returnBuffer = buildMemoReturn(validHex);
      expect(returnBuffer).toBeInstanceOf(Buffer);
      expect(returnBuffer.length).toBe(32);
      expect(returnBuffer.toString("hex")).toBe(validHex);
    });

    it("should throw error for invalid hex string", () => {
      expect(() => buildMemoHash(invalidHexShort)).toThrow("Invalid Hash memo");
      expect(() => buildMemoReturn(invalidHexShort)).toThrow(
        "Invalid Return memo"
      );
    });
  });
});
