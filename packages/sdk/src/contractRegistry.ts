import { ContractCapability, ContractVersionMetadata, ContractCompatibilityMetadata } from './types';
import { SorobanNetwork } from './types';

/**
 * Error thrown when a contract invocation is incompatible with registered metadata.
 */
export class ContractCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractCompatibilityError';
  }
}

/**
 * Network-scoped, in-memory registry for contract compatibility metadata.
 *
 * All entries are keyed by `network:contractName`, so a contract that is only
 * deployed on testnet can never satisfy a mainnet lookup — and vice versa.
 * Initialized with static core contracts; can be extended at runtime.
 */
export class ContractCompatibilityRegistry {
  /** Map of `network:contractName` -> compatibility metadata */
  private static registry: Map<string, ContractCompatibilityMetadata> = new Map();

  private static scopeKey(network: SorobanNetwork, contractName: string): string {
    return `${network}:${contractName}`;
  }

  /**
   * Seed the registry with core contracts (offline mode).
   * This method is called once at module load.
   */
  static seedCoreContracts() {
    // Example static contracts – replace with real data as needed.
    const coreContracts: Record<string, ContractCompatibilityMetadata> = {
      core_vault: {
        contractId: 'CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        versions: [
          {
            version: '1.0.0',
            capabilities: ['deposit', 'withdraw'],
          },
        ],
      },
      btc_relay: {
        contractId: 'CYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
        versions: [
          {
            version: '1.2.3',
            capabilities: ['lock', 'release'],
          },
        ],
      },
    };
    for (const network of ['testnet', 'mainnet'] as SorobanNetwork[]) {
      for (const [name, meta] of Object.entries(coreContracts)) {
        this.registry.set(this.scopeKey(network, name), meta);
      }
    }
  }

  /** Register or update a contract version dynamically. */
  static registerContractVersion(
    contractName: string,
    metadata: ContractVersionMetadata,
    contractId: string,
    network: SorobanNetwork
  ) {
    const key = this.scopeKey(network, contractName);
    const existing = this.registry.get(key);
    const versionMeta: ContractCompatibilityMetadata = {
      contractId,
      versions: existing?.versions ? [...existing.versions, metadata] : [metadata],
    };
    this.registry.set(key, versionMeta);
  }

  /** Retrieve deployment information for a contract on a specific network. */
  static getContractDeployment(
    contractNameOrId: string,
    network: SorobanNetwork,
    version?: string
  ): ContractCompatibilityMetadata | undefined {
    const meta = this.registry.get(this.scopeKey(network, contractNameOrId));
    if (!meta) {
      // Also allow lookups by raw contract id — but ONLY within the requested
      // network's scope so a mainnet-only ID can never satisfy a testnet lookup.
      const prefix = `${network}:`;
      const byId = [...this.registry.entries()].find(
        ([key, m]) => key.startsWith(prefix) && m.contractId === contractNameOrId
      );
      if (!byId) return undefined;
      const match = byId[1];
      if (version) {
        const ver = match.versions.find((v) => v.version === version);
        return ver ? { ...match, versions: [ver] } : undefined;
      }
      return { ...match, versions: [...match.versions] };
    }
    if (version) {
      const ver = meta.versions.find((v) => v.version === version);
      return ver ? { ...meta, versions: [ver] } : undefined;
    }
    return meta;
  }

  /** Validate a contract invocation against registered capabilities. */
  static validateInvocation(
    contractNameOrId: string,
    network: SorobanNetwork,
    method: string,
    options?: { requiredCapabilities?: ContractCapability[] }
  ) {
    const meta = this.getContractDeployment(contractNameOrId, network);
    if (!meta) {
      throw new ContractCompatibilityError(`Contract ${contractNameOrId} not registered for ${network}`);
    }
    // Find a version that supports the method (capability).
    const caps = options?.requiredCapabilities;
    if (caps && caps.length > 0) {
      const matchingVersion = meta.versions.find((v) =>
        caps.every((c) => v.capabilities.includes(c))
      );
      if (!matchingVersion) {
        throw new ContractCompatibilityError(
          `Contract ${contractNameOrId} does not support required capabilities: ${caps.join(', ')}`
        );
      }
    }
    // Basic method check – assume method name is a capability.
    const supports = meta.versions.some((v) => v.capabilities.includes(method));
    if (!supports) {
      throw new ContractCompatibilityError(
        `Method ${method} is not supported by any registered version of contract ${contractNameOrId}`
      );
    }
  }

  /** Networks that currently hold at least one registered contract. */
  static registeredNetworks(): SorobanNetwork[] {
    const networks = new Set<SorobanNetwork>();
    for (const key of this.registry.keys()) {
      const network = key.split(':')[0];
      if (network === 'testnet' || network === 'mainnet') {
        networks.add(network);
      }
    }
    return [...networks];
  }

  /** Remove all entries scoped to the given network. */
  static clearNetwork(network: SorobanNetwork): void {
    for (const key of this.registry.keys()) {
      if (key.startsWith(`${network}:`)) {
        this.registry.delete(key);
      }
    }
  }

  /** Number of registered entries across all networks. */
  static get size(): number {
    return this.registry.size;
  }
}

// Seed core contracts on module load.
ContractCompatibilityRegistry.seedCoreContracts();
