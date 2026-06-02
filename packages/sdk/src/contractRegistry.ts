import { ContractCapability, ContractVersionMetadata, ContractCompatibilityMetadata } from './types';
import { SorobanNetwork } from '../soroban';

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
 * Simple in-memory registry for contract compatibility metadata.
 * Initialized with static core contracts; can be extended at runtime.
 */
export class ContractCompatibilityRegistry {
  /** Map of contract name -> compatibility metadata */
  private static registry: Map<string, ContractCompatibilityMetadata> = new Map();

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
    for (const [name, meta] of Object.entries(coreContracts)) {
      this.registry.set(name, meta);
    }
  }

  /** Register or update a contract version dynamically. */
  static registerContractVersion(
    contractName: string,
    metadata: ContractVersionMetadata,
    contractId: string,
    network: SorobanNetwork
  ) {
    const existing = this.registry.get(contractName);
    const versionMeta: ContractCompatibilityMetadata = {
      contractId,
      versions: existing?.versions ? [...existing.versions, metadata] : [metadata],
    };
    this.registry.set(contractName, versionMeta);
  }

  /** Retrieve deployment information for a contract. */
  static getContractDeployment(
    contractNameOrId: string,
    network: SorobanNetwork,
    version?: string
  ): ContractCompatibilityMetadata | undefined {
    // Simple lookup – ignoring network for static seed.
    const meta = this.registry.get(contractNameOrId);
    if (!meta) return undefined;
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
}

// Seed core contracts on module load.
ContractCompatibilityRegistry.seedCoreContracts();
