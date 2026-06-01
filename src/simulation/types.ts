export type SimulationMode = "local" | "live" | "hybrid";

export interface SimulationConfig {
  mode: SimulationMode;
  enabledServices: string[];

  stellar: {
    networkPassphrase: string;
    defaultAccounts: SimulatedAccount[];
    initialBalances: Record<string, string>;
  };

  starknet: {
    chainId: string;
    defaultAccounts: SimulatedAccount[];
    initialBalances: Record<string, string>;
  };

  simulation: {
    latency: LatencyConfig;
    errorRate: number;
    gasMultiplier: number;
    persistState: boolean;
    snapshotInterval: number;
  };
}

export interface StellarTrustline {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  limit: string;
  buying_liabilities: string;
  selling_liabilities: string;
}

export interface SimulatedAccount {
  userId: string;
  address: string;
  privateKey: string;
  publicKey: string;
  initialBalances: Record<string, string>;
}

export interface LatencyConfig {
  baseDelay: number; // milliseconds
  variability: number; // percentage
  networkCondition: "fast" | "normal" | "slow";
}

export interface AccountState {
  address: string;
  balances: Record<string, string>; // token -> amount
  sequence: number;
  trustlines?: StellarTrustline[];
  lastModified: number;
}

export interface ContractState {
  contractId: string;
  code: string;
  storage: Record<string, unknown>;
  lastInvoked: number;
}

export interface SimulationRequest {
  service: "soroban" | "wallet" | "swap";
  operation: string;
  parameters: Record<string, unknown>;
  userId: string;
  timestamp: number;
  seed?: number; // Optional seed for deterministic simulation
  failureInjections?: FailureInjection[]; // Optional failure injections
}

export interface FailureInjection {
  type: "latency" | "error" | "state_corruption";
  probability?: number; // 0-1
  errorCode?: string;
  delayMs?: number;
}

export interface SimulationResponse {
  success: boolean;
  data: unknown;
  metadata: {
    simulatedGas: number;
    processingTime: number;
    stateChanges: StateChange[];
  };
}

export interface StateChange {
  type: "account" | "contract";
  id: string;
  changes: Record<string, unknown>;
}

export interface GasEstimate {
  estimatedGas: number;
  maxGas: number;
  gasPrice: number;
  totalCost: string; // simulated cost in native token
}

export interface GasMetrics {
  totalOperations: number;
  totalGasUsed: number;
  averageGasPerOperation: number;
  simulatedCostSaved: string;
}
