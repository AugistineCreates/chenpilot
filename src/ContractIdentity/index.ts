/**
 * ContractIdentity — signed deployment manifests and code-identity enforcement (Issue #676).
 *
 * Public surface:
 *   - Manifest document model + Ed25519 signing / verification / rotation
 *   - Filesystem store (network-scoped)
 *   - Startup verification against live chain state
 *   - Runtime gate that blocks mutating traffic on identity mismatch
 *   - Admin API for signed, auditable manifest publishing and rotation
 */

// Manifest schema
export type {
  DeploymentManifestPayload,
  ManifestNetwork,
  ManifestRotationEntry,
  SignedDeploymentManifest,
  SignatureVerificationResult,
  ChainIdentityResult,
  ChainIdentityState,
} from "./deploymentManifest.types";

// Manifest model / crypto
export {
  canonicalizeManifest,
  createSignedManifest,
  deriveUpgradeAuthority,
  rotateManifest,
  signManifest,
  validateManifestPayload,
  verifyManifestSignature,
  verifySignedManifest,
} from "./deploymentManifest";
export type { RotationInput } from "./deploymentManifest";

// Store
export { FileManifestStore, manifestStore } from "./manifestStore";
export type { ManifestStore } from "./manifestStore";

// Chain state
export {
  SorobanChainIdentityProvider,
  chainIdentityProvider,
  activeChainNetwork,
  lookupManifestCodeIdentity,
} from "./chainStateReader";
export type {
  ChainCodeLookupResult,
  ChainIdentityProvider,
  ChainLookupNetwork,
} from "./chainStateReader";

// Verification + gate
export {
  IdentityVerificationService,
  identityVerificationService,
  activeNetwork,
} from "./identityVerification.service";
export type {
  VerifiedContractIdentity,
  EnforcementMode,
} from "./identityVerification.service";
export {
  assertCodeIdentityAllowsMutation,
  assertCodeIdentityAllowsMutationByContractId,
  canMutate,
  identityGateStatus,
  resolveContractKeyByContractId,
} from "./codeIdentityGate";

// Lifecycle service
export { ManifestService, manifestService } from "./manifestService";
export type {
  PublishManifestInput,
  RotateManifestInput,
} from "./manifestService";

// Errors
export {
  ManifestError,
  CodeIdentityMismatchError,
  NetworkIdentityMismatchError,
  MissingManifestError,
  IdentityGateBlockedError,
} from "./errors";

// Routes
export { default as contractIdentityRoutes } from "./contractIdentity.routes";
