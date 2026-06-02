import { DeFiAdapter, AdapterResult, QuoteResult, TransactionRequest, PositionResult } from "./DeFiAdapter";
import { LendingCapability, BorrowingCapability } from "./CapabilityContract";
import { YieldBloxLendingPositionsResponseSchema, YieldBloxBorrowingPositionsResponseSchema } from "./resilience/Schemas";

/**
 * YieldBlox Lending Adapter
 * Implements lending and borrowing operations for the YieldBlox protocol
 * 
 * YieldBlox is a lending protocol on Stellar that supports:
 * - Lending (supply assets to earn interest)
 * - Borrowing (use supplied assets as collateral)
 */
export class YieldBloxAdapter extends DeFiAdapter implements LendingCapability, BorrowingCapability {
  constructor() {
    super("yieldblox");
  }

  /**
   * Get a quote for a swap operation (not supported by YieldBlox)
   */
  async getSwapQuote(
    fromToken: string,
    toToken: string,
    amount: string
  ): Promise<AdapterResult<QuoteResult>> {
    return {
      success: false,
      error: "Swap is not supported by YieldBlox (lending protocol)",
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Execute a swap transaction (not supported by YieldBlox)
   */
  async executeSwap(
    fromToken: string,
    toToken: string,
    amount: string,
    minReceived?: string
  ): Promise<AdapterResult<TransactionRequest>> {
    return {
      success: false,
      error: "Swap is not supported by YieldBlox (lending protocol)",
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get liquidity positions (not applicable for lending protocol)
   */
  async getLiquidityPositions(address: string): Promise<AdapterResult<PositionResult[]>> {
    return {
      success: false,
      error: "Liquidity positions are not applicable for YieldBlox (lending protocol)",
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get lending positions for an address
   * These are assets the user has supplied to the protocol
   */
  async getLendingPositions(address: string): Promise<AdapterResult<PositionResult[]>> {
    if (!this.hasCapability("lending")) {
      return {
        success: false,
        error: "Lending capability is not enabled for YieldBlox adapter",
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const response = await this.fetchWithSchema<any>(
        `/v1/lending/positions/${address}`,
        YieldBloxLendingPositionsResponseSchema
      );

      const positions: PositionResult[] = (response.positions || []).map((pos: any) => ({
        token: pos.token,
        amount: pos.supplied,
        valueUSD: pos.valueUSD || 0,
        APY: pos.supplyAPY || 0,
      }));

      return {
        success: true,
        data: positions,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get lending positions",
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Get borrowing positions for an address
   * These are assets the user has borrowed from the protocol
   */
  async getBorrowingPositions(address: string): Promise<AdapterResult<PositionResult[]>> {
    if (!this.hasCapability("borrowing")) {
      return {
        success: false,
        error: "Borrowing capability is not enabled for YieldBlox adapter",
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const response = await this.fetchWithSchema<any>(
        `/v1/borrowing/positions/${address}`,
        YieldBloxBorrowingPositionsResponseSchema
      );

      const positions: PositionResult[] = (response.positions || []).map((pos: any) => ({
        token: pos.token,
        amount: pos.borrowed,
        valueUSD: pos.valueUSD || 0,
        APY: pos.borrowAPY || 0,
      }));

      return {
        success: true,
        data: positions,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get borrowing positions",
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Supply assets to the lending pool
   */
  async supply(asset: string, amount: string): Promise<AdapterResult<TransactionRequest>> {
    if (!this.hasCapability("lending")) {
      return {
        success: false,
        error: "Lending capability is not enabled for YieldBlox adapter",
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const lendingPoolAddress = this.getContractAddress("lendingPool");
      if (!lendingPoolAddress) {
        throw new Error("Lending pool contract not configured");
      }

      return {
        success: true,
        data: {
          to: lendingPoolAddress,
          data: JSON.stringify({
            function: "supply",
            args: { asset, amount },
          }),
          value: amount,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create supply transaction",
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Borrow assets from the lending pool
   */
  async borrow(asset: string, amount: string): Promise<AdapterResult<TransactionRequest>> {
    if (!this.hasCapability("borrowing")) {
      return {
        success: false,
        error: "Borrowing capability is not enabled for YieldBlox adapter",
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const lendingPoolAddress = this.getContractAddress("lendingPool");
      if (!lendingPoolAddress) {
        throw new Error("Lending pool contract not configured");
      }

      return {
        success: true,
        data: {
          to: lendingPoolAddress,
          data: JSON.stringify({
            function: "borrow",
            args: { asset, amount },
          }),
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create borrow transaction",
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Repay borrowed assets
   */
  async repay(asset: string, amount: string): Promise<AdapterResult<TransactionRequest>> {
    try {
      const lendingPoolAddress = this.getContractAddress("lendingPool");
      if (!lendingPoolAddress) {
        throw new Error("Lending pool contract not configured");
      }

      return {
        success: true,
        data: {
          to: lendingPoolAddress,
          data: JSON.stringify({
            function: "repay",
            args: { asset, amount },
          }),
          value: amount,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create repay transaction",
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Withdraw supplied assets
   */
  async withdraw(asset: string, amount: string): Promise<AdapterResult<TransactionRequest>> {
    try {
      const lendingPoolAddress = this.getContractAddress("lendingPool");
      if (!lendingPoolAddress) {
        throw new Error("Lending pool contract not configured");
      }

      return {
        success: true,
        data: {
          to: lendingPoolAddress,
          data: JSON.stringify({
            function: "withdraw",
            args: { asset, amount },
          }),
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create withdraw transaction",
        timestamp: new Date().toISOString(),
      };
    }
  }
}

// Export singleton instance
export const yieldBloxAdapter = new YieldBloxAdapter();
