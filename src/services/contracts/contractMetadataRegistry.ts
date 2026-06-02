import { networkConfig, StellarNetworkType } from "../networkConfig";

export type ContractEnvironment = StellarNetworkType | "mainnet";

export interface ContractCapability {
  name: string;
  description: string;
  methods: string[];
}

export interface ContractBinding {
  environment: ContractEnvironment;
  address?: string;
  rpcUrl: string;
  networkPassphrase: string;
  enabled: boolean;
}

export interface ContractMetadata {
  key: string;
  displayName: string;
  version: string;
  sourcePath: string;
  capabilities: ContractCapability[];
  bindings: ContractBinding[];
}

export interface ContractRegistrySnapshot {
  generatedAt: string;
  activeEnvironment: ContractEnvironment;
  contracts: ContractMetadata[];
}

type ContractDefinition = Omit<ContractMetadata, "bindings"> & {
  envAddressKey: string;
};

const DEFAULT_CONTRACTS: ContractDefinition[] = [
  {
    key: "core_vault",
    displayName: "Core Vault",
    version: "1.0.0",
    sourcePath: "contracts/core_vault",
    envAddressKey: "CORE_VAULT_CONTRACT_ID",
    capabilities: [
      {
        name: "vault.custody",
        description: "Custody assets and coordinate vault-level operations.",
        methods: ["initialize", "deposit", "withdraw"],
      },
    ],
  },
  {
    key: "multi_hop_swap",
    displayName: "Multi-hop Swap",
    version: "1.0.0",
    sourcePath: "contracts/multi_hop_swap",
    envAddressKey: "MULTI_HOP_SWAP_CONTRACT_ID",
    capabilities: [
      {
        name: "swap.routing",
        description:
          "Execute single-hop and multi-hop swap paths with slippage controls.",
        methods: ["swap", "quote", "estimate_cost"],
      },
    ],
  },
  {
    key: "strategy_registry",
    displayName: "Strategy Registry",
    version: "1.0.0",
    sourcePath: "contracts/strategy_registry",
    envAddressKey: "STRATEGY_REGISTRY_CONTRACT_ID",
    capabilities: [
      {
        name: "strategy.discovery",
        description: "Register, verify, and resolve AI strategy metadata.",
        methods: ["register_pool", "vote_strategy", "get_verified_pools"],
      },
    ],
  },
  {
    key: "htlc",
    displayName: "HTLC",
    version: "1.0.0",
    sourcePath: "contracts/htlc",
    envAddressKey: "HTLC_CONTRACT_ID",
    capabilities: [
      {
        name: "swap.atomic",
        description: "Coordinate hash-time-locked claims and refunds.",
        methods: ["init_swap", "claim", "refund"],
      },
    ],
  },
  {
    key: "rbac",
    displayName: "RBAC",
    version: "1.0.0",
    sourcePath: "contracts/rbac",
    envAddressKey: "RBAC_CONTRACT_ID",
    capabilities: [
      {
        name: "access.control",
        description: "Gate protocol actions by role and emergency state.",
        methods: ["grant_role", "revoke_role", "has_role"],
      },
    ],
  },
];

export class ContractMetadataRegistry {
  private definitions: ContractDefinition[];

  constructor(definitions: ContractDefinition[] = DEFAULT_CONTRACTS) {
    this.definitions = definitions;
  }

  getSnapshot(
    environment: ContractEnvironment = this.activeEnvironment()
  ): ContractRegistrySnapshot {
    return {
      generatedAt: new Date().toISOString(),
      activeEnvironment: environment,
      contracts: this.definitions.map((definition) =>
        this.bindContract(definition, environment)
      ),
    };
  }

  listContracts(environment?: ContractEnvironment): ContractMetadata[] {
    return this.getSnapshot(environment).contracts;
  }

  getContract(
    key: string,
    environment?: ContractEnvironment
  ): ContractMetadata | undefined {
    return this.listContracts(environment).find(
      (contract) => contract.key === key
    );
  }

  findByCapability(
    capabilityName: string,
    environment?: ContractEnvironment
  ): ContractMetadata[] {
    return this.listContracts(environment).filter((contract) =>
      contract.capabilities.some(
        (capability) => capability.name === capabilityName
      )
    );
  }

  getBinding(
    key: string,
    environment?: ContractEnvironment
  ): ContractBinding | undefined {
    const contract = this.getContract(key, environment);
    return contract?.bindings.find(
      (binding) =>
        binding.environment === (environment ?? this.activeEnvironment())
    );
  }

  private bindContract(
    definition: ContractDefinition,
    environment: ContractEnvironment
  ): ContractMetadata {
    const envPrefix = environment.toUpperCase();
    const scopedKey = `${envPrefix}_${definition.envAddressKey}`;
    const address =
      process.env[scopedKey] || process.env[definition.envAddressKey];

    return {
      key: definition.key,
      displayName: definition.displayName,
      version: definition.version,
      sourcePath: definition.sourcePath,
      capabilities: definition.capabilities,
      bindings: [
        {
          environment,
          address,
          rpcUrl:
            process.env[`${envPrefix}_SOROBAN_RPC_URL`] ||
            networkConfig.rpcUrl,
          networkPassphrase:
            process.env[`${envPrefix}_NETWORK_PASSPHRASE`] ||
            networkConfig.passphrase,
          enabled: Boolean(address),
        },
      ],
    };
  }

  private activeEnvironment(): ContractEnvironment {
    return networkConfig.type === "public" ? "mainnet" : networkConfig.type;
  }
}

export const contractMetadataRegistry = new ContractMetadataRegistry();
