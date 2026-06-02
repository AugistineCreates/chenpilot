// src/contracts/registry/registry.ts
/**
 * Contract Registry Types
 */
export interface ContractMetadata {
  /** Human readable name, e.g., "CoreEngine" */
  name: string;
  /** Deployed address */
  address: string;
  /** Semantic version string, e.g. "1.0.0" */
  version: string;
  /** Optional list of capability flags the contract implements */
  capabilities?: string[];
  /** Timestamp of deployment */
  deployedAt: string;
}

/**
 * In‑memory registry loaded from a JSON file.
 * The JSON file lives at `src/contracts/registry/registry.json` and is
 * updated by the deployment script.
 */
export class ContractRegistry {
  private entries: ContractMetadata[] = [];

  constructor(private readonly dataFile: string = require.resolve('./registry.json')) {
    this.load();
  }

  private load() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const data = require(this.dataFile) as ContractMetadata[];
      this.entries = data;
    } catch {
      this.entries = [];
    }
  }

  /** Save current entries back to JSON */
  private save() {
    const fs = require('fs');
    fs.writeFileSync(this.dataFile, JSON.stringify(this.entries, null, 2));
  }

  /** Register a new contract deployment */
  register(meta: ContractMetadata) {
    // Remove any existing entry with same name and version
    this.entries = this.entries.filter(e => !(e.name === meta.name && e.version === meta.version));
    this.entries.push(meta);
    this.save();
  }

  /** Get the latest version of a contract by name */
  getLatest(name: string): ContractMetadata | undefined {
    const candidates = this.entries.filter(e => e.name === name);
    if (!candidates.length) return undefined;
    // simple semver sort – assumes valid semver strings
    candidates.sort((a, b) => (a.version > b.version ? -1 : 1));
    return candidates[0];
  }

  /** Retrieve a specific version */
  getVersion(name: string, version: string): ContractMetadata | undefined {
    return this.entries.find(e => e.name === name && e.version === version);
  }

  /** List all entries */
  list(): ContractMetadata[] {
    return [...this.entries];
  }
}
