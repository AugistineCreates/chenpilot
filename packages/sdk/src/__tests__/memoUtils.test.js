"use strict";
/**
 * Tests for MemoUtils
 */
Object.defineProperty(exports, "__esModule", { value: true });
const memoUtils_1 = require("../memoUtils");
// Mock Stellar SDK
jest.mock("stellar-sdk", () => ({
  Memo: {
    hash: jest.fn((buffer) => ({
      type: "hash",
      value: buffer,
    })),
    return: jest.fn((buffer) => ({
      type: "return",
      value: buffer,
    })),
  },
}));
describe("MemoUtils", () => {
  describe("isValidMemoHash", () => {
    it("should validate a 32-byte buffer", () => {
      const buffer = Buffer.alloc(32, "test");
      expect((0, memoUtils_1.isValidMemoHash)(buffer)).toBe(true);
    });
    it("should throw for buffer with wrong length", () => {
      const buffer = Buffer.alloc(16);
      expect(() => (0, memoUtils_1.isValidMemoHash)(buffer)).toThrow(
        memoUtils_1.MemoValidationError
      );
      expect(() => (0, memoUtils_1.isValidMemoHash)(buffer)).toThrow(
        "Memo hash must be exactly 32 bytes"
      );
    });
    it("should throw for null or undefined", () => {
      expect(() => (0, memoUtils_1.isValidMemoHash)(null)).toThrow(
        memoUtils_1.MemoValidationError
      );
      expect(() => (0, memoUtils_1.isValidMemoHash)(undefined)).toThrow(
        memoUtils_1.MemoValidationError
      );
    });
  });
  describe("buildHashMemo", () => {
    it("should build hash memo from Buffer", () => {
      const buffer = Buffer.alloc(32, "test");
      const memo = (0, memoUtils_1.buildHashMemo)(buffer);
      expect(memo.type).toBe("hash");
      expect(memo.value).toEqual(buffer);
    });
    it("should build hash memo from hex string", () => {
      const hex = "a".repeat(64); // 64 hex chars = 32 bytes
      const memo = (0, memoUtils_1.buildHashMemo)(hex);
      expect(memo.type).toBe("hash");
      expect(memo.value).toEqual(Buffer.from(hex, "hex"));
    });
    it("should build hash memo from Uint8Array", () => {
      const array = new Uint8Array(32);
      array.fill(42);
      const memo = (0, memoUtils_1.buildHashMemo)(array);
      expect(memo.type).toBe("hash");
    });
    it("should throw for invalid hex string length", () => {
      const invalidHex = "a".repeat(63); // 63 chars is invalid
      expect(() => (0, memoUtils_1.buildHashMemo)(invalidHex)).toThrow(
        memoUtils_1.MemoValidationError
      );
      expect(() => (0, memoUtils_1.buildHashMemo)(invalidHex)).toThrow(
        "must be exactly 64 hexadecimal characters"
      );
    });
    it("should throw for invalid hex characters", () => {
      const invalidHex = "z".repeat(64); // 'z' is not hex
      expect(() => (0, memoUtils_1.buildHashMemo)(invalidHex)).toThrow(
        memoUtils_1.MemoValidationError
      );
    });
    it("should throw for buffer with wrong size", () => {
      const buffer = Buffer.alloc(16);
      expect(() => (0, memoUtils_1.buildHashMemo)(buffer)).toThrow(
        memoUtils_1.MemoValidationError
      );
    });
    it("should throw for invalid input type", () => {
      expect(() => (0, memoUtils_1.buildHashMemo)(123)).toThrow(
        memoUtils_1.MemoValidationError
      );
      expect(() => (0, memoUtils_1.buildHashMemo)({})).toThrow(
        memoUtils_1.MemoValidationError
      );
    });
  });
  describe("buildReturnMemo", () => {
    it("should build return memo from Buffer", () => {
      const buffer = Buffer.alloc(32, "test");
      const memo = (0, memoUtils_1.buildReturnMemo)(buffer);
      expect(memo.type).toBe("return");
      expect(memo.value).toEqual(buffer);
    });
    it("should build return memo from hex string", () => {
      const hex = "b".repeat(64);
      const memo = (0, memoUtils_1.buildReturnMemo)(hex);
      expect(memo.type).toBe("return");
      expect(memo.value).toEqual(Buffer.from(hex, "hex"));
    });
    it("should build return memo from Uint8Array", () => {
      const array = new Uint8Array(32);
      array.fill(99);
      const memo = (0, memoUtils_1.buildReturnMemo)(array);
      expect(memo.type).toBe("return");
    });
    it("should throw for invalid hex string length", () => {
      const invalidHex = "b".repeat(60);
      expect(() => (0, memoUtils_1.buildReturnMemo)(invalidHex)).toThrow(
        memoUtils_1.MemoValidationError
      );
      expect(() => (0, memoUtils_1.buildReturnMemo)(invalidHex)).toThrow(
        "must be exactly 64 hexadecimal characters"
      );
    });
  });
  describe("validateMemo", () => {
    it("should validate a hash memo", () => {
      const memo = {
        type: "hash",
        value: Buffer.alloc(32),
      };
      expect((0, memoUtils_1.validateMemo)(memo)).toBe(true);
    });
    it("should validate a return memo", () => {
      const memo = {
        type: "return",
        value: Buffer.alloc(32),
      };
      expect((0, memoUtils_1.validateMemo)(memo)).toBe(true);
    });
    it("should throw for null memo", () => {
      expect(() => (0, memoUtils_1.validateMemo)(null)).toThrow(
        memoUtils_1.MemoValidationError
      );
      expect(() => (0, memoUtils_1.validateMemo)(null)).toThrow(
        "Memo cannot be null or undefined"
      );
    });
    it("should throw for hash memo with wrong size", () => {
      const memo = {
        type: "hash",
        value: Buffer.alloc(16),
      };
      expect(() => (0, memoUtils_1.validateMemo)(memo)).toThrow(
        memoUtils_1.MemoValidationError
      );
      expect(() => (0, memoUtils_1.validateMemo)(memo)).toThrow(
        "must be exactly 32 bytes"
      );
    });
    it("should throw for return memo with wrong size", () => {
      const memo = {
        type: "return",
        value: Buffer.alloc(64),
      };
      expect(() => (0, memoUtils_1.validateMemo)(memo)).toThrow(
        memoUtils_1.MemoValidationError
      );
    });
  });
  describe("memoToHex", () => {
    it("should convert hash memo to hex", () => {
      const buffer = Buffer.from("a".repeat(64), "hex");
      const memo = {
        type: "hash",
        value: buffer,
      };
      const hex = (0, memoUtils_1.memoToHex)(memo);
      expect(hex).toBe("a".repeat(64));
    });
    it("should convert return memo to hex", () => {
      const buffer = Buffer.from("b".repeat(64), "hex");
      const memo = {
        type: "return",
        value: buffer,
      };
      const hex = (0, memoUtils_1.memoToHex)(memo);
      expect(hex).toBe("b".repeat(64));
    });
    it("should throw for non-hash/return memo types", () => {
      const memo = {
        type: "text",
        value: "test",
      };
      expect(() => (0, memoUtils_1.memoToHex)(memo)).toThrow(
        memoUtils_1.MemoValidationError
      );
      expect(() => (0, memoUtils_1.memoToHex)(memo)).toThrow(
        "Only 'hash' and 'return' types are supported"
      );
    });
    it("should throw for id memo type", () => {
      const memo = {
        type: "id",
        value: "12345",
      };
      expect(() => (0, memoUtils_1.memoToHex)(memo)).toThrow(
        memoUtils_1.MemoValidationError
      );
    });
  });
  describe("hexToMemoBuffer", () => {
    it("should convert valid hex string to buffer", () => {
      const hex = "c".repeat(64);
      const buffer = (0, memoUtils_1.hexToMemoBuffer)(hex);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBe(32);
      expect(buffer.toString("hex")).toBe(hex);
    });
    it("should throw for invalid hex string length", () => {
      expect(() => (0, memoUtils_1.hexToMemoBuffer)("c".repeat(63))).toThrow(
        memoUtils_1.MemoValidationError
      );
      expect(() => (0, memoUtils_1.hexToMemoBuffer)("c".repeat(65))).toThrow(
        memoUtils_1.MemoValidationError
      );
    });
    it("should throw for non-hex characters", () => {
      const invalidHex = "z".repeat(64);
      expect(() => (0, memoUtils_1.hexToMemoBuffer)(invalidHex)).toThrow(
        memoUtils_1.MemoValidationError
      );
    });
    it("should handle mixed case hex", () => {
      const hex = "aAbBcCdDeEfF".repeat(5) + "aabbccdd"; // 64 chars
      const buffer = (0, memoUtils_1.hexToMemoBuffer)(hex);
      expect(buffer.length).toBe(32);
    });
  });
  describe("compareMemos", () => {
    it("should return true for identical hash memos", () => {
      const hex = "d".repeat(64);
      const memo1 = {
        type: "hash",
        value: Buffer.from(hex, "hex"),
      };
      const memo2 = {
        type: "hash",
        value: Buffer.from(hex, "hex"),
      };
      expect((0, memoUtils_1.compareMemos)(memo1, memo2)).toBe(true);
    });
    it("should return true for identical return memos", () => {
      const hex = "e".repeat(64);
      const memo1 = {
        type: "return",
        value: Buffer.from(hex, "hex"),
      };
      const memo2 = {
        type: "return",
        value: Buffer.from(hex, "hex"),
      };
      expect((0, memoUtils_1.compareMemos)(memo1, memo2)).toBe(true);
    });
    it("should return false for different memo types", () => {
      const hex = "f".repeat(64);
      const memo1 = {
        type: "hash",
        value: Buffer.from(hex, "hex"),
      };
      const memo2 = {
        type: "return",
        value: Buffer.from(hex, "hex"),
      };
      expect((0, memoUtils_1.compareMemos)(memo1, memo2)).toBe(false);
    });
    it("should return false for different values", () => {
      const memo1 = {
        type: "hash",
        value: Buffer.from("a".repeat(64), "hex"),
      };
      const memo2 = {
        type: "hash",
        value: Buffer.from("b".repeat(64), "hex"),
      };
      expect((0, memoUtils_1.compareMemos)(memo1, memo2)).toBe(false);
    });
    it("should handle text memos", () => {
      const memo1 = {
        type: "text",
        value: "test",
      };
      const memo2 = {
        type: "text",
        value: "test",
      };
      expect((0, memoUtils_1.compareMemos)(memo1, memo2)).toBe(true);
    });
    it("should return false for different text memos", () => {
      const memo1 = {
        type: "text",
        value: "test1",
      };
      const memo2 = {
        type: "text",
        value: "test2",
      };
      expect((0, memoUtils_1.compareMemos)(memo1, memo2)).toBe(false);
    });
  });
  describe("Integration tests", () => {
    it("should round-trip hash memo through hex conversion", () => {
      const hex = "1".repeat(64);
      const memo = (0, memoUtils_1.buildHashMemo)(hex);
      const convertedHex = (0, memoUtils_1.memoToHex)(memo);
      expect(convertedHex).toBe(hex);
    });
    it("should round-trip return memo through hex conversion", () => {
      const hex = "2".repeat(64);
      const memo = (0, memoUtils_1.buildReturnMemo)(hex);
      const convertedHex = (0, memoUtils_1.memoToHex)(memo);
      expect(convertedHex).toBe(hex);
    });
    it("should compare memos built from same hex", () => {
      const hex = "3".repeat(64);
      const memo1 = (0, memoUtils_1.buildHashMemo)(hex);
      const memo2 = (0, memoUtils_1.buildHashMemo)(hex);
      expect((0, memoUtils_1.compareMemos)(memo1, memo2)).toBe(true);
    });
    it("should validate memo after building", () => {
      const buffer = Buffer.alloc(32, "test");
      const memo = (0, memoUtils_1.buildHashMemo)(buffer);
      expect((0, memoUtils_1.validateMemo)(memo)).toBe(true);
    });
  });
});
