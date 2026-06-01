import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import {
  invokeContract,
  InvokeContractParams,
  SorobanNetwork,
} from "../../services/sorobanService";
import logger from "../../config/logger";

/**
 * Payload for querying Soroban contract state
 */
interface ContractStatePayload extends Record<string, unknown> {
  network?: SorobanNetwork;
  rpcUrl?: string;
  contractId: string;
  stateKeys?: string[];
  methods?: string[];
  includeMetadata?: boolean;
}

/**
 * Result from contract state query
 */
interface ContractStateResult {
  contractId: string;
  network: SorobanNetwork;
  timestamp: string;
  state: Record<string, unknown>;
  metadata?: {
    contractType?: string;
    version?: string;
    admin?: string;
  };
  methods?: Record<string, unknown>;
}

/**
 * Common DeFi contract state queries
 */
const DEFI_STATE_QUERIES = {
  // Liquidity Pool queries
  pool: {
    reserves: "get_reserves",
    totalSupply: "total_supply",
    price: "get_price",
    fee: "get_fee",
  },
  // Lending protocol queries
  lending: {
    totalSupply: "total_supply",
    totalBorrow: "total_borrow",
    utilizationRate: "utilization_rate",
    interestRate: "interest_rate",
    collateralFactor: "collateral_factor",
  },
  // Token queries
  token: {
    totalSupply: "total_supply",
    balance: "balance",
    allowance: "allowance",
    decimals: "decimals",
    name: "name",
    symbol: "symbol",
  },
  // Staking queries
  staking: {
    totalStaked: "total_staked",
    rewardRate: "reward_rate",
    stakingBalance: "staking_balance",
    pendingRewards: "pending_rewards",
  },
};

/**
 * Tool for querying Soroban smart contract state
 * Designed for DeFi decision making by agents
 */
export class SorobanContractStateTool extends BaseTool<ContractStatePayload> {
  metadata: ToolMetadata = {
    name: "soroban_contract_state",
    description:
      "Query the state of a Soroban smart contract for DeFi decision making. Supports querying reserves, balances, rates, and other contract state.",
    parameters: {
      network: {
        type: "string",
        description: "Soroban network to query",
        required: false,
        enum: ["testnet", "mainnet"],
      },
      rpcUrl: {
        type: "string",
        description: "Override Soroban RPC URL",
        required: false,
      },
      contractId: {
        type: "string",
        description: "Soroban contract ID (starts with C...)",
        required: true,
      },
      stateKeys: {
        type: "array",
        description: "Specific state keys to query (e.g., ['reserves', 'fee'])",
        required: false,
      },
      methods: {
        type: "array",
        description:
          "Contract methods to call for state (e.g., ['get_reserves', 'total_supply'])",
        required: false,
      },
      includeMetadata: {
        type: "boolean",
        description: "Include contract metadata (admin, version, etc.)",
        required: false,
      },
    },
    examples: [
      "Query reserves and fee from liquidity pool contract CABC...",
      "Get total supply and borrow rate from lending contract CXYZ... on mainnet",
      "Check staking balance and pending rewards for contract CDEF...",
      "Query all token information (name, symbol, decimals, total supply) from CTOKEN...",
    ],
    category: "soroban",
    version: "1.0.0",
    riskLevel: "low",
    capabilities: ["soroban_state_query"],
    permissions: [],
  };

  async execute(
    payload: ContractStatePayload,
    userId: string
  ): Promise<ToolResult> {
    try {
      logger.info("Querying Soroban contract state", {
        contractId: payload.contractId,
        network: payload.network || "testnet",
        userId,
      });

      const network = payload.network || "testnet";
      const state: Record<string, unknown> = {};
      const methods: Record<string, unknown> = {};

      // Query specified methods
      if (payload.methods && Array.isArray(payload.methods)) {
        for (const method of payload.methods) {
          try {
            const result = await this.queryContractMethod(
              payload.contractId,
              method,
              network,
              payload.rpcUrl
            );
            methods[method] = result;
            state[method] = result;
          } catch (error) {
            logger.warn(`Failed to query method ${method}`, {
              contractId: payload.contractId,
              error,
            });
            methods[method] = {
              error: error instanceof Error ? error.message : "Query failed",
            };
          }
        }
      }

      // Query specified state keys using common patterns
      if (payload.stateKeys && Array.isArray(payload.stateKeys)) {
        for (const key of payload.stateKeys) {
          const method = this.mapStateKeyToMethod(key);
          if (method && !methods[method]) {
            try {
              const result = await this.queryContractMethod(
                payload.contractId,
                method,
                network,
                payload.rpcUrl
              );
              state[key] = result;
            } catch (error) {
              logger.warn(`Failed to query state key ${key}`, {
                contractId: payload.contractId,
                error,
              });
              state[key] = {
                error: error instanceof Error ? error.message : "Query failed",
              };
            }
          }
        }
      }

      // If no specific queries, try common DeFi queries
      if (
        (!payload.methods || payload.methods.length === 0) &&
        (!payload.stateKeys || payload.stateKeys.length === 0)
      ) {
        await this.queryCommonDeFiState(
          payload.contractId,
          network,
          state,
          payload.rpcUrl
        );
      }

      // Query metadata if requested
      let metadata: ContractStateResult["metadata"] | undefined;
      if (payload.includeMetadata) {
        metadata = await this.queryContractMetadata(
          payload.contractId,
          network,
          payload.rpcUrl
        );
      }

      const result: ContractStateResult = {
        contractId: payload.contractId,
        network,
        timestamp: new Date().toISOString(),
        state,
        metadata,
        methods: Object.keys(methods).length > 0 ? methods : undefined,
      };

      logger.info("Contract state query successful", {
        contractId: payload.contractId,
        stateKeys: Object.keys(state),
        userId,
      });

      return this.createSuccessResult("soroban_contract_state", {
        ...result,
      });
    } catch (error) {
      logger.error("Contract state query failed", {
        contractId: payload.contractId,
        error,
        userId,
      });

      return this.createErrorResult(
        "soroban_contract_state",
        `Failed to query contract state: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        { contractId: payload.contractId, network: payload.network }
      );
    }
  }

  /**
   * Query a single contract method
   */
  private async queryContractMethod(
    contractId: string,
    method: string,
    network: SorobanNetwork,
    rpcUrl?: string,
    args?: unknown[]
  ): Promise<unknown> {
    const params: InvokeContractParams = {
      network,
      rpcUrl,
      contractId,
      method,
      args: args || [],
    };

    const result = await invokeContract(params);
    return result.result;
  }

  /**
   * Map state key to common contract method name
   */
  private mapStateKeyToMethod(stateKey: string): string | null {
    const mapping: Record<string, string> = {
      reserves: "get_reserves",
      totalSupply: "total_supply",
      totalBorrow: "total_borrow",
      price: "get_price",
      fee: "get_fee",
      balance: "balance",
      allowance: "allowance",
      decimals: "decimals",
      name: "name",
      symbol: "symbol",
      utilizationRate: "utilization_rate",
      interestRate: "interest_rate",
      collateralFactor: "collateral_factor",
      totalStaked: "total_staked",
      rewardRate: "reward_rate",
      stakingBalance: "staking_balance",
      pendingRewards: "pending_rewards",
      admin: "admin",
      version: "version",
    };

    return mapping[stateKey] || stateKey;
  }

  /**
   * Query common DeFi contract state
   * Tries common methods and returns what's available
   */
  private async queryCommonDeFiState(
    contractId: string,
    network: SorobanNetwork,
    state: Record<string, unknown>,
    rpcUrl?: string
  ): Promise<void> {
    const commonMethods = [
      // Token methods
      "total_supply",
      "decimals",
      "name",
      "symbol",
      // Pool methods
      "get_reserves",
      "get_price",
      "get_fee",
      // Lending methods
      "total_borrow",
      "utilization_rate",
      "interest_rate",
      // Staking methods
      "total_staked",
      "reward_rate",
    ];

    const results = await Promise.allSettled(
      commonMethods.map((method) =>
        this.queryContractMethod(contractId, method, network, rpcUrl)
      )
    );

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        state[commonMethods[index]] = result.value;
      }
    });
  }

  /**
   * Query contract metadata
   */
  private async queryContractMetadata(
    contractId: string,
    network: SorobanNetwork,
    rpcUrl?: string
  ): Promise<ContractStateResult["metadata"]> {
    const metadata: ContractStateResult["metadata"] = {};

    try {
      const admin = await this.queryContractMethod(
        contractId,
        "admin",
        network,
        rpcUrl
      );
      metadata.admin = String(admin);
    } catch {
      // Admin method not available
    }

    try {
      const version = await this.queryContractMethod(
        contractId,
        "version",
        network,
        rpcUrl
      );
      metadata.version = String(version);
    } catch {
      // Version method not available
    }

    return metadata;
  }

  /**
   * Helper method to query specific DeFi protocol state
   */
  async queryDeFiProtocol(
    contractId: string,
    protocolType: "pool" | "lending" | "token" | "staking",
    network: SorobanNetwork = "testnet",
    rpcUrl?: string
  ): Promise<Record<string, unknown>> {
    const queries = DEFI_STATE_QUERIES[protocolType];
    const state: Record<string, unknown> = {};

    for (const [key, method] of Object.entries(queries)) {
      try {
        const result = await this.queryContractMethod(
          contractId,
          method,
          network,
          rpcUrl
        );
        state[key] = result;
      } catch (error) {
        logger.warn(`Failed to query ${key} for ${protocolType}`, {
          contractId,
          error,
        });
      }
    }

    return state;
  }
}

export const sorobanContractStateTool = new SorobanContractStateTool();
