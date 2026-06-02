import { z } from "zod";

/**
 * Standard output schemas matching internal interfaces
 */

export const QuoteResultSchema = z.object({
  fromToken: z.string(),
  toToken: z.string(),
  fromAmount: z.string(),
  toAmount: z.string(),
  priceImpact: z.number(),
  route: z.array(z.string()),
  estimatedGas: z.string(),
});

export const PositionResultSchema = z.object({
  token: z.string(),
  amount: z.string(),
  valueUSD: z.number(),
  APY: z.number(),
});

export const TransactionRequestSchema = z.object({
  to: z.string(),
  data: z.string(),
  value: z.string().optional(),
  gasLimit: z.string().optional(),
});

/**
 * External/Oracle Raw API Contract Schemas
 */

export const EquilibreSwapQuoteResponseSchema = z.object({
  fromToken: z.string().optional(),
  toToken: z.string().optional(),
  fromAmount: z.string().optional(),
  toAmount: z.string(),
  priceImpact: z.number().optional(),
  route: z.array(z.string()).optional(),
  estimatedGas: z.string().optional(),
});

export const EquilibreLiquidityPositionSchema = z.object({
  token: z.string(),
  amount: z.string(),
  valueUSD: z.number().optional(),
  apy: z.number().optional(),
});

export const EquilibreLiquidityPositionsResponseSchema = z.object({
  positions: z.array(EquilibreLiquidityPositionSchema).optional(),
});

export const YieldBloxLendingPositionSchema = z.object({
  token: z.string(),
  supplied: z.string(),
  valueUSD: z.number().optional(),
  supplyAPY: z.number().optional(),
});

export const YieldBloxLendingPositionsResponseSchema = z.object({
  positions: z.array(YieldBloxLendingPositionSchema).optional(),
});

export const YieldBloxBorrowingPositionSchema = z.object({
  token: z.string(),
  borrowed: z.string(),
  valueUSD: z.number().optional(),
  borrowAPY: z.number().optional(),
});

export const YieldBloxBorrowingPositionsResponseSchema = z.object({
  positions: z.array(YieldBloxBorrowingPositionSchema).optional(),
});
