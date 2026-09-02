/**
 * manifestStore.ts
 *
 * Filesystem-backed store for signed deployment manifests (Issue #676).
 *
 * Manifests are persisted as JSON files under the repo `deployments/` directory
 * (configurable via MANIFEST_DIR). Each file is named
 *
 *   <network>/<contractName>.manifest.json
 *
 * so that testnet and mainnet identities are physically separated and can never
 * overwrite one another. The store is committed-agnostic: it only reads and
 * writes whole signed-manifest documents, leaving trust/verification to the
 * identity service.
 */

import fs from "fs";
import path from "path";
import {
  SignedDeploymentManifest,
  ManifestNetwork,
} from "./deploymentManifest.types";
import { ManifestError } from "./errors";

export interface ManifestStore {
  /** Persist a signed manifest, enforcing network-scoped file locations. */
  save(manifest: SignedDeploymentManifest): Promise<void>;
  /** Load a single manifest by network + contract name; undefined if absent. */
  load(
    network: ManifestNetwork,
    contractName: string
  ): Promise<SignedDeploymentManifest | undefined>;
  /** List all manifests from disk. */
  list(): Promise<SignedDeploymentManifest[]>;
}

export class FileManifestStore implements ManifestStore {
  private readonly rootDir: string;

  constructor(
    rootDir: string = process.env.MANIFEST_DIR ||
      path.resolve(process.cwd(), "deployments")
  ) {
    this.rootDir = rootDir;
  }

  private networkDir(network: ManifestNetwork): string {
    return path.join(this.rootDir, network);
  }

  private filePath(network: ManifestNetwork, contractName: string): string {
    return path.join(this.networkDir(network), `${contractName}.manifest.json`);
  }

  async save(manifest: SignedDeploymentManifest): Promise<void> {
    const { network, contractName } = manifest.payload;
    const dir = this.networkDir(network);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      this.filePath(network, contractName),
      JSON.stringify(manifest, null, 2),
      "utf8"
    );
  }

  async load(
    network: ManifestNetwork,
    contractName: string
  ): Promise<SignedDeploymentManifest | undefined> {
    const file = this.filePath(network, contractName);
    let raw: string;
    try {
      raw = await fs.promises.readFile(file, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return undefined;
      throw new ManifestError(
        `Failed to read manifest ${file}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    try {
      return JSON.parse(raw) as SignedDeploymentManifest;
    } catch (err) {
      throw new ManifestError(
        `Manifest ${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async list(): Promise<SignedDeploymentManifest[]> {
    const networks: ManifestNetwork[] = ["testnet", "mainnet"];
    const results: SignedDeploymentManifest[] = [];
    for (const network of networks) {
      const dir = this.networkDir(network);
      let files: string[];
      try {
        files = await fs.promises.readdir(dir);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") continue;
        throw err;
      }
      const loaded = await Promise.all(
        files
          .filter((file) => file.endsWith(".manifest.json"))
          .map((file) =>
            this.load(network, file.replace(/\.manifest\.json$/, ""))
          )
      );
      for (const manifest of loaded) {
        if (manifest) results.push(manifest);
      }
    }
    return results;
  }
}

export const manifestStore: ManifestStore = new FileManifestStore();
