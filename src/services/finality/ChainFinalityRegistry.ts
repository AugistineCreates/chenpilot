import { ChainFinalityAdapter } from "./adapters/ChainFinalityAdapter";
import { BitcoinFinalityAdapter } from "./adapters/BitcoinFinalityAdapter";
import { StellarFinalityAdapter } from "./adapters/StellarFinalityAdapter";
import { OptimisticRollupAdapter } from "./adapters/OptimisticRollupAdapter";
import { ContractSettlementAdapter } from "./adapters/ContractSettlementAdapter";
import { FinalityCategory } from "./types";

/**
 * Registry holding chain finality adapters for all supported networks.
 */
export class ChainFinalityRegistry {
  private static instance: ChainFinalityRegistry | null = null;
  private adapters = new Map<string, ChainFinalityAdapter>();

  constructor() {
    this.registerDefaults();
  }

  static getInstance(): ChainFinalityRegistry {
    if (!this.instance) {
      this.instance = new ChainFinalityRegistry();
    }
    return this.instance;
  }

  static resetInstance(): void {
    this.instance = null;
  }

  private registerDefaults(): void {
    // Bitcoin mainnet & testnet
    this.registerAdapter(new BitcoinFinalityAdapter({ chainId: "bitcoin-mainnet", targetConfirmations: 6 }));
    this.registerAdapter(new BitcoinFinalityAdapter({ chainId: "bitcoin-testnet", targetConfirmations: 3 }));
    this.registerAdapter(new BitcoinFinalityAdapter({ chainId: "bitcoin", targetConfirmations: 6 }));

    // Stellar mainnet & testnet
    this.registerAdapter(new StellarFinalityAdapter({ chainId: "stellar-mainnet", targetConfirmationDepth: 3 }));
    this.registerAdapter(new StellarFinalityAdapter({ chainId: "stellar-testnet", targetConfirmationDepth: 2 }));
    this.registerAdapter(new StellarFinalityAdapter({ chainId: "stellar", targetConfirmationDepth: 3 }));

    // Optimistic rollups
    this.registerAdapter(new OptimisticRollupAdapter({ chainId: "optimism-mainnet" }));
    this.registerAdapter(new OptimisticRollupAdapter({ chainId: "arbitrum-one" }));
    this.registerAdapter(new OptimisticRollupAdapter({ chainId: "optimistic-rollup" }));

    // Application-level contract settlement
    this.registerAdapter(new ContractSettlementAdapter({ chainId: "soroban-smart-contract" }));
    this.registerAdapter(new ContractSettlementAdapter({ chainId: "soroban" }));
    this.registerAdapter(new ContractSettlementAdapter({ chainId: "application-settlement" }));
  }

  registerAdapter(adapter: ChainFinalityAdapter): void {
    this.adapters.set(adapter.chainId.toLowerCase(), adapter);
  }

  getAdapter(chainId: string): ChainFinalityAdapter | undefined {
    return this.adapters.get(chainId.toLowerCase());
  }

  requireAdapter(chainId: string): ChainFinalityAdapter {
    const adapter = this.getAdapter(chainId);
    if (!adapter) {
      throw new Error(`No finality adapter registered for chainId: ${chainId}`);
    }
    return adapter;
  }

  getAdaptersByCategory(category: FinalityCategory): ChainFinalityAdapter[] {
    return Array.from(this.adapters.values()).filter((a) => a.category === category);
  }

  listRegisteredChains(): string[] {
    return Array.from(this.adapters.keys());
  }
}

export const chainFinalityRegistry = ChainFinalityRegistry.getInstance();
