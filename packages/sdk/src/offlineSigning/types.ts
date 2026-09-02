/**
 * Types for offline (air-gapped) transaction preparation and signing.
 *
 * The flow this models has three hosts, which may be three machines:
 *
 *  1. **Preparer** (online) builds an unsigned transaction and emits a
 *     self-describing, integrity-checked {@link OfflineSigningArtifact}.
 *  2. **Reviewer/signer** (offline) verifies the artifact, renders a
 *     human-readable {@link ArtifactReview}, and produces an
 *     {@link OfflineSignature} without any network access.
 *  3. **Submitter** (online) merges the collected signatures and submits.
 *
 * Everything here is plain JSON so artifacts can cross an air gap as a file
 * or QR code, and every stage can independently verify it was not tampered
 * with in transit.
 */

/** Schema version of the artifact envelope. */
export const OFFLINE_ARTIFACT_VERSION = 1;

/** Input describing what should be signed offline. */
export interface OfflineSigningRequest {
  /** Unsigned transaction envelope, base64 XDR. */
  transactionXdr: string;
  /** Network passphrase the signature will be bound to. */
  networkPassphrase: string;
  /**
   * Optional declared network identity (`"testnet"` | `"mainnet"`) for
   * validation. When set, a passphrase that resolves to a different network
   * is rejected at preparation time.
   */
  expectedNetwork?: "testnet" | "mainnet";
  /** Source account of the transaction (`G...`). */
  sourceAccount: string;
  /** Accounts whose signatures are acceptable. */
  expectedSigners: string[];
  /** Signatures required. Defaults to `expectedSigners.length`. */
  threshold?: number;
  /** Absolute epoch milliseconds after which the artifact is refused. */
  expiresAt?: number;
  /**
   * Human-readable description of each operation, shown during offline
   * review. `OperationPlan.summary` from the advanced operations package
   * plugs straight in here.
   */
  summary?: string[];
  /** Free-form annotations carried through untouched. */
  metadata?: Record<string, unknown>;
}

/** The canonical, digest-covered body of an artifact. */
export interface OfflineSigningPayload {
  transactionXdr: string;
  networkPassphrase: string;
  expectedNetwork?: "testnet" | "mainnet";
  sourceAccount: string;
  expectedSigners: string[];
  threshold: number;
  summary: string[];
  metadata: Record<string, unknown>;
}

/** A portable, integrity-checked signing request. */
export interface OfflineSigningArtifact {
  version: number;
  artifactId: string;
  createdAt: number;
  expiresAt?: number;
  payload: OfflineSigningPayload;
  /** Hex SHA-256 over the canonical serialization of `payload`. */
  digest: string;
}

/** A signature collected out of band. */
export interface OfflineSignature {
  /** Signing account (`G...`). Must appear in `expectedSigners`. */
  signer: string;
  /** Signature bytes, base64 encoded. */
  signature: string;
  /** When the signature was produced. */
  signedAt: number;
  /**
   * Digest of the artifact the signer actually reviewed. Compared against the
   * bundle's digest so a signature for a different transaction is rejected.
   */
  artifactDigest: string;
  /** Optional device or provider identifier for auditing. */
  signerDevice?: string;
}

/** An artifact plus the signatures gathered for it so far. */
export interface OfflineSigningBundle {
  artifact: OfflineSigningArtifact;
  signatures: OfflineSignature[];
}

/** Per-signer progress shown during review. */
export interface ReviewSigner {
  address: string;
  signed: boolean;
  signedAt?: number;
}

/**
 * Everything an offline operator needs to decide whether to sign, derived
 * entirely from the artifact with no network calls.
 */
export interface ArtifactReview {
  artifactId: string;
  digest: string;
  /** True when the recomputed digest matches the declared one. */
  digestValid: boolean;
  networkPassphrase: string;
  sourceAccount: string;
  createdAt: number;
  expiresAt?: number;
  expired: boolean;
  /** One line per operation, in submission order. */
  operations: string[];
  signers: ReviewSigner[];
  threshold: number;
  collected: number;
  /** True when enough valid signatures have been collected. */
  satisfied: boolean;
  /** Non-fatal observations the operator should read before signing. */
  warnings: string[];
}

/** The result of finalizing a fully signed bundle. */
export interface FinalizedOfflineTransaction {
  transactionXdr: string;
  networkPassphrase: string;
  signatures: OfflineSignature[];
  finalizedAt: number;
}
