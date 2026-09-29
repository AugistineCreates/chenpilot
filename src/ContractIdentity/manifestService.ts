/**
 * manifestService.ts
 *
 * High-level manifest lifecycle service (Issue #676): publishing a new signed
 * manifest, querying manifests, and rotating to a new bound identity.
 *
 * Rotation is signed and auditable:
 *   - A rotation must be signed by the upgrade authority (the manifest's
 *     embedded `upgradeAuthority`), validated by re-running signature checks.
 *   - Every rotation preserves the previous identity in the manifest's
 *     append-only `rotation` history.
 *   - Every successful (and attempted) rotation is recorded to the security
 *     audit ledger via auditLogService.
 */

import {
  SignedDeploymentManifest,
  ManifestNetwork,
} from "./deploymentManifest.types";
import {
  createSignedManifest,
  deriveUpgradeAuthority,
  rotateManifest,
  verifySignedManifest,
} from "./deploymentManifest";
import { manifestStore } from "./manifestStore";
import { ManifestError } from "./errors";
import { auditLogService } from "../AuditLog/auditLog.service";
import logger from "../config/logger";
import {
  AdminAction,
  EventCategory,
  AuditEventSeverity,
  AuditActor,
} from "../AuditLog";

export interface PublishManifestInput {
  contractName: string;
  network: ManifestNetwork;
  contractId: string;
  wasmHash: string;
  interfaceVersion: string;
  dependencies?: string[];
  signedAt?: string;
  generation?: number;
}

export interface RotateManifestInput {
  contractName: string;
  network: ManifestNetwork;
  contractId: string;
  wasmHash: string;
  interfaceVersion: string;
  notes?: string;
  actor?: Partial<AuditActor>;
}

export class ManifestService {
  private readonly store;

  constructor(store = manifestStore) {
    this.store = store;
  }

  /** Publish a fresh signed manifest (signs with the configured authority). */
  async publish(
    input: PublishManifestInput
  ): Promise<SignedDeploymentManifest> {
    const existing = await this.store.load(input.network, input.contractName);
    if (existing) {
      throw new ManifestError(
        `A manifest already exists for ${input.network}/${input.contractName}; use rotation to change its identity`
      );
    }
    const manifest = createSignedManifest({
      contractName: input.contractName,
      network: input.network,
      contractId: input.contractId,
      wasmHash: input.wasmHash,
      interfaceVersion: input.interfaceVersion,
      dependencies: input.dependencies ?? [],
      upgradeAuthority: requireUpgradeAuthority(),
      signedAt: input.signedAt ?? new Date().toISOString(),
      generation: input.generation ?? 0,
    });
    await this.store.save(manifest);
    await this.recordLifecycleEvent("manifest.published", manifest, undefined, {
      success: true,
    });
    return manifest;
  }

  /** Load a manifest for the given network + contract. */
  async get(
    network: ManifestNetwork,
    contractName: string
  ): Promise<SignedDeploymentManifest | undefined> {
    return this.store.load(network, contractName);
  }

  /** List all manifests. */
  async list(): Promise<SignedDeploymentManifest[]> {
    return this.store.list();
  }

  /**
   * Rotate an existing manifest to a new identity.
   *
   * Requires the existing manifest to be authentic and its upgrade authority to
   * match the backend's configured authority. Rewrites the stored manifest with
   * the rotating identity secured by a fresh signature and preserves the prior
   * identity in the rotation history.
   */
  async rotate(
    network: ManifestNetwork,
    contractName: string,
    input: RotateManifestInput,
    actor?: Partial<AuditActor>
  ): Promise<SignedDeploymentManifest> {
    const current = await this.store.load(network, contractName);
    if (!current) {
      await this.recordLifecycleEvent(
        "manifest.rotate.rejected",
        undefined,
        { contractName, network, reason: "no existing manifest" },
        { success: false, actor }
      );
      throw new ManifestError(
        `No manifest exists for ${network}/${contractName}; publish first`
      );
    }

    if (current.payload.network !== input.network) {
      await this.recordLifecycleEvent(
        "manifest.rotate.rejected",
        current,
        { contractName, reason: "network change attempted during rotation" },
        { success: false, actor }
      );
      throw new ManifestError(
        "A manifest cannot be rotated across networks (testnet/mainnet separation)"
      );
    }

    const next = rotateManifest(
      current,
      {
        contractId: input.contractId,
        wasmHash: input.wasmHash,
        interfaceVersion: input.interfaceVersion,
        notes: input.notes,
      },
      requireUpgradeAuthority()
    );

    await this.store.save(next);
    await this.recordLifecycleEvent(
      "manifest.rotated",
      next,
      {
        previousContractId: current.payload.contractId,
        previousWasmHash: current.payload.wasmHash,
        reason: input.notes,
      },
      { success: true, actor }
    );
    return next;
  }

  /** Verify a stored manifest document without mutating anything. */
  verify(manifest: SignedDeploymentManifest) {
    return verifySignedManifest(manifest);
  }

  private async recordLifecycleEvent(
    action: string,
    manifest: SignedDeploymentManifest | undefined,
    extraMeta: Record<string, unknown>,
    opts: { success?: boolean; actor?: Partial<AuditActor> } = {}
  ) {
    try {
      await auditLogService.logEvent({
        action: action as AdminAction,
        category: EventCategory.ADMIN,
        severity:
          opts.success === false
            ? AuditEventSeverity.ERROR
            : AuditEventSeverity.INFO,
        actor: opts.actor ?? { serviceId: "contract-identity" },
        resource: {
          type: "DeploymentManifest",
          id: manifest
            ? `${manifest.payload.network}/${manifest.payload.contractName}`
            : undefined,
        },
        success: opts.success ?? true,
        metadata: {
          contractName: manifest?.payload.contractName,
          network: manifest?.payload.network,
          contractId: manifest?.payload.contractId,
          wasmHash: manifest?.payload.wasmHash,
          interfaceVersion: manifest?.payload.interfaceVersion,
          generation: manifest?.payload.generation,
          ...extraMeta,
        },
      });
    } catch (err) {
      // Audit failures must not break manifest operations, but they are surfaced.
      logger.error("Failed to record manifest audit event", err);
    }
  }
}

export const manifestService = new ManifestService();

/** The upgrade authority the backend trusts for signing (public key hex). */
function requireUpgradeAuthority(): string {
  return deriveUpgradeAuthority();
}
