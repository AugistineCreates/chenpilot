import { SimulationConfig, GasEstimate, GasMetrics } from "./types";
import logger from "../config/logger";

interface BlockchainOperation {
  service: string;
  operation: string;
  parameters: Record<string, unknown>;
}

export class GasSimulator {
  private config!: SimulationConfig;
  private userGasTracking: Map<string, GasMetrics> = new Map();

  async initialize(config: SimulationConfig): Promise<void> {
    this.config = config;
    logger.info("Gas simulator initialized");
  }

  async estimateGas(operation: BlockchainOperation): Promise<GasEstimate> {
    const baseGas = this.calculateBaseGas(operation);
    const gasPrice = this.getSimulatedGasPrice(operation.service);

    const estimate: GasEstimate = {
      estimatedGas: Math.floor(baseGas * this.config.simulation.gasMultiplier),
      maxGas: Math.floor(baseGas * this.config.simulation.gasMultiplier * 1.5),
      gasPrice,
      totalCost: this.calculateTotalCost(baseGas, gasPrice),
    };

    logger.debug("Gas estimated", { operation: operation.operation, estimate });
    return estimate;
  }

  trackGasUsage(
    userId: string,
    operation: BlockchainOperation,
    gasUsed: number
  ): void {
    const existing = this.userGasTracking.get(userId) || {
      totalOperations: 0,
      totalGasUsed: 0,
      averageGasPerOperation: 0,
      simulatedCostSaved: "0",
    };

    const updated: GasMetrics = {
      totalOperations: existing.totalOperations + 1,
      totalGasUsed: existing.totalGasUsed + gasUsed,
      averageGasPerOperation:
        (existing.totalGasUsed + gasUsed) / (existing.totalOperations + 1),
      simulatedCostSaved: this.calculateCostSaved(
        existing.totalGasUsed + gasUsed,
        operation.service
      ),
    };

    this.userGasTracking.set(userId, updated);
    logger.debug("Gas usage tracked", {
      userId,
      gasUsed,
      totalGas: updated.totalGasUsed,
    });
  }

  async getUserGasMetrics(userId: string): Promise<GasMetrics> {
    return (
      this.userGasTracking.get(userId) || {
        totalOperations: 0,
        totalGasUsed: 0,
        averageGasPerOperation: 0,
        simulatedCostSaved: "0",
      }
    );
  }

  async resetGasTracking(userId?: string): Promise<void> {
    if (userId) {
      this.userGasTracking.delete(userId);
      logger.info("Gas tracking reset for user", { userId });
    } else {
      this.userGasTracking.clear();
      logger.info("All gas tracking reset");
    }
  }

  private calculateBaseGas(operation: BlockchainOperation): number {
    const { service, operation: op, parameters } = operation;

    // Base gas costs by service and operation type
    const gasTable: Record<string, Record<string, number>> = {
      soroban: {
        invoke_contract: 100000,
        deploy_contract: 500000,
        get_contract_data: 50000,
        default: 75000,
      },
      wallet: {
        transfer: 80000,
        get_balance: 30000,
        get_address: 10000,
        default: 50000,
      },
      swap: {
        swap: 150000,
        add_liquidity: 200000,
        remove_liquidity: 120000,
        get_price: 40000,
        default: 100000,
      },
    };

    const serviceGas = gasTable[service] || gasTable.wallet;
    let baseGas = serviceGas[op] || serviceGas.default;

    // Adjust gas based on parameters complexity
    if (parameters) {
      const paramCount = Object.keys(parameters).length;
      const complexityMultiplier = 1 + paramCount * 0.1;
      baseGas = Math.floor(baseGas * complexityMultiplier);

      // Special adjustments for specific parameter types
      if (parameters.args && Array.isArray(parameters.args)) {
        baseGas += parameters.args.length * 5000;
      }

      if (parameters.amount) {
        const amount = parseFloat(parameters.amount.toString());
        if (amount > 1000) {
          baseGas += Math.floor(amount / 1000) * 1000; // Higher amounts cost more gas
        }
      }
    }

    // Add some randomness to make it more realistic
    const variance = 0.1; // 10% variance
    const randomFactor = 1 + (Math.random() - 0.5) * 2 * variance;

    return Math.floor(baseGas * randomFactor);
  }

  private getSimulatedGasPrice(service: string): number {
    // Simulated gas prices in wei (for Ethereum-like chains) or stroops (for Stellar)
    const gasPrices: Record<string, number> = {
      soroban: 100, // stroops
      wallet: 20000000000, // 20 gwei
      swap: 25000000000, // 25 gwei
      default: 20000000000,
    };

    const basePrice = gasPrices[service] || gasPrices.default;

    // Add some market volatility simulation
    const volatility = 0.2; // 20% volatility
    const marketFactor = 1 + (Math.random() - 0.5) * 2 * volatility;

    return Math.floor(basePrice * marketFactor);
  }

  private calculateTotalCost(gasAmount: number, gasPrice: number): string {
    const totalWei = gasAmount * gasPrice;
    const totalEth = totalWei / 1e18;
    return totalEth.toFixed(8);
  }

  private calculateCostSaved(totalGasUsed: number, service: string): string {
    const gasPrice = this.getSimulatedGasPrice(service);
    const totalCost = this.calculateTotalCost(totalGasUsed, gasPrice);

    // Estimate USD value (mock exchange rate)
    const mockEthToUsd = 2000; // $2000 per ETH
    const usdValue = parseFloat(totalCost) * mockEthToUsd;

    return `$${usdValue.toFixed(2)} (${totalCost} ETH)`;
  }

  // Get aggregated metrics across all users
  getGlobalMetrics(): {
    totalUsers: number;
    totalOperations: number;
    totalGasUsed: number;
    totalCostSaved: string;
  } {
    let totalOperations = 0;
    let totalGasUsed = 0;

    for (const metrics of this.userGasTracking.values()) {
      totalOperations += metrics.totalOperations;
      totalGasUsed += metrics.totalGasUsed;
    }

    const totalCostSaved = this.calculateCostSaved(totalGasUsed, "wallet");

    return {
      totalUsers: this.userGasTracking.size,
      totalOperations,
      totalGasUsed,
      totalCostSaved,
    };
  }
}
