import {
  DeFiAdapter,
  AdapterResult,
  QuoteResult,
  TransactionRequest,
  PositionResult,
} from "./DeFiAdapter";
import { SwapCapability, LiquidityCapability } from "./CapabilityContract";
import {
  EquilibreSwapQuoteResponseSchema,
  EquilibreLiquidityPositionsResponseSchema,
} from "./resilience/Schemas";

/**
 * Equilibre DEX Adapter
 * Implements swap and liquidity operations for the Equilibre protocol
 *
 * Equilibre is a DEX on Stellar that supports:
 * - Token swaps via path payments
 * - Liquidity provision
 */
export class EquilibreAdapter extends DeFiAdapter implements SwapCapability, LiquidityCapability {
  constructor() {
    super("equilibre");
  }

  async getSwapQuote(
    fromToken: string,
    toToken: string,
    amount: string
  ): Promise<AdapterResult<QuoteResult>> {
    if (!this.hasCapability("swap")) {
      return {
        success: false,
        error: "Swap capability is not enabled for Equilibre adapter",
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const response = await this.fetchWithSchema<any>(
        "/v1/swap/quote",
        EquilibreSwapQuoteResponseSchema,
        {
          method: "POST",
          body: JSON.stringify({ fromToken, toToken, amount }),
        }
      );

      return {
        success: true,
        data: {
          fromToken: response.fromToken || fromToken,
          toToken: response.toToken || toToken,
          fromAmount: response.fromAmount || amount,
          toAmount: response.toAmount,
          priceImpact: response.priceImpact || 0,
          route: response.route || [],
          estimatedGas: response.estimatedGas || "0",
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get swap quote",
        timestamp: new Date().toISOString(),
      };
    }
  }

  async executeSwap(
    fromToken: string,
    toToken: string,
    amount: string,
    minReceived?: string
  ): Promise<AdapterResult<TransactionRequest>> {
    if (!this.hasCapability("swap")) {
      return {
        success: false,
        error: "Swap capability is not enabled for Equilibre adapter",
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const routerAddress = this.getContractAddress("router");
      if (!routerAddress) {
        throw new Error("Router contract not configured");
      }

      return {
        success: true,
        data: {
          to: routerAddress,
          data: JSON.stringify({
            function: "swap",
            args: { fromToken, toToken, amount, minReceived: minReceived || "0" },
          }),
          value: amount,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to execute swap",
        timestamp: new Date().toISOString(),
      };
    }
  }

  async getLiquidityPositions(
    address: string
  ): Promise<AdapterResult<PositionResult[]>> {
    if (!this.hasCapability("liquidity")) {
      return {
        success: false,
        error: "Liquidity capability is not enabled for Equilibre adapter",
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const response = await this.fetchWithSchema<any>(
        `/v1/liquidity/positions/${address}`,
        EquilibreLiquidityPositionsResponseSchema
      );

      const positions: PositionResult[] = (response.positions || []).map(
        (pos: { token: string; amount: string; valueUSD?: number; apy?: number }) => ({
          token: pos.token,
          amount: pos.amount,
          valueUSD: pos.valueUSD || 0,
          APY: pos.apy || 0,
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
        error: error instanceof Error ? error.message : "Failed to get liquidity positions",
        timestamp: new Date().toISOString(),
      };
    }
  }

  async getLendingPositions(
    address: string
  ): Promise<AdapterResult<PositionResult[]>> {
    return {
      success: false,
      error: "Lending is not supported by Equilibre",
      timestamp: new Date().toISOString(),
    };
  }

  async getBorrowingPositions(
    address: string
  ): Promise<AdapterResult<PositionResult[]>> {
    return {
      success: false,
      error: "Borrowing is not supported by Equilibre",
      timestamp: new Date().toISOString(),
    };
  }
}

export const equilibreAdapter = new EquilibreAdapter();
