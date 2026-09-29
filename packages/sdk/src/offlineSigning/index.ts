/**
 * Offline (air-gapped) transaction preparation and signing.
 *
 * Lets a connected host prepare a transaction, a disconnected host review and
 * sign it, and a connected host merge the results — with an integrity digest
 * that every stage can verify independently.
 *
 * @example
 * ```ts
 * import { OfflineSigningCoordinator } from "@chen-pilot/sdk-core";
 *
 * // Online host
 * const coordinator = OfflineSigningCoordinator.prepare({
 *   transactionXdr,
 *   networkPassphrase,
 *   sourceAccount,
 *   expectedSigners: [coldSigner],
 *   summary: plan.summary,
 * });
 * const forTransport = coordinator.serialize();
 *
 * // Offline host
 * const offline = OfflineSigningCoordinator.fromSerializedArtifact(forTransport);
 * const review = offline.review(); // render before signing
 * ```
 */

export * from "./types";
export {
  OfflineSigningCoordinator,
  attachSignature,
  canonicalize,
  computeArtifactDigest,
  createBundle,
  deserializeArtifact,
  finalizeBundle,
  isArtifactIntact,
  isThresholdMet,
  prepareOfflineSigning,
  reviewArtifact,
  serializeArtifact,
  validateSignature,
  validateSigningRequest,
  type PrepareOptions,
} from "./coordinator";
