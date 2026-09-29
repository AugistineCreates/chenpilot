/**
 * Stellar Quorum Reader
 *
 * Wraps Horizon and Soroban RPC providers to perform quorum reads
 * for security-critical chain state: balances, sequence numbers,
 * contract state, and transaction status.
 *
 * Uses the QuorumReadService to ensure consensus across providers
 * before accepting any security-critical response.
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import {
  QuorumReadService,
  DEFAULT_QUORUM_CONFIG,
} from "./quorumRead.service";
import {
  ProviderConfig,
  QuorumReadConfig,
  ProviderResponse,
  ChainStateCategory,
  QuorumReadResult,
} from "./quorumRead.types";
import logger from "../config/logger";

/** Default Horizon providers for testnet */
const DEFAULT_HORIZON_PROVIDERS: ProviderConfig[] = [
  {
    id: "horizon-sdf",
    url: "https://horizon-testnet.stellar.org",
    type: "horizon",
    independent: true,
    maxLatencyMs: 5000,
  },
  {
    id: "horizon-steexp",
    url: "https://horizon-testnet.steexp.com",
    type: "horizon",
    independent: true,
    maxLatencyMs: 5000,
  },
];

/** Default Soroban RPC providers for testnet */
const DEFAULT_SOROBAN_PROVIDERS: ProviderConfig[] = [
  {
    id: "soroban-sdf",
    url: "https://soroban-testnet.stellar.org",
    type: "soroban_rpc",
    independent: true,
    maxLatencyMs: 5000,
  },
];

export interface StellarQuorumReaderConfig {
  /** Horizon provider URLs (if not provided, uses defaults) */
  horizonProviders?: string[];
  /** Soroban RPC provider URLs (if not provided, uses defaults) */
  sorobanProviders?: string[];
  /** Quorum configuration overrides */
  quorumConfig?: Partial<QuorumReadConfig>;
}

export class StellarQuorumReader {
  private horizonQuorum: QuorumReadService;
  private sorobanQuorum: QuorumReadService;
  private horizonServers: Map<string, StellarSdk.Horizon.Server>;
  private sorobanServers: Map<string, StellarSdk.SorobanRpc.Server>;

  constructor(config: StellarQuorumReaderConfig = {}) {
    // Build provider configs
    const horizonProviders = config.horizonProviders
      ? config.horizonProviders.map((url, i) => ({
          id: `horizon-${i}`,
          url,
          type: "horizon" as const,
          independent: true,
        }))
      : DEFAULT_HORIZON_PROVIDERS;

    const sorobanProviders = config.sorobanProviders
      ? config.sorobanProviders.map((url, i) => ({
          id: `soroban-${i}`,
          url,
          type: "soroban_rpc" as const,
          independent: true,
        }))
      : DEFAULT_SOROBAN_PROVIDERS;

    const quorumConfig = {
      ...DEFAULT_QUORUM_CONFIG,
      ...config.quorumConfig,
    };

    // Ensure we have enough providers for quorum
    if (horizonProviders.length < quorumConfig.minQuorumSize) {
      logger.warn(
        `Only ${horizonProviders.length} Horizon providers configured, but minQuorumSize is ${quorumConfig.minQuorumSize}. Quorum reads may fail.`
      );
    }

    this.horizonQuorum = new QuorumReadService(
      horizonProviders,
      quorumConfig
    );
    this.sorobanQuorum = new QuorumReadService(
      sorobanProviders,
      quorumConfig
    );

    // Create SDK server instances
    this.horizonServers = new Map();
    for (const provider of horizonProviders) {
      this.horizonServers.set(
        provider.id,
        new StellarSdk.Horizon.Server(provider.url)
      );
    }

    this.sorobanServers = new Map();
    for (const provider of sorobanProviders) {
      this.sorobanServers.set(
        provider.id,
        new StellarSdk.SorobanRpc.Server(provider.url)
      );
    }
  }

  /**
   * Read account balances with quorum consensus.
   */
  async readBalances(
    accountId: string
  ): Promise<
    QuorumReadResult<StellarSdk.Horizon.HorizonApi.AccountResponse>
  > {
    return this.horizonQuorum.readQuorum(
      async (provider) => {
        const server = this.horizonServers.get(provider.id);
        if (!server) {
          throw new Error(`No Horizon server for provider ${provider.id}`);
        }

        const startTime = Date.now();
        const account = await server.loadAccount(accountId);

        return {
          providerId: provider.id,
          value: account as unknown as StellarSdk.Horizon.HorizonApi.AccountResponse,
          timestamp: Date.now(),
          latencyMs: Date.now() - startTime,
        };
      },
      "balance",
      { accountId }
    );
  }

  /**
   * Read sequence number with quorum consensus.
   */
  async readSequenceNumber(
    accountId: string
  ): Promise<QuorumReadResult<string>> {
    return this.horizonQuorum.readQuorum(
      async (provider) => {
        const server = this.horizonServers.get(provider.id);
        if (!server) {
          throw new Error(`No Horizon server for provider ${provider.id}`);
        }

        const startTime = Date.now();
        const account = await server.loadAccount(accountId);

        return {
          providerId: provider.id,
          value: account.sequenceNumber(),
          timestamp: Date.now(),
          latencyMs: Date.now() - startTime,
        };
      },
      "sequence_number",
      { accountId }
    );
  }

  /**
   * Read contract state with quorum consensus.
   */
  async readContractState(
    contractId: string,
    method: string,
    ...args: unknown[]
  ): Promise<QuorumReadResult<unknown>> {
    return this.sorobanQuorum.readQuorum(
      async (provider) => {
        const server = this.sorobanServers.get(provider.id);
        if (!server) {
          throw new Error(`No Soroban server for provider ${provider.id}`);
        }

        const startTime = Date.now();

        // Build contract invocation transaction for simulation
        const sourceAccount = await server.getAccount(
          "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
        );
        const contract = new StellarSdk.Contract(contractId);
        const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
          fee: "100",
          networkPassphrase:
            StellarSdk.Networks.TESTNET,
        })
          .addOperation(contract.call(method, ...args))
          .setTimeout(30)
          .build();

        const simulation = await server.simulateTransaction(tx);

        return {
          providerId: provider.id,
          value: simulation,
          timestamp: Date.now(),
          latencyMs: Date.now() - startTime,
        };
      },
      "contract_state",
      { contractId, method }
    );
  }

  /**
   * Read transaction status with quorum consensus.
   */
  async readTransactionStatus(
    transactionHash: string
  ): Promise<QuorumReadResult<unknown>> {
    return this.sorobanQuorum.readQuorum(
      async (provider) => {
        const server = this.sorobanServers.get(provider.id);
        if (!server) {
          throw new Error(`No Soroban server for provider ${provider.id}`);
        }

        const startTime = Date.now();
        const result = await server.getTransaction(transactionHash);

        return {
          providerId: provider.id,
          value: result,
          timestamp: Date.now(),
          latencyMs: Date.now() - startTime,
        };
      },
      "transaction_status",
      { transactionHash }
    );
  }

  /**
   * Get health status of all providers.
   */
  getHealthStatus(): {
    horizon: ReturnType<
      InstanceType<typeof import("./providerHealth.service").ProviderHealthService>["getHealthSummary"]
    >;
    soroban: ReturnType<
      InstanceType<typeof import("./providerHealth.service").ProviderHealthService>["getHealthSummary"]
    >;
  } {
    return {
      horizon: this.horizonQuorum.getHealthService().getHealthSummary(),
      soroban: this.sorobanQuorum.getHealthService().getHealthSummary(),
    };
  }
}

/** Singleton instance */
let instance: StellarQuorumReader | null = null;

export function getStellarQuorumReader(
  config?: StellarQuorumReaderConfig
): StellarQuorumReader {
  if (!instance) {
    instance = new StellarQuorumReader(config);
  }
  return instance;
}

export function resetStellarQuorumReader(): void {
  instance = null;
}
