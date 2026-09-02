/**
 * Offline (air-gapped) signing coordinator.
 *
 * Prepares signing artifacts on a connected host, produces reviewable
 * summaries on a disconnected host, and merges out-of-band signatures back
 * together. The module deliberately imports nothing beyond Node's built-in
 * `crypto`, so it runs unchanged on a machine with no network stack and no
 * Stellar SDK installed.
 */

import { createHash, randomBytes } from "crypto";

import type { ValidationIssue, ValidationReport } from "../advancedOps/types";
import { error, isAccountId, toReport, warning } from "../advancedOps/validation";
import { resolveNetworkFromPassphrase } from "../networkIdentity";
import {
  OFFLINE_ARTIFACT_VERSION,
  type ArtifactReview,
  type FinalizedOfflineTransaction,
  type OfflineSignature,
  type OfflineSigningArtifact,
  type OfflineSigningBundle,
  type OfflineSigningPayload,
  type OfflineSigningRequest,
  type ReviewSigner,
} from "./types";

/**
 * Serialize a value with deterministic key ordering.
 *
 * Two hosts must derive byte-identical input for the digest, so ordinary
 * `JSON.stringify` insertion order is not good enough.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, v]) => `${JSON.stringify(key)}:${canonicalize(v)}`)
    .join(",")}}`;
}

/** Hex SHA-256 over the canonical serialization of an artifact payload. */
export function computeArtifactDigest(payload: OfflineSigningPayload): string {
  return createHash("sha256").update(canonicalize(payload), "utf8").digest("hex");
}

/** Validate a signing request before an artifact is minted. */
export function validateSigningRequest(
  request: OfflineSigningRequest
): ValidationReport {
  const issues: ValidationIssue[] = [];

  if (!request || typeof request !== "object") {
    return toReport([error("", "MISSING_REQUEST", "A signing request is required")]);
  }

  if (typeof request.transactionXdr !== "string" || request.transactionXdr.trim() === "") {
    issues.push(
      error("transactionXdr", "MISSING_TRANSACTION", "An unsigned transaction XDR is required")
    );
  }

  if (
    typeof request.networkPassphrase !== "string" ||
    request.networkPassphrase.trim() === ""
  ) {
    issues.push(
      error(
        "networkPassphrase",
        "MISSING_NETWORK",
        "A network passphrase is required so signatures cannot be replayed across networks"
      )
    );
  } else if (request.expectedNetwork !== undefined) {
    // LOCAL, offline check: the declared network must agree with the
    // passphrase that the signature will actually be bound to.
    const resolved = resolveNetworkFromPassphrase(request.networkPassphrase);
    if (resolved === undefined) {
      issues.push(
        error(
          "networkPassphrase",
          "UNRECOGNIZED_NETWORK",
          "The network passphrase maps to no recognized Stellar network"
        )
      );
    } else if (resolved !== request.expectedNetwork) {
      issues.push(
        error(
          "expectedNetwork",
          "NETWORK_MISMATCH",
          `Expected network "${request.expectedNetwork}" but the passphrase resolves to "${resolved}"`
        )
      );
    }
  }

  if (!isAccountId(request.sourceAccount)) {
    issues.push(
      error("sourceAccount", "INVALID_ACCOUNT_ID", "Source account must be a valid account id (G...)")
    );
  }

  if (!Array.isArray(request.expectedSigners) || request.expectedSigners.length === 0) {
    issues.push(
      error("expectedSigners", "MISSING_SIGNERS", "At least one expected signer is required")
    );
  } else {
    request.expectedSigners.forEach((signer, index) => {
      if (!isAccountId(signer)) {
        issues.push(
          error(
            `expectedSigners[${index}]`,
            "INVALID_ACCOUNT_ID",
            "Expected signer must be a valid account id (G...)"
          )
        );
      }
    });
    if (new Set(request.expectedSigners).size !== request.expectedSigners.length) {
      issues.push(
        warning("expectedSigners", "DUPLICATE_SIGNERS", "Duplicate expected signers were supplied")
      );
    }
  }

  if (request.threshold !== undefined) {
    const signerCount = Array.isArray(request.expectedSigners)
      ? request.expectedSigners.length
      : 0;
    if (!Number.isInteger(request.threshold) || request.threshold < 1) {
      issues.push(error("threshold", "INVALID_THRESHOLD", "Threshold must be a positive integer"));
    } else if (request.threshold > signerCount) {
      issues.push(
        error(
          "threshold",
          "UNREACHABLE_THRESHOLD",
          `Threshold ${request.threshold} exceeds the ${signerCount} expected signer(s)`
        )
      );
    }
  }

  if (request.expiresAt !== undefined && !Number.isFinite(request.expiresAt)) {
    issues.push(error("expiresAt", "INVALID_EXPIRY", "Expiry must be epoch milliseconds"));
  }

  return toReport(issues);
}

/** Options accepted by {@link prepareOfflineSigning}. */
export interface PrepareOptions {
  /** Injectable clock; defaults to `Date.now`. */
  now?: () => number;
  /** Injectable id generator, useful for deterministic tests. */
  idFactory?: () => string;
}

function defaultArtifactId(): string {
  return `oart_${randomBytes(8).toString("hex")}`;
}

/**
 * Build a portable, integrity-checked artifact from a signing request.
 *
 * @throws {Error} when the request fails {@link validateSigningRequest}.
 */
export function prepareOfflineSigning(
  request: OfflineSigningRequest,
  options: PrepareOptions = {}
): OfflineSigningArtifact {
  const report = validateSigningRequest(request);
  if (!report.valid) {
    throw new Error(
      `Cannot prepare offline signing: ${report.errors
        .map((issue) => `${issue.field}: ${issue.message}`)
        .join("; ")}`
    );
  }

  const payload: OfflineSigningPayload = {
    transactionXdr: request.transactionXdr,
    networkPassphrase: request.networkPassphrase,
    ...(request.expectedNetwork !== undefined
      ? { expectedNetwork: request.expectedNetwork }
      : {}),
    sourceAccount: request.sourceAccount,
    expectedSigners: [...request.expectedSigners],
    threshold: request.threshold ?? request.expectedSigners.length,
    summary: request.summary ? [...request.summary] : [],
    metadata: request.metadata ?? {},
  };

  const now = options.now ?? (() => Date.now());
  return {
    version: OFFLINE_ARTIFACT_VERSION,
    artifactId: (options.idFactory ?? defaultArtifactId)(),
    createdAt: now(),
    ...(request.expiresAt !== undefined ? { expiresAt: request.expiresAt } : {}),
    payload,
    digest: computeArtifactDigest(payload),
  };
}

/** True when the artifact's declared digest matches its payload. */
export function isArtifactIntact(artifact: OfflineSigningArtifact): boolean {
  return computeArtifactDigest(artifact.payload) === artifact.digest;
}

/** Serialize an artifact for transport across the air gap. */
export function serializeArtifact(artifact: OfflineSigningArtifact): string {
  return canonicalize(artifact);
}

/**
 * Parse and verify an artifact received across the air gap.
 *
 * @throws {Error} when the JSON is malformed, the schema version is
 * unsupported, or the digest does not match.
 */
export function deserializeArtifact(serialized: string): OfflineSigningArtifact {
  let parsed: OfflineSigningArtifact;
  try {
    parsed = JSON.parse(serialized) as OfflineSigningArtifact;
  } catch (caught) {
    throw new Error(
      `Malformed offline artifact: ${caught instanceof Error ? caught.message : String(caught)}`
    );
  }

  if (!parsed || typeof parsed !== "object" || !parsed.payload) {
    throw new Error("Malformed offline artifact: missing payload");
  }
  if (parsed.version !== OFFLINE_ARTIFACT_VERSION) {
    throw new Error(
      `Unsupported offline artifact version ${String(parsed.version)}; expected ${OFFLINE_ARTIFACT_VERSION}`
    );
  }
  if (!isArtifactIntact(parsed)) {
    throw new Error("Offline artifact digest mismatch; the payload was altered in transit");
  }
  return parsed;
}

/** Start an empty bundle for an artifact. */
export function createBundle(artifact: OfflineSigningArtifact): OfflineSigningBundle {
  return { artifact, signatures: [] };
}

/** Validate a signature against the bundle it claims to belong to. */
export function validateSignature(
  bundle: OfflineSigningBundle,
  signature: OfflineSignature
): ValidationReport {
  const issues: ValidationIssue[] = [];

  if (!signature || typeof signature !== "object") {
    return toReport([error("", "MISSING_SIGNATURE", "A signature is required")]);
  }

  if (signature.artifactDigest !== bundle.artifact.digest) {
    issues.push(
      error(
        "artifactDigest",
        "DIGEST_MISMATCH",
        "Signature was produced for a different artifact"
      )
    );
  }

  if (!bundle.artifact.payload.expectedSigners.includes(signature.signer)) {
    issues.push(
      error("signer", "UNEXPECTED_SIGNER", `${signature.signer} is not an expected signer`)
    );
  }

  if (typeof signature.signature !== "string" || signature.signature.trim() === "") {
    issues.push(error("signature", "MISSING_SIGNATURE_BYTES", "Signature bytes are required"));
  }

  if (bundle.signatures.some((existing) => existing.signer === signature.signer)) {
    issues.push(
      error("signer", "DUPLICATE_SIGNATURE", `${signature.signer} already signed this artifact`)
    );
  }

  return toReport(issues);
}

/**
 * Attach a signature, returning a new bundle.
 *
 * @throws {Error} when the signature fails {@link validateSignature}.
 */
export function attachSignature(
  bundle: OfflineSigningBundle,
  signature: OfflineSignature
): OfflineSigningBundle {
  const report = validateSignature(bundle, signature);
  if (!report.valid) {
    throw new Error(
      `Cannot attach signature: ${report.errors.map((issue) => issue.message).join("; ")}`
    );
  }
  return { artifact: bundle.artifact, signatures: [...bundle.signatures, signature] };
}

/** True when the bundle holds at least `threshold` signatures. */
export function isThresholdMet(bundle: OfflineSigningBundle): boolean {
  return bundle.signatures.length >= bundle.artifact.payload.threshold;
}

/**
 * Produce the human-readable review an offline operator inspects before
 * signing. Performs no network calls and never throws.
 */
export function reviewArtifact(
  bundle: OfflineSigningBundle,
  now: number = Date.now()
): ArtifactReview {
  const { artifact } = bundle;
  const { payload } = artifact;
  const digestValid = isArtifactIntact(artifact);
  const expired = artifact.expiresAt !== undefined && now > artifact.expiresAt;

  const signers: ReviewSigner[] = payload.expectedSigners.map((address) => {
    const match = bundle.signatures.find((signature) => signature.signer === address);
    return {
      address,
      signed: Boolean(match),
      ...(match ? { signedAt: match.signedAt } : {}),
    };
  });

  const warnings: string[] = [];
  if (!digestValid) {
    warnings.push("Artifact digest does not match its payload; do not sign.");
  }
  if (expired) {
    warnings.push("Artifact has expired; request a freshly prepared transaction.");
  }
  if (payload.summary.length === 0) {
    warnings.push("Artifact carries no operation summary; contents cannot be reviewed offline.");
  }
  const foreign = bundle.signatures.filter(
    (signature) => !payload.expectedSigners.includes(signature.signer)
  );
  if (foreign.length > 0) {
    warnings.push(`${foreign.length} signature(s) come from unexpected signers.`);
  }

  const collected = bundle.signatures.filter((signature) =>
    payload.expectedSigners.includes(signature.signer)
  ).length;

  return {
    artifactId: artifact.artifactId,
    digest: artifact.digest,
    digestValid,
    networkPassphrase: payload.networkPassphrase,
    sourceAccount: payload.sourceAccount,
    createdAt: artifact.createdAt,
    ...(artifact.expiresAt !== undefined ? { expiresAt: artifact.expiresAt } : {}),
    expired,
    operations: [...payload.summary],
    signers,
    threshold: payload.threshold,
    collected,
    satisfied: digestValid && !expired && collected >= payload.threshold,
    warnings,
  };
}

/**
 * Merge collected signatures into a submittable result.
 *
 * @throws {Error} when the artifact is corrupt or expired, or the signature
 * threshold has not been met.
 */
export function finalizeBundle(
  bundle: OfflineSigningBundle,
  now: number = Date.now()
): FinalizedOfflineTransaction {
  const review = reviewArtifact(bundle, now);
  if (!review.digestValid) {
    throw new Error("Cannot finalize: artifact digest mismatch");
  }
  if (review.expired) {
    throw new Error("Cannot finalize: artifact has expired");
  }
  if (!review.satisfied) {
    throw new Error(
      `Cannot finalize: ${review.collected} of ${review.threshold} required signature(s) collected`
    );
  }

  return {
    transactionXdr: bundle.artifact.payload.transactionXdr,
    networkPassphrase: bundle.artifact.payload.networkPassphrase,
    signatures: [...bundle.signatures],
    finalizedAt: now,
  };
}

/**
 * Stateful convenience wrapper around the offline signing functions.
 *
 * @example
 * ```ts
 * const coordinator = OfflineSigningCoordinator.prepare({
 *   transactionXdr,
 *   networkPassphrase,
 *   sourceAccount,
 *   expectedSigners: [signerA, signerB],
 *   summary: plan.summary,
 * });
 *
 * const transport = coordinator.serialize();   // cross the air gap
 * coordinator.addSignature(signatureFromDevice);
 * const finalized = coordinator.finalize();
 * ```
 */
export class OfflineSigningCoordinator {
  private bundle: OfflineSigningBundle;

  constructor(bundle: OfflineSigningBundle) {
    this.bundle = bundle;
  }

  /** Prepare a fresh artifact and wrap it in a coordinator. */
  static prepare(
    request: OfflineSigningRequest,
    options?: PrepareOptions
  ): OfflineSigningCoordinator {
    return new OfflineSigningCoordinator(
      createBundle(prepareOfflineSigning(request, options))
    );
  }

  /** Rehydrate a coordinator from a serialized artifact, verifying its digest. */
  static fromSerializedArtifact(serialized: string): OfflineSigningCoordinator {
    return new OfflineSigningCoordinator(createBundle(deserializeArtifact(serialized)));
  }

  /** The artifact under coordination. */
  get artifact(): OfflineSigningArtifact {
    return this.bundle.artifact;
  }

  /** A copy of the current bundle. */
  getBundle(): OfflineSigningBundle {
    return { artifact: this.bundle.artifact, signatures: [...this.bundle.signatures] };
  }

  /** Serialize the artifact for transport. */
  serialize(): string {
    return serializeArtifact(this.bundle.artifact);
  }

  /** Attach a signature collected out of band. */
  addSignature(signature: OfflineSignature): this {
    this.bundle = attachSignature(this.bundle, signature);
    return this;
  }

  /** Human-readable review of the current state. */
  review(now?: number): ArtifactReview {
    return reviewArtifact(this.bundle, now);
  }

  /** True when enough signatures have been collected. */
  isComplete(): boolean {
    return isThresholdMet(this.bundle);
  }

  /** Merge signatures into a submittable result. */
  finalize(now?: number): FinalizedOfflineTransaction {
    return finalizeBundle(this.bundle, now);
  }
}
