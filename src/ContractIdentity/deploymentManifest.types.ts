/**
 * deploymentManifest.types.ts
 *
 * Canonical schema for signed Chen Pilot contract deployment manifests (Issue #676).
 *
 * A deployment manifest is an auditable, signed document that binds a logical
 * contract to its expected on-chain identity:
 *
 *   network            — the Stellar network the contract was deployed on
 *   contractId         — the on-chain Contract ID (starts with "C")
 *   wasmHash           — SHA-256 of the deployed WASM bytecode
 *   interfaceVersion   — semantic version of the public contract interface
 *   dependencies       — other logical contracts this contract depends on
 *   upgradeAuthority   — the Ed25519 public key authorized to rotate the manifest
 *   rotation           — append-only, signed rotation history
 *
 * The manifest is signed by the upgrade authority over a canonical JSON
 * serialization of its immutable fields. Any change to the bound identity
 * (a "rotation") requires a fresh signature from the same authority, and the
 * prior manifest is preserved in the rotation history so the change is
 * auditable.
 */

/** The Stellar network a contract can be deployed to. */
export type ManifestNetwork = "testnet" | "mainnet";

/** Immutable, signed identity fields of a deployment manifest. */
export interface DeploymentManifestPayload {
  /** Logical contract key (e.g. "core_vault"). */
  contractName: string;
  /** Network the contract is deployed on. */
  network: ManifestNetwork;
  /** On-chain Contract ID (must start with "C"). */
  contractId: string;
  /** SHA-256 (hex, 64 chars) of the deployed WASM bytecode. */
  wasmHash: string;
  /** Semantic version of the public contract interface. */
  interfaceVersion: string;
  /** Other logical contracts this contract depends on (contractName). */
  dependencies: string[];
  /** Ed25519 public key (hex) authorized to rotate this manifest. */
  upgradeAuthority: string;
  /** ISO-8601 timestamp when this manifest was signed. */
  signedAt: string;
  /** Monotonic rotation generation; separated networks must never share a generation. */
  generation: number;
}

/** A single auditable rotation record. */
export interface ManifestRotationEntry {
  generation: number;
  contractId: string;
  wasmHash: string;
  interfaceVersion: string;
  signedAt: string;
  /** Raw Ed25519 signature (base64) over the pre-rotation payload. */
  signature: string;
  /** ISO-8601 timestamp when the rotation was recorded by the backend. */
  recordedAt: string;
  /** Optional human-readable justification / change notes. */
  notes?: string;
}

/** The on-disk / on-wire form of a signed deployment manifest. */
export interface SignedDeploymentManifest {
  /** Version of the manifest schema itself. */
  schemaVersion: 1;
  payload: DeploymentManifestPayload;
  /** Ed25519 signature (base64) over the canonical serialization of `payload`. */
  signature: string;
  /** Append-only rotation history, most recent first. */
  rotation: ManifestRotationEntry[];
}

/** Outcome of a signature verification operation. */
export interface SignatureVerificationResult {
  valid: boolean;
  /** Present when invalid — why verification failed. */
  reason?: string;
}

/** Outcome of verifying a manifest against live chain state. */
export type ChainIdentityState =
  | "unverified"
  | "verified"
  | "mismatch"
  | "network_separated";

export interface ChainIdentityResult {
  contractName: string;
  network: ManifestNetwork;
  contractId: string;
  /** Expected WASM hash from the manifest. */
  expectedWasmHash: string;
  /** Actual on-chain WASM hash, when it could be read. */
  observedWasmHash?: string;
  state: ChainIdentityState;
  reason?: string;
}
