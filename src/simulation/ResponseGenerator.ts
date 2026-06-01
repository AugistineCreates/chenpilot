import { SimulationConfig, SimulationRequest, LatencyConfig } from "./types";
import {
  InvokeContractResult,
  SorobanNetwork,
} from "../services/sorobanService";
import { SeededRNG } from "./SeededRNG";
import logger from "../config/logger";

// ... existing interfaces ...

export class ResponseGenerator {
  private config!: SimulationConfig;

  async initialize(config: SimulationConfig): Promise<void> {
    this.config = config;
    logger.info("Response generator initialized");
  }

  async generateSorobanResponse(
    request: SimulationRequest,
    rng: SeededRNG
  ): Promise<InvokeContractResult> {
    const { parameters } = request;

    // Simulate realistic Soroban contract response
    const mockResult = this.generateMockContractResult(parameters, rng);

    const response: InvokeContractResult = {
      network: (parameters.network as SorobanNetwork) || "testnet",
      contractId: parameters.contractId as string,
      method: parameters.method as string,
      result: mockResult,
      raw: {
        // Simulate raw Stellar SDK response structure
        result: {
          retval: mockResult,
          auth: [],
          events: [],
        },
        cost: {
          cpuInsns: Math.floor(rng.next() * 1000000),
          memBytes: Math.floor(rng.next() * 100000),
        },
      },
    };

    // Add realistic error injection
    if (rng.next() < this.config.simulation.errorRate) {
      throw new Error(
        `Simulated contract error: ${this.generateRandomError(rng)}`
      );
    }

    logger.debug("Soroban response generated", {
      contractId: parameters.contractId,
      method: parameters.method,
    });
    return response;
  }

  async generateWalletResponse(
    request: SimulationRequest,
    rng: SeededRNG
  ): Promise<
    WalletBalanceResponse | WalletTransferResponse | WalletAddressResponse
  > {
    const { operation, parameters } = request;

    switch (operation) {
      case "get_balance":
        return this.generateBalanceResponse(parameters, rng);
      case "transfer":
        return this.generateTransferResponse(parameters, rng);
      case "get_address":
        return this.generateAddressResponse(parameters, rng);
      default:
        throw new Error(`Unknown wallet operation: ${operation}`);
    }
  }

  async generateSwapResponse(
    request: SimulationRequest,
    rng: SeededRNG
  ): Promise<SwapResponse> {
    const { parameters } = request;

    // Simulate DEX swap response
    const mockSwapResult: SwapResponse = {
      inputToken: (parameters.inputToken as string) || "STRK",
      outputToken: (parameters.outputToken as string) || "ETH",
      inputAmount: (parameters.inputAmount as string) || "100",
      outputAmount: this.calculateMockSwapOutput(parameters, rng),
      slippage: rng.next() * 0.05, // 0-5% slippage
      fee: this.calculateMockSwapFee(parameters),
      txHash: this.generateMockTxHash(rng),
    };

    logger.debug("Swap response generated", mockSwapResult);
    return mockSwapResult;
  }

  private generateMockContractResult(
    parameters: MethodParameters,
    rng: SeededRNG
  ): ContractResult {
    const method = parameters.method as string;

    // Generate different mock results based on method name
    if (method.includes("balance") || method.includes("get")) {
      return Math.floor(rng.next() * 1000000).toString();
    } else if (method.includes("transfer") || method.includes("send")) {
      return { success: true, txHash: this.generateMockTxHash(rng) };
    } else if (method.includes("swap")) {
      return {
        amountOut: Math.floor(rng.next() * 1000).toString(),
        fee: Math.floor(rng.next() * 100).toString(),
      };
    } else {
      // Generic response
      return {
        status: "success",
        value: Math.floor(rng.next() * 1000),
        timestamp: Date.now(),
      };
    }
  }

  private generateBalanceResponse(
    parameters: MethodParameters,
    rng: SeededRNG
  ): WalletBalanceResponse {
    const token = parameters.token || "STRK";
    const mockBalance = (rng.next() * 10000).toFixed(2);

    return {
      balance: `${mockBalance} ${token}`,
      token: this.getMockTokenAddress(token, rng),
      address: parameters.address || this.generateMockAddress(rng),
    };
  }

  private generateTransferResponse(
    parameters: MethodParameters,
    rng: SeededRNG
  ): WalletTransferResponse {
    return {
      from: (parameters.from as string) || this.generateMockAddress(rng),
      to: parameters.to as string,
      amount: parameters.amount as number,
      txHash: this.generateMockTxHash(rng),
      status: "success",
      blockNumber: Math.floor(rng.next() * 1000000),
      gasUsed: Math.floor(rng.next() * 100000),
    };
  }

  private generateAddressResponse(
    parameters: MethodParameters,
    rng: SeededRNG
  ): WalletAddressResponse {
    return {
      address: parameters.address || this.generateMockAddress(rng),
    };
  }

  private calculateMockSwapOutput(
    parameters: MethodParameters,
    rng: SeededRNG
  ): string {
    const inputAmount = parseFloat((parameters.inputAmount as string) || "100");
    // Simulate exchange rate with some randomness
    const exchangeRate = 0.95 + rng.next() * 0.1; // 0.95 to 1.05
    return (inputAmount * exchangeRate).toFixed(6);
  }

  private calculateMockSwapFee(parameters: MethodParameters): string {
    const inputAmount = parseFloat((parameters.inputAmount as string) || "100");
    const feeRate = 0.003; // 0.3% fee
    return (inputAmount * feeRate).toFixed(6);
  }

  private generateMockTxHash(rng: SeededRNG): string {
    return (
      "0x" +
      Array.from({ length: 64 }, () =>
        Math.floor(rng.next() * 16).toString(16)
      ).join("")
    );
  }

  private generateMockAddress(rng: SeededRNG): string {
    return (
      "0x" +
      Array.from({ length: 40 }, () =>
        Math.floor(rng.next() * 16).toString(16)
      ).join("")
    );
  }

  private getMockTokenAddress(token: string, rng: SeededRNG): string {
    const mockAddresses: Record<string, string> = {
      STRK: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
      ETH: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
      DAI: "0x00da114221cb83fa859dbdb4c44beeaa0bb37c7537ad5ae66fe5e0efd20e6eb3",
    };
    return mockAddresses[token] || this.generateMockAddress(rng);
  }

  private generateRandomError(rng: SeededRNG): string {
    const errors = [
      "Contract execution failed",
      "Insufficient gas",
      "Invalid parameters",
      "Contract not found",
      "Unauthorized access",
      "Network timeout",
    ];
    return errors[Math.floor(rng.next() * errors.length)];
  }

  async addLatencySimulation(
    baseResponse: unknown,
    config: LatencyConfig,
    rng: SeededRNG
  ): Promise<unknown> {
    const { baseDelay, variability } = config;
    const variance = ((rng.next() - 0.5) * 2 * variability) / 100;
    const delay = baseDelay * (1 + variance);

    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    return baseResponse;
  }

  injectRealisticErrors(
    response: unknown,
    errorRate: number,
    rng: SeededRNG
  ): unknown {
    if (rng.next() < errorRate) {
      throw new Error(this.generateRandomError(rng));
    }
    return response;
  }
}
