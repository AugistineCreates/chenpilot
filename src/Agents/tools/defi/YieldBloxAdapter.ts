import {
  DeFiAdapter,
  AdapterResult,
  QuoteResult,
  TransactionRequest,
  PositionResult,
} from "./DeFiAdapter";
import { LendingCapability, BorrowingCapability } from "./CapabilityContract";
import {
  YieldBloxLendingPositionsResponseSchema,
  YieldBloxBorrowingPositionsResponseSchema,
} from "./resilience/Schemas";

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

  async getLiquidityPositions(
    address: string
  ): Promise<AdapterResult<PositionResult[]>> {
    return {
      success: false,
      error: "Liquidity positions are not applicable for YieldBlox (lending protocol)",
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get lending positions for an address.
   * These are assets the user has supplied to the protocol.
   * Includes collateral and accruedInterest when returned by the API.
   */
  async getLendingPositions(
    address: string
  ): Promise<AdapterResult<PositionResult[]>> {
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

      const positions: PositionResult[] = (response.positions || []).map(
        (pos: {
          token: string;
          supplied: string;
          valueUSD?: number;
          supplyAPY?: number;
          collateral?: string;
          accruedInterest?: string;
        }) => ({
          token: pos.token,
          amount: pos.supplied,
          valueUSD: pos.valueUSD || 0,
          APY: pos.supplyAPY || 0,
          ...(pos.collateral !== undefined && { collateral: pos.collateral }),
          ...(pos.accruedInterest !== undefined && { accruedInterest: pos.accruedInterest }),
        })
      );

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
   * Get borrowing positions for an address.
   * These are assets the user has borrowed from the protocol.
   * Includes collateral and accruedInterest when returned by the API.
   */
  async getBorrowingPositions(
    address: string
  ): Promise<AdapterResult<PositionResult[]>> {
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

      const positions: PositionResult[] = (response.positions || []).map(
        (pos: {
          token: string;
          borrowed: string;
          valueUSD?: number;
          borrowAPY?: number;
          collateral?: string;
          accruedInterest?: string;
          accruedInterestUSD?: number;
        }) => {
          const valueUSD = pos.valueUSD || 0;
          const accruedCostUSD = pos.accruedInterestUSD;
          return {
            token: pos.token,
            amount: pos.borrowed,
            valueUSD,
            APY: pos.borrowAPY || 0,
            ...(pos.collateral !== undefined && { collateral: pos.collateral }),
            ...(pos.accruedInterest !== undefined && { accruedInterest: pos.accruedInterest }),
            ...(accruedCostUSD !== undefined && {
              accruedCostUSD,
              netValueUSD: valueUSD - accruedCostUSD,
            }),
          };
        }
      );

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

  async supply(
    asset: string,
    amount: string
  ): Promise<AdapterResult<TransactionRequest>> {
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
          data: JSON.stringify({ function: "supply", args: { asset, amount } }),
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

  async borrow(
    asset: string,
    amount: string
  ): Promise<AdapterResult<TransactionRequest>> {
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
          data: JSON.stringify({ function: "borrow", args: { asset, amount } }),
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

  async repay(
    asset: string,
    amount: string
  ): Promise<AdapterResult<TransactionRequest>> {
    try {
      const lendingPoolAddress = this.getContractAddress("lendingPool");
      if (!lendingPoolAddress) {
        throw new Error("Lending pool contract not configured");
      }

      return {
        success: true,
        data: {
          to: lendingPoolAddress,
          data: JSON.stringify({ function: "repay", args: { asset, amount } }),
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

  async withdraw(
    asset: string,
    amount: string
  ): Promise<AdapterResult<TransactionRequest>> {
    try {
      const lendingPoolAddress = this.getContractAddress("lendingPool");
      if (!lendingPoolAddress) {
        throw new Error("Lending pool contract not configured");
      }

      return {
        success: true,
        data: {
          to: lendingPoolAddress,
          data: JSON.stringify({ function: "withdraw", args: { asset, amount } }),
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

export const yieldBloxAdapter = new YieldBloxAdapter();
