import { AdapterResult, QuoteResult, TransactionRequest, PositionResult } from "./DeFiAdapter";

/**
 * Base Capability Contract
 */
export interface CapabilityContract {
  protocol: string;
}

/**
 * Capability contract for swap operations
 */
export interface SwapCapability extends CapabilityContract {
  getSwapQuote(
    fromToken: string,
    toToken: string,
    amount: string
  ): Promise<AdapterResult<QuoteResult>>;

  executeSwap(
    fromToken: string,
    toToken: string,
    amount: string,
    minReceived?: string
  ): Promise<AdapterResult<TransactionRequest>>;
}

/**
 * Capability contract for liquidity operations
 */
export interface LiquidityCapability extends CapabilityContract {
  getLiquidityPositions(
    address: string
  ): Promise<AdapterResult<PositionResult[]>>;
}

/**
 * Capability contract for lending operations
 */
export interface LendingCapability extends CapabilityContract {
  getLendingPositions(
    address: string
  ): Promise<AdapterResult<PositionResult[]>>;

  supply?(
    asset: string,
    amount: string
  ): Promise<AdapterResult<TransactionRequest>>;

  withdraw?(
    asset: string,
    amount: string
  ): Promise<AdapterResult<TransactionRequest>>;
}

/**
 * Capability contract for borrowing operations
 */
export interface BorrowingCapability extends CapabilityContract {
  getBorrowingPositions(
    address: string
  ): Promise<AdapterResult<PositionResult[]>>;

  borrow?(
    asset: string,
    amount: string
  ): Promise<AdapterResult<TransactionRequest>>;

  repay?(
    asset: string,
    amount: string
  ): Promise<AdapterResult<TransactionRequest>>;
}
