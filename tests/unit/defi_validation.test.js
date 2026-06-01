"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const validationService_1 = require("../../src/Agents/validationService");
describe("validateDeFiIntent", () => {
  describe("Swap Intent Validation", () => {
    it("should validate a valid swap intent", () => {
      const intent = {
        action: "swap",
        payload: {
          from: "XLM",
          to: "USDC",
          amount: 100,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    it("should reject swap intent missing 'from' asset", () => {
      const intent = {
        action: "swap",
        payload: {
          to: "USDC",
          amount: 100,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "from",
          code: "MISSING_FROM_ASSET",
        })
      );
    });
    it("should reject swap intent missing 'to' asset", () => {
      const intent = {
        action: "swap",
        payload: {
          from: "XLM",
          amount: 100,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "to",
          code: "MISSING_TO_ASSET",
        })
      );
    });
    it("should reject swap intent with same from and to assets", () => {
      const intent = {
        action: "swap",
        payload: {
          from: "XLM",
          to: "xlm",
          amount: 100,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "from,to",
          code: "SAME_ASSETS",
        })
      );
    });
    it("should reject swap intent with unsupported from token", () => {
      const intent = {
        action: "swap",
        payload: {
          from: "BTC",
          to: "USDC",
          amount: 100,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "from",
          code: "INVALID_FROM_TOKEN",
        })
      );
    });
    it("should reject swap intent with unsupported to token", () => {
      const intent = {
        action: "swap",
        payload: {
          from: "XLM",
          to: "BTC",
          amount: 100,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "to",
          code: "INVALID_TO_TOKEN",
        })
      );
    });
    it("should reject swap intent missing amount", () => {
      const intent = {
        action: "swap",
        payload: {
          from: "XLM",
          to: "USDC",
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "amount",
          code: "MISSING_AMOUNT",
        })
      );
    });
    it("should reject swap intent with invalid amount type", () => {
      const intent = {
        action: "swap",
        payload: {
          from: "XLM",
          to: "USDC",
          amount: "100",
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "amount",
          code: "INVALID_AMOUNT_TYPE",
        })
      );
    });
    it("should reject swap intent with zero amount", () => {
      const intent = {
        action: "swap",
        payload: {
          from: "XLM",
          to: "USDC",
          amount: 0,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "amount",
          code: "INVALID_AMOUNT_VALUE",
        })
      );
    });
    it("should reject swap intent with negative amount", () => {
      const intent = {
        action: "swap",
        payload: {
          from: "XLM",
          to: "USDC",
          amount: -50,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "amount",
          code: "INVALID_AMOUNT_VALUE",
        })
      );
    });
    it("should reject swap intent with infinite amount", () => {
      const intent = {
        action: "swap",
        payload: {
          from: "XLM",
          to: "USDC",
          amount: Infinity,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "amount",
          code: "INVALID_AMOUNT_FINITE",
        })
      );
    });
    it("should warn for large swap amounts", () => {
      const intent = {
        action: "swap",
        payload: {
          from: "XLM",
          to: "USDC",
          amount: 15000,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain(
        expect.stringContaining("Large swap amount detected")
      );
    });
    it("should validate swap with valid slippage", () => {
      const intent = {
        action: "swap",
        payload: {
          from: "XLM",
          to: "USDC",
          amount: 100,
          slippage: 1,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(true);
    });
    it("should reject swap with invalid slippage type", () => {
      const intent = {
        action: "swap",
        payload: {
          from: "XLM",
          to: "USDC",
          amount: 100,
          slippage: "1",
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "slippage",
          code: "INVALID_SLIPPAGE_TYPE",
        })
      );
    });
    it("should reject swap with slippage out of range", () => {
      const intent = {
        action: "swap",
        payload: {
          from: "XLM",
          to: "USDC",
          amount: 100,
          slippage: 150,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "slippage",
          code: "INVALID_SLIPPAGE_RANGE",
        })
      );
    });
    it("should warn for high slippage", () => {
      const intent = {
        action: "swap",
        payload: {
          from: "XLM",
          to: "USDC",
          amount: 100,
          slippage: 10,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain(
        expect.stringContaining("High slippage tolerance")
      );
    });
  });
  describe("Liquidity Intent Validation", () => {
    it("should validate a valid add_liquidity intent", () => {
      const intent = {
        action: "add_liquidity",
        payload: {
          tokenA: "XLM",
          tokenB: "USDC",
          amountA: 100,
          amountB: 50,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    it("should reject add_liquidity intent missing tokenA", () => {
      const intent = {
        action: "add_liquidity",
        payload: {
          tokenB: "USDC",
          amountA: 100,
          amountB: 50,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "tokenA",
          code: "MISSING_TOKEN_A",
        })
      );
    });
    it("should reject add_liquidity intent missing tokenB", () => {
      const intent = {
        action: "add_liquidity",
        payload: {
          tokenA: "XLM",
          amountA: 100,
          amountB: 50,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "tokenB",
          code: "MISSING_TOKEN_B",
        })
      );
    });
    it("should reject add_liquidity intent with invalid amountA", () => {
      const intent = {
        action: "add_liquidity",
        payload: {
          tokenA: "XLM",
          tokenB: "USDC",
          amountA: 0,
          amountB: 50,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "amountA",
          code: "INVALID_AMOUNT_A",
        })
      );
    });
    it("should reject add_liquidity intent with invalid amountB", () => {
      const intent = {
        action: "add_liquidity",
        payload: {
          tokenA: "XLM",
          tokenB: "USDC",
          amountA: 100,
          amountB: -10,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "amountB",
          code: "INVALID_AMOUNT_B",
        })
      );
    });
    it("should validate a valid remove_liquidity intent", () => {
      const intent = {
        action: "remove_liquidity",
        payload: {
          tokenA: "XLM",
          tokenB: "USDC",
          lpAmount: 50,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    it("should reject remove_liquidity intent with invalid lpAmount", () => {
      const intent = {
        action: "remove_liquidity",
        payload: {
          tokenA: "XLM",
          tokenB: "USDC",
          lpAmount: 0,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "lpAmount",
          code: "INVALID_LP_AMOUNT",
        })
      );
    });
  });
  describe("Lending Intent Validation", () => {
    it("should validate a valid lend intent", () => {
      const intent = {
        action: "lend",
        payload: {
          token: "USDC",
          amount: 1000,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    it("should validate lend intent with asset field", () => {
      const intent = {
        action: "lend",
        payload: {
          asset: "USDC",
          amount: 1000,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    it("should reject lend intent missing token/asset", () => {
      const intent = {
        action: "lend",
        payload: {
          amount: 1000,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "token",
          code: "MISSING_TOKEN",
        })
      );
    });
    it("should reject lend intent with unsupported token", () => {
      const intent = {
        action: "lend",
        payload: {
          token: "DOGE",
          amount: 1000,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "token",
          code: "INVALID_TOKEN",
        })
      );
    });
    it("should reject lend intent with invalid amount", () => {
      const intent = {
        action: "lend",
        payload: {
          token: "USDC",
          amount: -100,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "amount",
          code: "INVALID_AMOUNT",
        })
      );
    });
    it("should validate a valid borrow intent", () => {
      const intent = {
        action: "borrow",
        payload: {
          token: "USDC",
          amount: 500,
          collateral: "XLM",
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    it("should warn for borrow intent without collateral", () => {
      const intent = {
        action: "borrow",
        payload: {
          token: "USDC",
          amount: 500,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain(
        expect.stringContaining("No collateral specified")
      );
    });
    it("should warn for large borrow amounts", () => {
      const intent = {
        action: "borrow",
        payload: {
          token: "USDC",
          amount: 60000,
          collateral: "XLM",
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain(
        expect.stringContaining("Large borrow amount")
      );
    });
  });
  describe("Repay/Withdraw Intent Validation", () => {
    it("should validate a valid repay intent", () => {
      const intent = {
        action: "repay",
        payload: {
          token: "USDC",
          amount: 500,
          debtId: "debt-123",
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    it("should warn for repay intent without debtId", () => {
      const intent = {
        action: "repay",
        payload: {
          token: "USDC",
          amount: 500,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain(
        expect.stringContaining("No debt/position ID specified")
      );
    });
    it("should validate a valid withdraw intent", () => {
      const intent = {
        action: "withdraw",
        payload: {
          token: "USDC",
          amount: 1000,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    it("should reject withdraw intent missing token", () => {
      const intent = {
        action: "withdraw",
        payload: {
          amount: 1000,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "token",
          code: "MISSING_TOKEN",
        })
      );
    });
    it("should reject withdraw intent with invalid amount", () => {
      const intent = {
        action: "withdraw",
        payload: {
          token: "USDC",
          amount: 0,
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "amount",
          code: "INVALID_AMOUNT",
        })
      );
    });
  });
  describe("Invalid Action Validation", () => {
    it("should reject non-DeFi actions", () => {
      const intent = {
        action: "send_email",
        payload: {
          to: "test@example.com",
        },
      };
      const result = (0, validationService_1.validateDeFiIntent)(intent);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "action",
          code: "INVALID_ACTION",
        })
      );
    });
  });
});
