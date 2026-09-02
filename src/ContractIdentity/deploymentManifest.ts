/**
 * deploymentManifest.ts
 *
 * Deployment-manifest document model, canonicalization, signing/verification
 * and rotation logic for Issue #676.
 *
 * Signing uses Ed25519 (via Node's crypto). The upgrade authority holds an
 * Ed25519 keypair; the public key (hex, 64 chars / 32 bytes) is embedded in the
 * manifest as `upgradeAuthority`. Signatures are computed over a deterministic
 * canonical JSON serialization of the immutable payload so that signing and
 * verifying are order-independent and reproducible across processes.
 */

import crypto from "crypto";
import {
  DeploymentManifestPayload,
  ManifestRotationEntry,
  SignedDeploymentManifest,
  SignatureVerificationResult,
} from "./deploymentManifest.types";
import { ManifestError } from "./errors";

// ─── Canonicalization ────────────────────────────────────────────────────────

/**
 * Return a deterministic JSON representation of the manifest payload.
 *
 * The payload is deep-sorted by key and serialized without extraneous
 * whitespace so that the bytes signed at creation match the bytes verified at
 * startup regardless of field insertion order.
 */
export function canonicalizeManifest(
  payload: DeploymentManifestPayload
): string {
  return JSON.stringify(sortKeys(payload));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

// ─── Signature helpers ───────────────────────────────────────────────────────

// For Ed25519, Node's crypto.sign/verify expect the (optional) HashAlgorithm
// argument to be null/empty — it must NOT be the string "ed25519" (which would
// be misread as a digest name and throw "Invalid digest").
const ED25519_ALGORITHM: crypto.BinaryLike | null = null;

function normalizePublicKey(hex: string): Buffer {
  const bytes = Buffer.from(hex, "hex");
  if (bytes.length !== 32) {
    throw new ManifestError(
      `Invalid upgrade authority public key: expected 32 bytes, got ${bytes.length}`
    );
  }
  return bytes;
}

// SPKI (SubjectPublicKeyInfo) header for Ed25519: algorithm OID + BIT STRING.
// The manifest stores the *raw* 32-byte Ed25519 public key, so we re-wrap it in
// a minimal SPKI envelope before handing it to crypto.createPublicKey.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function importPublicKey(hex: string): crypto.KeyObject {
  const raw = normalizePublicKey(hex);
  const spki = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
  return crypto.createPublicKey({
    key: spki,
    format: "der",
    type: "spki",
  });
}

function importPrivateKeyForSigning(): crypto.KeyObject {
  const pem = process.env.MANIFEST_SIGNING_KEY;
  if (!pem) {
    throw new ManifestError(
      "MANIFEST_SIGNING_KEY is not configured; cannot sign a deployment manifest"
    );
  }
  try {
    return crypto.createPrivateKey(pem);
  } catch (err) {
    throw new ManifestError(
      `Invalid MANIFEST_SIGNING_KEY: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Sign a manifest payload with the configured upgrade-authority private key.
 *
 * Returns the base64 Ed25519 signature over the canonical payload.
 */
export function signManifest(payload: DeploymentManifestPayload): string {
  const privateKey = importPrivateKeyForSigning();
  const canonical = canonicalizeManifest(payload);
  return crypto
    .sign(ED25519_ALGORITHM, Buffer.from(canonical, "utf8"), privateKey)
    .toString("base64");
}

/**
 * Verify that `signature` is a valid Ed25519 signature over the canonical
 * payload, produced by the given upgrade-authority public key.
 */
export function verifyManifestSignature(
  payload: DeploymentManifestPayload,
  signature: string,
  upgradeAuthorityPublicKey: string
): SignatureVerificationResult {
  try {
    const publicKey = importPublicKey(upgradeAuthorityPublicKey);
    const canonical = canonicalizeManifest(payload);
    const ok = crypto.verify(
      ED25519_ALGORITHM,
      Buffer.from(canonical, "utf8"),
      publicKey,
      Buffer.from(signature, "base64")
    );
    if (!ok) {
      return { valid: false, reason: "Signature does not match the payload" };
    }
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Return the Ed25519 public key (hex) corresponding to the configured signing
 * private key. Used to validate that a manifest's upgradeAuthority matches the
 * authority the backend is configured to trust.
 */
export function deriveUpgradeAuthority(): string {
  const privateKey = importPrivateKeyForSigning();
  const publicKeyObj = crypto.createPublicKey(privateKey);
  return (publicKeyObj.export({ format: "der", type: "spki" }) as Buffer)
    .subarray(-32)
    .toString("hex");
}

// ─── Construction and validation ─────────────────────────────────────────────

/**
 * Validate the structural invariants of a manifest payload. Throws
 * ManifestError on the first violation.
 */
export function validateManifestPayload(
  payload: DeploymentManifestPayload
): void {
  if (!payload.contractName) {
    throw new ManifestError("Manifest payload requires a contractName");
  }
  if (payload.network !== "testnet" && payload.network !== "mainnet") {
    throw new ManifestError(
      `Manifest payload requires a valid network; got "${payload.network}"`
    );
  }
  if (!payload.contractId?.startsWith("C")) {
    throw new ManifestError(
      `Manifest contractId "${payload.contractId}" must start with "C"`
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(payload.wasmHash || "")) {
    throw new ManifestError(
      "Manifest wasmHash must be a 64-character hex SHA-256 digest"
    );
  }
  if (!payload.interfaceVersion) {
    throw new ManifestError("Manifest payload requires an interfaceVersion");
  }
  if (!upgradeAuthorityIsHex32(payload.upgradeAuthority)) {
    throw new ManifestError(
      "Manifest upgradeAuthority must be a 32-byte hex Ed25519 public key"
    );
  }
  if (!payload.signedAt || Number.isNaN(Date.parse(payload.signedAt))) {
    throw new ManifestError(
      "Manifest payload requires a valid signedAt timestamp"
    );
  }
  if (
    typeof payload.generation !== "number" ||
    payload.generation < 0 ||
    !Number.isInteger(payload.generation)
  ) {
    throw new ManifestError(
      "Manifest payload requires a non-negative integer generation"
    );
  }
}

function upgradeAuthorityIsHex32(value: string): boolean {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{64}$/.test(value))
    return false;
  return Buffer.from(value, "hex").length === 32;
}

/**
 * Build and sign a new deployment manifest.
 *
 * @param payload       The identity payload to sign.
 * @param signingKeyEnv The env var holding the signing private key (default MANIFEST_SIGNING_KEY).
 */
export function createSignedManifest(
  payload: DeploymentManifestPayload
): SignedDeploymentManifest {
  validateManifestPayload(payload);
  const signature = signManifest(payload);
  return {
    schemaVersion: 1,
    payload,
    signature,
    rotation: [],
  };
}

/**
 * Independently verify every invariant of a fully-materialized signed
 * manifest, including:
 *   - structural validity of the payload
 *   - signature authenticity with the embedded upgrade authority
 *   - signature authenticity with the backend's configured authority
 *
 * This is the check the backend performs before trusting a manifest.
 */
export function verifySignedManifest(
  manifest: SignedDeploymentManifest
): SignatureVerificationResult {
  if ((manifest as { schemaVersion?: number }).schemaVersion !== 1) {
    return { valid: false, reason: "Unsupported manifest schemaVersion" };
  }
  if (
    !manifest.payload ||
    !manifest.signature ||
    !Array.isArray(manifest.rotation)
  ) {
    return { valid: false, reason: "Malformed signed manifest shape" };
  }
  try {
    validateManifestPayload(manifest.payload);
  } catch (err) {
    return {
      valid: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  // The manifest must be signed by its own declared authority.
  const self = verifyManifestSignature(
    manifest.payload,
    manifest.signature,
    manifest.payload.upgradeAuthority
  );
  if (!self.valid) {
    return { valid: false, reason: `Self-signature invalid: ${self.reason}` };
  }

  // Every rotation entry must be signed by the same authority over the state
  // it replaced.
  for (const entry of manifest.rotation) {
    const pseudo: DeploymentManifestPayload = {
      contractName: manifest.payload.contractName,
      network: manifest.payload.network,
      contractId: entry.contractId,
      wasmHash: entry.wasmHash,
      interfaceVersion: entry.interfaceVersion,
      dependencies: manifest.payload.dependencies,
      upgradeAuthority: manifest.payload.upgradeAuthority,
      signedAt: entry.signedAt,
      generation: entry.generation,
    };
    const entryOk = verifyManifestSignature(
      pseudo,
      entry.signature,
      manifest.payload.upgradeAuthority
    );
    if (!entryOk.valid) {
      return {
        valid: false,
        reason: `Rotation entry gen ${entry.generation} has invalid signature: ${entryOk.reason}`,
      };
    }
  }

  return { valid: true };
}

// ─── Rotation ────────────────────────────────────────────────────────────────

export interface RotationInput {
  contractId: string;
  wasmHash: string;
  interfaceVersion: string;
  /** New signedAt timestamp; defaults to now. */
  signedAt?: string;
  notes?: string;
}

/**
 * Rotate a signed manifest to a new bound identity.
 *
 * Rotation requires the current manifest to be authentic (self-consistently
 * signed), preserves the previous identity as an auditable history entry, and
 * returns a newly signed manifest with an incremented generation.
 *
 * Network separation is enforced: a manifest can only rotate within the network
 * it is already bound to — a valid network can never change during rotation.
 */
export function rotateManifest(
  current: SignedDeploymentManifest,
  next: RotationInput,
  expectedAuthority?: string
): SignedDeploymentManifest {
  const check = verifySignedManifest(current);
  if (!check.valid) {
    throw new ManifestError(
      `Cannot rotate an untrusted manifest: ${check.reason}`
    );
  }
  if (
    expectedAuthority &&
    current.payload.upgradeAuthority !== expectedAuthority
  ) {
    throw new ManifestError(
      "Manifest upgradeAuthority does not match the backend's configured authority"
    );
  }

  const prevPayload = current.payload;

  const newPayload: DeploymentManifestPayload = {
    ...prevPayload,
    contractId: next.contractId,
    wasmHash: next.wasmHash,
    interfaceVersion: next.interfaceVersion,
    signedAt: next.signedAt ?? new Date().toISOString(),
    generation: prevPayload.generation + 1,
  };
  validateManifestPayload(newPayload);

  const rotationEntry: ManifestRotationEntry = {
    generation: prevPayload.generation,
    contractId: prevPayload.contractId,
    wasmHash: prevPayload.wasmHash,
    interfaceVersion: prevPayload.interfaceVersion,
    signedAt: prevPayload.signedAt,
    signature: current.signature,
    recordedAt: new Date().toISOString(),
    notes: next.notes,
  };

  return {
    schemaVersion: 1,
    payload: newPayload,
    signature: signManifest(newPayload),
    rotation: [rotationEntry, ...current.rotation],
  };
}
