import { SimulationEngine } from "./SimulationEngine";
import { SimulationConfig } from "./types";

export function createDeterministicSimulationConfig(
  overrides: Partial<SimulationConfig> = {}
): SimulationConfig {
  return {
    mode: "local",
    enabledServices: ["soroban", "wallet", "swap"],
    deterministicSeed: 42,
    stellar: {
      networkPassphrase: "Test SDF Network ; September 2015",
      defaultAccounts: [
        {
          userId: "integration-user-1",
          address: "GLOCALACCOUNT0000000000000000000000000000000000000000001",
          publicKey: "GLOCALACCOUNT0000000000000000000000000000000000000000001",
          privateKey: "SLOCALACCOUNT0000000000000000000000000000000000000000001",
          initialBalances: { XLM: "1000", USDC: "250" },
        },
      ],
      initialBalances: { XLM: "1000", USDC: "250" },
    },
    starknet: {
      chainId: "SN_LOCAL_DETERMINISTIC",
      defaultAccounts: [
        {
          userId: "integration-user-1",
          address: "0xlocal000000000000000000000000000000000000001",
          publicKey: "0xlocalpub00000000000000000000000000000000001",
          privateKey: "0xlocalpriv000000000000000000000000000000001",
          initialBalances: { STRK: "10000", ETH: "10" },
        },
      ],
      initialBalances: { STRK: "10000", ETH: "10" },
    },
    simulation: {
      latency: { baseDelay: 0, variability: 0, networkCondition: "fast" },
      errorRate: 0,
      gasMultiplier: 1,
      persistState: false,
      snapshotInterval: 0,
    },
    ...overrides,
  };
}

export class LocalChainManager {
  private engine: SimulationEngine | null = null;
  private enabled = false;

  async initialize(config = createDeterministicSimulationConfig()): Promise<void> {
    this.engine = new SimulationEngine();
    await this.engine.initialize(config);
    this.enabled = config.mode === "local" || config.mode === "hybrid";
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  getMetrics(): Record<string, unknown> {
    return this.engine?.getMetrics() || { initialized: false };
  }

  getSimulationEngine(): SimulationEngine {
    if (!this.engine) {
      throw new Error("LocalChainManager has not been initialized");
    }

    return this.engine;
  }
}
