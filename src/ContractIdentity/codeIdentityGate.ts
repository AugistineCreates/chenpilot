/**
 * codeIdentityGate.ts
 *
 * Runtime gate that blocks mutating traffic for contracts whose code identity
 * does not match the signed deployment manifest (Issue #676).
 *
 * The gate is a thin wrapper over IdentityVerificationService.assertCanMutate.
 * It exports a synchronous predicate that callers guarding a state-changing
 * operation invoke with the logical contract key. When the contract is not
 * verified (or its on-chain identity mismatches), it throws a typed
 * IdentityGateBlockedError / CodeIdentityMismatchError / etc.
 */

import {
  identityVerificationService,
  activeNetwork,
} from "./identityVerification.service";
import {
  CodeIdentityMismatchError,
  MissingManifestError,
  NetworkIdentityMismatchError,
} from "./errors";
import logger from "../config/logger";
import { contractMetadataRegistry } from "../services/contracts/contractMetadataRegistry";
import type { ManifestNetwork } from "./deploymentManifest.types";

/**
 * Assert that a state-mutating operation against `contractName` is permitted.
 *
 * Throws (blocking the operation) unless the contract has a signed manifest
 * whose network matches the active network AND whose code identity is verified
 * against chain state. Enforcement is hard by default and can be softened with
 * MANIFEST_ENFORCEMENT=off (warn-only).
 *
 * @throws MissingManifestError     no trusted manifest
 * @throws NetworkIdentityMismatchError manifest bound to another network
 * @throws CodeIdentityMismatchError   on-chain identity differs from manifest
 */
export function assertCodeIdentityAllowsMutation(contractName: string): void {
  try {
    identityVerificationService.assertCanMutate(contractName);
  } catch (err) {
    if (
      err instanceof MissingManifestError ||
      err instanceof CodeIdentityMismatchError ||
      err instanceof NetworkIdentityMismatchError
    ) {
      logger.warn("Identity gate blocked mutating traffic", {
        contract: contractName,
        error: err.message,
      });
      throw err;
    }
    throw err;
  }
}

/** True when the gate would permit a mutating operation for the contract. */
export async function canMutate(contractName: string): Promise<boolean> {
  try {
    assertCodeIdentityAllowsMutation(contractName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the logical contract key for a given on-chain contract ID on the
 * backend's active network. Returns undefined for contract IDs that are not
 * bound to a registered Chen Pilot contract on the active network.
 */
export function resolveContractKeyByContractId(
  contractId: string,
  network: ManifestNetwork = activeNetwork()
): string | undefined {
  if (!contractId) return undefined;
  try {
    return contractMetadataRegistry
      .listContracts(network)
      .find((c) => c.bindings[0]?.address === contractId)?.key;
  } catch {
    return undefined;
  }
}

/**
 * Assert that a state-mutating invocation against `contractId` is permitted.
 *
 * Gate applies only when the contract is a registered Chen Pilot contract on the
 * backend's active network AND the invocation targets that same active network.
 * This keeps testnet/mainnet identities strictly separated: an invocation bound
 * to a non-active network passes through the generic invoker un-gated (it is not
 * a call to the backend's trusted identity), while an unregistered/foreign
 * contract ID is also unaffected.
 *
 * When the contract resolves to a registered key, the standard identity gate is
 * applied and mismatched code identity blocks the mutation.
 *
 * @throws MissingManifestError         registered contract with no trusted manifest
 * @throws NetworkIdentityMismatchError contract bound to another network
 * @throws CodeIdentityMismatchError    on-chain identity differs from manifest
 */
export function assertCodeIdentityAllowsMutationByContractId(
  contractId: string,
  network: ManifestNetwork = activeNetwork()
): void {
  if (network !== activeNetwork()) {
    // Invocation on a non-active network is out of scope for the backend's
    // trusted identity (network separation preserved by design).
    return;
  }
  const key = resolveContractKeyByContractId(contractId, network);
  if (!key) {
    // Not a registered Chen Pilot contract on the active network — the identity
    // gate does not apply to arbitrary third-party contracts.
    return;
  }
  assertCodeIdentityAllowsMutation(key);
}

/** Human summary of the identity gate status for observability endpoints. */
export function identityGateStatus() {
  const identities = identityVerificationService as unknown as {
    cache?: Map<string, unknown>;
  };
  const entries = identities.cache ?? new Map();
  return {
    verified: identityVerificationService.isVerified,
    enforcementMode: identityVerificationService.enforcementMode,
    contracts: Array.from(entries.entries()).map(
      ([contractName]) => contractName
    ),
  };
}
