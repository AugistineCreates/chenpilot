/**
 * identityVerification.service.ts
 *
 * Central verification service for Issue #676.
 *
 * Responsibilities:
 *   - Load all trusted manifests from the store.
 *   - Verify each manifest's signature with its embedded upgrade authority.
 *   - Enforce network separation: only manifests bound to the active network
 *     are trusted for the active network's runtime.
 *   - Verify each manifest's recorded identity against live chain state.
 *   - Cache verification results for the runtime identity gate.
 *   - Expose the gate used to block mutating traffic on mismatch.
 *
 * Enforcement policy:
 *   - Hard by default: on-chain mismatch (or a missing manifest for a known
 *     active contract) sets the contract's runtime state to "blocked".
 *   - Configurable override: setting MANIFEST_ENFORCEMENT=off softens startup
 *     and runtime enforcement for degraded/offline operation (warn only).
 */

import {
  SignedDeploymentManifest,
  ManifestNetwork,
} from "./deploymentManifest.types";
import { verifySignedManifest } from "./deploymentManifest";
import { manifestStore } from "./manifestStore";
import {
  ChainIdentityProvider,
  chainIdentityProvider,
  lookupManifestCodeIdentity,
} from "./chainStateReader";
import { networkConfig } from "../services/networkConfig";
import {
  CodeIdentityMismatchError,
  MissingManifestError,
  NetworkIdentityMismatchError,
} from "./errors";
import logger from "../config/logger";
import { contractMetadataRegistry } from "../services/contracts";

export interface VerifiedContractIdentity {
  contractName: string;
  network: ManifestNetwork;
  contractId: string;
  wasmHash: string;
  interfaceVersion: string;
  upgradeAuthority: string;
  generation: number;
  /** Whether live chain state matched the manifest. */
  chainVerified: boolean;
  /** Whether chain identity could not be confirmed. */
  chainUnavailable: boolean;
  /** Whether the backend is allowed to proceed despite a mismatch. */
  enforcementOverride: boolean;
}

export type EnforcementMode = "enforce" | "off";

function resolveEnforcement(): EnforcementMode {
  const raw = process.env.MANIFEST_ENFORCEMENT?.toLowerCase();
  if (raw === "off" || raw === "false" || raw === "0") return "off";
  return "enforce";
}

/** Active network normalized to a manifest network. */
export function activeNetwork(): ManifestNetwork {
  return networkConfig.type === "public" ? "mainnet" : "testnet";
}

export class IdentityVerificationService {
  private readonly provider: ChainIdentityProvider;
  private readonly store;
  private cache = new Map<string, VerifiedContractIdentity | undefined>();
  private verified = false;

  constructor(
    provider: ChainIdentityProvider = chainIdentityProvider,
    store = manifestStore
  ) {
    this.provider = provider;
    this.store = store;
  }

  get enforcementMode(): EnforcementMode {
    return resolveEnforcement();
  }

  get isVerified(): boolean {
    return this.verified;
  }

  /** Complete startup verification: load + signature-verify + chain-verify. */
  async verifyAll(): Promise<VerifiedContractIdentity[]> {
    // Discover the set of contracts the backend actually binds/operates on so a
    // missing manifest for an active contract is surfaced at startup.
    const activeNames = this.discoverActiveContractNames();
    const manifests = await this.store.list();
    const byName = new Map<string, SignedDeploymentManifest>();
    for (const m of manifests) {
      byName.set(`${m.payload.network}:${m.payload.contractName}`, m);
    }

    const results: VerifiedContractIdentity[] = [];
    const network = activeNetwork();

    // Chain-verify every manifest bound to the active network.
    for (const m of manifests) {
      const identity = await this.verifyManifest(m, network);
      if (identity) results.push(identity);
    }

    // Surface missing manifests for active contracts on the active network.
    for (const name of activeNames) {
      const key = `${network}:${name}`;
      if (!byName.has(key) && this.enforcementMode === "enforce") {
        logger.error("Active contract has no deployment manifest; blocking", {
          contract: name,
        });
        this.cache.set(name, undefined);
      }
    }

    this.verified = true;
    logger.info("Contract identity verification complete", {
      network,
      verified: results.length,
      mode: this.enforcementMode,
    });
    return results;
  }

  /** Verify + cache a single manifest, enforcing network separation. */
  async verifyManifest(
    manifest: SignedDeploymentManifest,
    activeNet?: ManifestNetwork
  ): Promise<VerifiedContractIdentity | undefined> {
    const active = activeNet ?? activeNetwork();
    const { contractName, network } = manifest.payload;

    // Signature/structural verification.
    const sigResult = verifySignedManifest(manifest);
    if (!sigResult.valid) {
      logger.error("Manifest signature verification failed", {
        contract: contractName,
        reason: sigResult.reason,
      });
      this.cache.set(contractName, this.unverified(manifest, false));
      return undefined;
    }

    // Network separation: a manifest bound to another network is never trusted.
    if (network !== active) {
      this.cache.set(contractName, this.unverified(manifest, false));
      return undefined;
    }

    // Chain-state verification.
    const chain = await lookupManifestCodeIdentity(manifest, this.provider);
    const enforcementOverride = this.enforcementMode === "off";

    const identity: VerifiedContractIdentity = {
      contractName,
      network,
      contractId: manifest.payload.contractId,
      wasmHash: manifest.payload.wasmHash,
      interfaceVersion: manifest.payload.interfaceVersion,
      upgradeAuthority: manifest.payload.upgradeAuthority,
      generation: manifest.payload.generation,
      chainVerified: chain.match,
      chainUnavailable:
        !chain.match && Boolean(chain.reason && !chain.observedWasmHash),
      enforcementOverride,
    };
    this.cache.set(contractName, identity);

    if (chain.match) {
      logger.info("Contract identity verified against chain", {
        contract: contractName,
      });
    } else {
      logger.warn("Contract identity mismatch against chain", {
        contract: contractName,
        reason: chain.reason,
      });
    }
    return identity;
  }

  /** Look up a cached identity for a contract. */
  getIdentity(contractName: string): VerifiedContractIdentity | undefined {
    return this.cache.get(contractName);
  }

  /**
   * Gate check run before mutating traffic (Issue #676).
   *
   * - No verified/trusted manifest -> block (MissingManifestError) unless override.
   * - Network bound to another network -> block (NetworkIdentityMismatchError).
   * - Chain identity mismatch -> block (CodeIdentityMismatchError) unless override.
   *
   * Read-only calls do not pass through this gate (see codeIdentityGate).
   */
  assertCanMutate(contractName: string): VerifiedContractIdentity {
    const identity = this.cache.get(contractName);

    if (!identity) {
      if (this.enforcementMode === "off") {
        logger.warn("Identity gate bypassed (enforcement off) for contract", {
          contract: contractName,
        });
        throw new MissingManifestError(
          contractName,
          "no verified manifest present (enforcement disabled, treated as blocked for safety)"
        );
      }
      throw new MissingManifestError(
        contractName,
        "backend has no verified manifest for this contract"
      );
    }

    // Network separation hard-check — never overridable.
    if (identity.network !== activeNetwork()) {
      throw new NetworkIdentityMismatchError(
        contractName,
        identity.network,
        activeNetwork()
      );
    }

    if (!identity.chainVerified) {
      if (identity.enforcementOverride) {
        logger.warn("Identity gate bypassed (enforcement off) for contract", {
          contract: contractName,
          expectedWasmHash: identity.wasmHash,
        });
        return identity;
      }
      throw new CodeIdentityMismatchError(
        contractName,
        identity.wasmHash,
        identity.chainUnavailable ? undefined : undefined
      );
    }

    return identity;
  }

  private unverified(
    manifest: SignedDeploymentManifest,
    chainVerified: boolean
  ): VerifiedContractIdentity {
    return {
      contractName: manifest.payload.contractName,
      network: manifest.payload.network,
      contractId: manifest.payload.contractId,
      wasmHash: manifest.payload.wasmHash,
      interfaceVersion: manifest.payload.interfaceVersion,
      upgradeAuthority: manifest.payload.upgradeAuthority,
      generation: manifest.payload.generation,
      chainVerified,
      chainUnavailable: !chainVerified,
      enforcementOverride: this.enforcementMode === "off",
    };
  }

  private discoverActiveContractNames(): string[] {
    try {
      return contractMetadataRegistry
        .listContracts(activeNetwork())
        .map((c) => c.key);
    } catch {
      return [];
    }
  }
}

export const identityVerificationService = new IdentityVerificationService();
