/**
 * Tests for offline (air-gapped) signing coordination — Issue #573
 */

import {
  OFFLINE_ARTIFACT_VERSION,
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
  type OfflineSignature,
  type OfflineSigningRequest,
} from "../offlineSigning";

const SOURCE = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const SIGNER_A = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const SIGNER_B = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ";
const PASSPHRASE = "Test SDF Network ; September 2015";

const NOW = 1_700_000_000_000;

function request(overrides: Partial<OfflineSigningRequest> = {}): OfflineSigningRequest {
  return {
    transactionXdr: "AAAAAgAAAABase64Xdr",
    networkPassphrase: PASSPHRASE,
    sourceAccount: SOURCE,
    expectedSigners: [SIGNER_A, SIGNER_B],
    summary: ["Create trustline USDC", "Attach memo"],
    ...overrides,
  };
}

function prepare(overrides: Partial<OfflineSigningRequest> = {}) {
  return prepareOfflineSigning(request(overrides), {
    now: () => NOW,
    idFactory: () => "artifact-1",
  });
}

function signature(overrides: Partial<OfflineSignature> = {}): OfflineSignature {
  return {
    signer: SIGNER_A,
    signature: "c2lnbmF0dXJlLWJ5dGVz",
    signedAt: NOW + 1_000,
    artifactDigest: prepare().digest,
    ...overrides,
  };
}

/** Signature bound to a specific artifact rather than the default one. */
function signatureFor(
  artifact: { digest: string },
  overrides: Partial<OfflineSignature> = {}
): OfflineSignature {
  return signature({ artifactDigest: artifact.digest, ...overrides });
}

describe("canonicalize", () => {
  it("orders object keys deterministically", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it("preserves array order, which is meaningful", () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it("orders keys inside nested objects too", () => {
    expect(canonicalize({ outer: { z: 1, a: 2 } })).toBe(
      canonicalize({ outer: { a: 2, z: 1 } })
    );
  });

  it("omits undefined values so they cannot change the digest", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
  });

  it("handles primitives and null", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize(7)).toBe("7");
    expect(canonicalize("x")).toBe('"x"');
  });
});

describe("computeArtifactDigest", () => {
  it("is stable across key insertion order", () => {
    const artifact = prepare();
    const reordered = {
      metadata: artifact.payload.metadata,
      summary: artifact.payload.summary,
      threshold: artifact.payload.threshold,
      expectedSigners: artifact.payload.expectedSigners,
      sourceAccount: artifact.payload.sourceAccount,
      networkPassphrase: artifact.payload.networkPassphrase,
      transactionXdr: artifact.payload.transactionXdr,
    };

    expect(computeArtifactDigest(reordered)).toBe(artifact.digest);
  });

  it("changes when any covered field changes", () => {
    const artifact = prepare();
    expect(
      computeArtifactDigest({ ...artifact.payload, transactionXdr: "different" })
    ).not.toBe(artifact.digest);
  });

  it("covers the threshold, so a signature cannot be replayed onto a weaker policy", () => {
    expect(prepare({ threshold: 1 }).digest).not.toBe(prepare({ threshold: 2 }).digest);
  });

  it("produces a 64-character hex digest", () => {
    expect(prepare().digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("validateSigningRequest", () => {
  it("accepts a well-formed request", () => {
    expect(validateSigningRequest(request()).valid).toBe(true);
  });

  it("requires a transaction envelope", () => {
    const report = validateSigningRequest(request({ transactionXdr: "  " }));
    expect(report.errors.some((issue) => issue.code === "MISSING_TRANSACTION")).toBe(
      true
    );
  });

  it("requires a network passphrase so signatures cannot be replayed", () => {
    const report = validateSigningRequest(request({ networkPassphrase: "" }));
    expect(report.errors.some((issue) => issue.code === "MISSING_NETWORK")).toBe(true);
  });

  it("rejects an invalid source account", () => {
    const report = validateSigningRequest(request({ sourceAccount: "nope" }));
    expect(report.valid).toBe(false);
  });

  it("requires at least one expected signer", () => {
    const report = validateSigningRequest(request({ expectedSigners: [] }));
    expect(report.errors.some((issue) => issue.code === "MISSING_SIGNERS")).toBe(true);
  });

  it("rejects a threshold higher than the signer count", () => {
    const report = validateSigningRequest(request({ threshold: 3 }));
    expect(report.errors.some((issue) => issue.code === "UNREACHABLE_THRESHOLD")).toBe(
      true
    );
  });

  it("rejects a non-positive threshold", () => {
    expect(validateSigningRequest(request({ threshold: 0 })).valid).toBe(false);
  });

  it("warns about duplicate expected signers without failing", () => {
    const report = validateSigningRequest(
      request({ expectedSigners: [SIGNER_A, SIGNER_A] })
    );
    expect(report.valid).toBe(true);
    expect(report.warnings.some((issue) => issue.code === "DUPLICATE_SIGNERS")).toBe(
      true
    );
  });
});

describe("prepareOfflineSigning", () => {
  it("stamps the schema version, id and creation time", () => {
    const artifact = prepare();
    expect(artifact.version).toBe(OFFLINE_ARTIFACT_VERSION);
    expect(artifact.artifactId).toBe("artifact-1");
    expect(artifact.createdAt).toBe(NOW);
  });

  it("defaults the threshold to the number of expected signers", () => {
    expect(prepare().payload.threshold).toBe(2);
  });

  it("honours an explicit threshold", () => {
    expect(prepare({ threshold: 1 }).payload.threshold).toBe(1);
  });

  it("normalizes optional fields so the digest is well-defined", () => {
    const artifact = prepare({ summary: undefined, metadata: undefined });
    expect(artifact.payload.summary).toEqual([]);
    expect(artifact.payload.metadata).toEqual({});
  });

  it("copies arrays so later mutation of the request cannot alter the artifact", () => {
    const original = request();
    const artifact = prepareOfflineSigning(original);
    original.expectedSigners.push(SOURCE);
    expect(artifact.payload.expectedSigners).toHaveLength(2);
  });

  it("throws on an invalid request", () => {
    expect(() => prepare({ sourceAccount: "bad" })).toThrow(
      /Cannot prepare offline signing/
    );
  });

  it("produces an intact artifact", () => {
    expect(isArtifactIntact(prepare())).toBe(true);
  });
});

describe("artifact transport", () => {
  it("round-trips through serialize and deserialize", () => {
    const artifact = prepare();
    const restored = deserializeArtifact(serializeArtifact(artifact));
    expect(restored).toEqual(artifact);
  });

  it("rejects malformed JSON", () => {
    expect(() => deserializeArtifact("{not json")).toThrow(/Malformed offline artifact/);
  });

  it("rejects an artifact with no payload", () => {
    expect(() => deserializeArtifact(JSON.stringify({ version: 1 }))).toThrow(
      /missing payload/
    );
  });

  it("rejects an unsupported schema version", () => {
    const artifact = { ...prepare(), version: 99 };
    expect(() => deserializeArtifact(JSON.stringify(artifact))).toThrow(
      /Unsupported offline artifact version/
    );
  });

  it("detects tampering in transit", () => {
    const artifact = prepare();
    const tampered = {
      ...artifact,
      payload: { ...artifact.payload, transactionXdr: "malicious" },
    };

    expect(isArtifactIntact(tampered)).toBe(false);
    expect(() => deserializeArtifact(JSON.stringify(tampered))).toThrow(
      /digest mismatch/
    );
  });
});

describe("signature collection", () => {
  it("accepts a matching signature", () => {
    const bundle = createBundle(prepare());
    expect(validateSignature(bundle, signature()).valid).toBe(true);
  });

  it("rejects a signature produced for another artifact", () => {
    const bundle = createBundle(prepare());
    const report = validateSignature(
      bundle,
      signature({ artifactDigest: "f".repeat(64) })
    );
    expect(report.errors.some((issue) => issue.code === "DIGEST_MISMATCH")).toBe(true);
  });

  it("rejects a signer that is not expected", () => {
    const bundle = createBundle(prepare());
    const report = validateSignature(bundle, signature({ signer: SOURCE }));
    expect(report.errors.some((issue) => issue.code === "UNEXPECTED_SIGNER")).toBe(
      true
    );
  });

  it("rejects empty signature bytes", () => {
    const bundle = createBundle(prepare());
    expect(validateSignature(bundle, signature({ signature: "  " })).valid).toBe(false);
  });

  it("rejects a duplicate signer", () => {
    const bundle = attachSignature(createBundle(prepare()), signature());
    const report = validateSignature(bundle, signature());
    expect(report.errors.some((issue) => issue.code === "DUPLICATE_SIGNATURE")).toBe(
      true
    );
  });

  it("does not mutate the original bundle when attaching", () => {
    const bundle = createBundle(prepare());
    const next = attachSignature(bundle, signature());
    expect(bundle.signatures).toHaveLength(0);
    expect(next.signatures).toHaveLength(1);
  });

  it("throws when attaching an invalid signature", () => {
    const bundle = createBundle(prepare());
    expect(() => attachSignature(bundle, signature({ signer: SOURCE }))).toThrow(
      /Cannot attach signature/
    );
  });

  it("reports threshold progress", () => {
    let bundle = createBundle(prepare());
    expect(isThresholdMet(bundle)).toBe(false);

    bundle = attachSignature(bundle, signature());
    expect(isThresholdMet(bundle)).toBe(false);

    bundle = attachSignature(bundle, signature({ signer: SIGNER_B }));
    expect(isThresholdMet(bundle)).toBe(true);
  });
});

describe("reviewArtifact", () => {
  it("lists every expected signer with its progress", () => {
    const bundle = attachSignature(createBundle(prepare()), signature());
    const review = reviewArtifact(bundle, NOW);

    expect(review.signers).toEqual([
      { address: SIGNER_A, signed: true, signedAt: NOW + 1_000 },
      { address: SIGNER_B, signed: false },
    ]);
    expect(review.collected).toBe(1);
  });

  it("exposes the operation summary for offline inspection", () => {
    const review = reviewArtifact(createBundle(prepare()), NOW);
    expect(review.operations).toEqual([
      "Create trustline USDC",
      "Attach memo",
    ]);
  });

  it("warns when there is nothing to review", () => {
    const review = reviewArtifact(createBundle(prepare({ summary: [] })), NOW);
    expect(review.warnings.some((text) => text.includes("no operation summary"))).toBe(
      true
    );
  });

  it("flags a corrupt artifact and refuses to call it satisfied", () => {
    const artifact = prepare({ threshold: 1 });
    const bundle = attachSignature(createBundle(artifact), signatureFor(artifact));
    bundle.artifact.payload.transactionXdr = "swapped-after-signing";

    const review = reviewArtifact(bundle, NOW);
    expect(review.digestValid).toBe(false);
    expect(review.satisfied).toBe(false);
    expect(review.warnings.some((text) => text.includes("do not sign"))).toBe(true);
  });

  it("flags expiry", () => {
    const artifact = prepare({ expiresAt: NOW - 1 });
    const review = reviewArtifact(createBundle(artifact), NOW);
    expect(review.expired).toBe(true);
    expect(review.satisfied).toBe(false);
  });

  it("is not expired exactly at the boundary", () => {
    const artifact = prepare({ expiresAt: NOW });
    expect(reviewArtifact(createBundle(artifact), NOW).expired).toBe(false);
  });

  it("reports satisfied once the threshold is met on an intact artifact", () => {
    const artifact = prepare({ threshold: 1 });
    const bundle = attachSignature(createBundle(artifact), signatureFor(artifact));
    expect(reviewArtifact(bundle, NOW).satisfied).toBe(true);
  });

  it("never throws, even on a corrupt bundle", () => {
    const artifact = prepare();
    artifact.digest = "0".repeat(64);
    expect(() => reviewArtifact(createBundle(artifact), NOW)).not.toThrow();
  });
});

describe("finalizeBundle", () => {
  it("returns the transaction and every signature", () => {
    const artifact = prepare({ threshold: 1 });
    const bundle = attachSignature(createBundle(artifact), signatureFor(artifact));
    const finalized = finalizeBundle(bundle, NOW);

    expect(finalized.transactionXdr).toBe(artifact.payload.transactionXdr);
    expect(finalized.networkPassphrase).toBe(PASSPHRASE);
    expect(finalized.signatures).toHaveLength(1);
    expect(finalized.finalizedAt).toBe(NOW);
  });

  it("refuses to finalize below the threshold", () => {
    const bundle = attachSignature(createBundle(prepare()), signature());
    expect(() => finalizeBundle(bundle, NOW)).toThrow(/1 of 2 required signature/);
  });

  it("refuses to finalize an expired artifact", () => {
    const artifact = prepare({ threshold: 1, expiresAt: NOW - 1 });
    const bundle = attachSignature(createBundle(artifact), signatureFor(artifact));
    expect(() => finalizeBundle(bundle, NOW)).toThrow(/has expired/);
  });

  it("refuses to finalize a corrupt artifact", () => {
    const artifact = prepare({ threshold: 1 });
    const bundle = attachSignature(createBundle(artifact), signatureFor(artifact));
    bundle.artifact.payload.sourceAccount = SIGNER_B;
    expect(() => finalizeBundle(bundle, NOW)).toThrow(/digest mismatch/);
  });
});

describe("OfflineSigningCoordinator", () => {
  it("drives the full air-gapped round trip", () => {
    const coordinator = OfflineSigningCoordinator.prepare(request({ threshold: 1 }), {
      now: () => NOW,
      idFactory: () => "artifact-1",
    });

    // Cross the air gap.
    const transported = coordinator.serialize();
    const offline = OfflineSigningCoordinator.fromSerializedArtifact(transported);

    const review = offline.review(NOW);
    expect(review.digestValid).toBe(true);
    expect(review.operations).toHaveLength(2);

    // Come back with a signature.
    coordinator.addSignature(
      signature({ artifactDigest: coordinator.artifact.digest })
    );

    expect(coordinator.isComplete()).toBe(true);
    expect(coordinator.finalize(NOW).signatures).toHaveLength(1);
  });

  it("exposes a defensive copy of its bundle", () => {
    const coordinator = OfflineSigningCoordinator.prepare(request(), {
      now: () => NOW,
      idFactory: () => "artifact-1",
    });

    coordinator.getBundle().signatures.push(signature());
    expect(coordinator.getBundle().signatures).toHaveLength(0);
  });

  it("rejects a tampered artifact at the air gap boundary", () => {
    const artifact = prepare();
    const tampered = JSON.stringify({
      ...artifact,
      payload: { ...artifact.payload, sourceAccount: SIGNER_B },
    });

    expect(() => OfflineSigningCoordinator.fromSerializedArtifact(tampered)).toThrow(
      /digest mismatch/
    );
  });
});
