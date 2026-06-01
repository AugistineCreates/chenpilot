/**
 * DeFi Adapters Module
 *
 * This module provides centralized access to DeFi protocol adapters
 * for the Stellar ecosystem.
 *
 * Supported Protocols:
 * - Equilibre: DEX with swap and liquidity capabilities
 * - YieldBlox: Lending protocol with lending and borrowing capabilities
 */

export {
  DeFiAdapter,
  DeFiAdapterFactory,
  DeFiAdapterConfig,
  AdapterCapabilities,
  AdapterResult,
  QuoteResult,
  PositionResult,
  TransactionRequest,
} from "./DeFiAdapter";

export { EquilibreAdapter, equilibreAdapter } from "./EquilibreAdapter";
export { YieldBloxAdapter, yieldBloxAdapter } from "./YieldBloxAdapter";

// Re-export configuration utilities
export {
  generateDeFiAdapterConfigs,
  getAdapterConfig,
  getEnabledAdapters,
  getAdaptersByCapability,
  getContractAddress,
  DeFiProtocol,
  DEFAULT_CAPABILITIES,
} from "../../../config/defiAdapters";
