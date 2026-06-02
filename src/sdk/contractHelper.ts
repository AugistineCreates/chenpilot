// src/sdk/contractHelper.ts
/**
 * Helper functions for backend and SDK layers to work with the contract registry.
 * Provides capability checks and resolves the latest compatible contract address.
 */
import { ContractRegistry } from '../Contracts/registry/registry';

// Singleton instance (registry loads from JSON on import)
const registry = new ContractRegistry();

/**
 * Retrieve the address of the latest contract version that satisfies the required capabilities.
 * @param name Human readable contract name (e.g., "CoreEngine")
 * @param requiredCapabilities Optional list of capability flags that must be present
 * @returns Deployed contract address
 * @throws if no contract or missing capabilities
 */
export function getContractAddress(name: string, requiredCapabilities?: string[]): string {
  const meta = registry.getLatest(name);
  if (!meta) {
    throw new Error(`No deployed contract found for ${name}`);
  }
  if (requiredCapabilities && requiredCapabilities.length) {
    const missing = requiredCapabilities.filter(cap => !(meta.capabilities ?? []).includes(cap));
    if (missing.length) {
      throw new Error(`Contract ${name}@${meta.version} lacks required capabilities: ${missing.join(', ')}`);
    }
  }
  return meta.address;
}

/**
 * Get full metadata for a contract name and optional version.
 */
export function getContractMetadata(name: string, version?: string) {
  if (version) {
    const meta = registry.getVersion(name, version);
    if (!meta) throw new Error(`Contract ${name} version ${version} not found`);
    return meta;
  }
  const meta = registry.getLatest(name);
  if (!meta) throw new Error(`No deployed contract found for ${name}`);
  return meta;
}
