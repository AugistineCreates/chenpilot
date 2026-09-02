/**
 * ContractIdentity tests (Issue #676).
 *
 * Covers: Ed25519 manifest signing/verification, payload invariants, signature
 * tamper-detection, signed + auditable rotation, testnet/mainnet network
 * separation at the store level, and the runtime mutation gate.
 */

import crypto from "crypto";
import os from "os";
import path from "path";
import fs from "fs";
import {
  canonicalizeManifest,
  createSignedManifest,
  deriveUpgradeAuthority,
  rotateManifest,
  validateManifestPayload,
  verifyManifestSignature,
  verifySignedManifest,
  resolveContractKeyByContractId,
  assertCodeIdentityAllowsMutationByContractId,
  FileManifestStore,
} from "../../src/ContractIdentity";
import {
  CodeIdentityMismatchError,
  MissingManifestError,
} from "../../src/ContractIdentity";
import { IdentityVerificationService } from "../../src/ContractIdentity";
import type { ChainIdentityProvider } from "../../src/ContractIdentity";
import type { ManifestNetwork } from "../../src/ContractIdentity";

// ─── Test fixtures ────────────────────────────────────────────────────────────

let signingPem = "";
let authorityPubKey = "";

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    contractName: "core_vault",
    network: "testnet" as const,
    contractId: "CAS3N7F3XK2B3K7X3X3X3X3X3X3X3X3X3X3X3X3X3X3X3X3X3X3X3",
    wasmHash:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    interfaceVersion: "1.0.0",
    dependencies: ["rbac"],
    upgradeAuthority: authorityPubKey,
    signedAt: "2026-01-01T00:00:00.000Z",
    generation: 0,
    ...overrides,
  };
}

function makeChainProvider(
  match: boolean,
  reason?: string
): ChainIdentityProvider {
  return {
    name: "fake",
    async lookupCodeIdentity() {
      return match
        ? { match: true, observedWasmHash: makePayload().wasmHash }
        : { match: false, reason };
    },
  };
}

beforeAll(() => {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  signingPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  process.env.MANIFEST_SIGNING_KEY = signingPem;
  authorityPubKey = deriveUpgradeAuthority();
});

// ─── Signing & verification ───────────────────────────────────────────────────

describe("deploymentManifest signing", () => {
  it("creates a signed manifest whose signature verifies", () => {
    const manifest = createSignedManifest(makePayload());
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.rotation).toEqual([]);
    expect(verifySignedManifest(manifest).valid).toBe(true);
  });

  it("verification fails when the payload is tampered with", () => {
    const manifest = createSignedManifest(makePayload());
    const tampered = {
      ...manifest,
      payload: {
        ...manifest.payload,
        contractId:
          "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
    };
    const result = verifySignedManifest(tampered);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Self-signature invalid");
  });

  it("verification fails when the signing key does not match the authority", () => {
    const other = crypto.generateKeyPairSync("ed25519");
    const otherPub = Buffer.from(
      (
        other.publicKey.export({ type: "spki", format: "der" }) as Buffer
      ).subarray(-32)
    ).toString("hex");
    const payload = makePayload({ upgradeAuthority: otherPub });
    const manifest = createSignedManifest(payload);
    // Signed by the configured key, but manifest claims a different authority.
    expect(verifySignedManifest(manifest).valid).toBe(false);
  });

  it("signature does not verify against the wrong public key", () => {
    const payload = makePayload();
    const signature = (() => {
      const keyPair = crypto.generateKeyPairSync("ed25519");
      process.env.MANIFEST_SIGNING_KEY = keyPair.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString();
      try {
        return crypto
          .sign(
            null,
            Buffer.from(canonicalizeManifest(payload), "utf8"),
            keyPair.privateKey
          )
          .toString("base64");
      } finally {
        process.env.MANIFEST_SIGNING_KEY = signingPem;
      }
    })();
    const result = verifyManifestSignature(payload, signature, authorityPubKey);
    expect(result.valid).toBe(false);
  });

  it("canonicalization is deterministic regardless of key order", () => {
    const a = canonicalizeManifest(makePayload());
    const scrambled = {
      generation: 0,
      signedAt: "2026-01-01T00:00:00.000Z",
      upgradeAuthority: authorityPubKey,
      dependencies: ["rbac"],
      interfaceVersion: "1.0.0",
      wasmHash: makePayload().wasmHash,
      contractId: makePayload().contractId,
      network: "testnet",
      contractName: "core_vault",
    };
    expect(a).toBe(canonicalizeManifest(scrambled as never));
  });
});

describe("validateManifestPayload", () => {
  it("rejects a malformed wasmHash", () => {
    expect(() =>
      validateManifestPayload(makePayload({ wasmHash: "zz" }))
    ).toThrow(/wasmHash/);
  });

  it("rejects a contractId that does not start with C", () => {
    expect(() =>
      validateManifestPayload(makePayload({ contractId: "GAAAA" }))
    ).toThrow(/contractId/);
  });

  it("rejects an invalid network", () => {
    expect(() =>
      validateManifestPayload(makePayload({ network: "futurenet" }))
    ).toThrow(/network/);
  });

  it("rejects a negative generation", () => {
    expect(() =>
      validateManifestPayload(makePayload({ generation: -1 }))
    ).toThrow(/generation/);
  });
});

// ─── Rotation ─────────────────────────────────────────────────────────────────

describe("rotateManifest", () => {
  it("produces a signed, append-only rotation history", () => {
    const current = createSignedManifest(makePayload());
    const rotated = rotateManifest(
      current,
      {
        contractId:
          "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        wasmHash:
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        interfaceVersion: "1.0.1",
        notes: "upgrade",
      },
      authorityPubKey
    );

    expect(rotated.payload.generation).toBe(1);
    expect(rotated.rotation).toHaveLength(1);
    expect(rotated.rotation[0].generation).toBe(0);
    expect(rotated.rotation[0].notes).toBe("upgrade");
    expect(rotated.rotation[0].contractId).toBe(current.payload.contractId);
    // Whole rotated doc is self-consistent.
    expect(verifySignedManifest(rotated).valid).toBe(true);
  });

  it("rejects rotation across networks (testnet/mainnet separation)", () => {
    const current = createSignedManifest(makePayload({ network: "testnet" }));
    // Simulate forging a mainnet manifest by changing the network.
    const forged = {
      ...current,
      payload: { ...current.payload, network: "mainnet" },
    };
    expect(() =>
      rotateManifest(
        forged,
        {
          contractId:
            "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          wasmHash:
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          interfaceVersion: "1.0.1",
        },
        authorityPubKey
      )
    ).toThrow(/untrusted manifest/);
  });

  it("rejects rotation when authority does not match", () => {
    const current = createSignedManifest(makePayload());
    expect(() =>
      rotateManifest(
        current,
        {
          contractId:
            "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          wasmHash:
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          interfaceVersion: "1.0.1",
        },
        "abcd00000000000000000000000000000000000000000000000000000000000000"
      )
    ).toThrow(/does not match the backend/);
  });
});

// ─── Store network separation ─────────────────────────────────────────────────

describe("FileManifestStore network separation", () => {
  const tmpDir = path.join(os.tmpdir(), `manifest-store-${process.pid}`);
  let store: FileManifestStore;

  beforeEach(() => {
    store = new FileManifestStore(tmpDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores testnet and mainnet manifests in separate files", async () => {
    const testnet = createSignedManifest(makePayload({ network: "testnet" }));
    const mainnet = createSignedManifest(
      makePayload({
        network: "mainnet",
        contractId:
          "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      })
    );
    await store.save(testnet);
    await store.save(mainnet);

    const loadedTestnet = await store.load("testnet", "core_vault");
    const loadedMainnet = await store.load("mainnet", "core_vault");
    expect(loadedTestnet?.payload.network).toBe("testnet");
    expect(loadedMainnet?.payload.network).toBe("mainnet");
    // Identities are distinct and not overwritten across networks.
    expect(loadedTestnet?.payload.contractId).not.toBe(
      loadedMainnet?.payload.contractId
    );
  });
});

// ─── Identity gate (mutation blocking) ────────────────────────────────────────

describe("IdentityVerificationService assertCanMutate", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-identity-"));
    process.env.MANIFEST_ENFORCEMENT = "enforce";
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.env.MANIFEST_ENFORCEMENT = "";
  });

  it("blocks mutating traffic on a code-identity mismatch", async () => {
    const store = new FileManifestStore(tmpDir);
    await store.save(createSignedManifest(makePayload()));
    const service = new IdentityVerificationService(
      makeChainProvider(false, "no contract code"),
      store
    );
    await service.verifyAll();

    expect(() => service.assertCanMutate("core_vault")).toThrow(
      CodeIdentityMismatchError
    );
  });

  it("blocks when no manifest exists for an active contract (enforced)", async () => {
    const service = new IdentityVerificationService(
      makeChainProvider(true),
      new FileManifestStore(tmpDir)
    );
    await service.verifyAll();
    // core_vault is an active contract but has no manifest on disk.
    expect(() => service.assertCanMutate("core_vault")).toThrow(
      MissingManifestError
    );
  });

  it("allows mutation when chain identity matches and manifest is present", async () => {
    const store = new FileManifestStore(tmpDir);
    await store.save(createSignedManifest(makePayload()));
    const service = new IdentityVerificationService(
      makeChainProvider(true),
      store
    );
    await service.verifyAll();
    expect(() => service.assertCanMutate("core_vault")).not.toThrow();
  });
});

// ─── contractId-based gate (invoker integration) ──────────────────────────────

describe("resolveContractKeyByContractId / assertCodeIdentityAllowsMutationByContractId", () => {
  const contractId = makePayload().contractId;

  beforeEach(() => {
    process.env.CORE_VAULT_CONTRACT_ID = contractId;
    process.env.MANIFEST_ENFORCEMENT = "enforce";
  });

  afterEach(() => {
    delete process.env.CORE_VAULT_CONTRACT_ID;
    process.env.MANIFEST_ENFORCEMENT = "";
  });

  it("resolves a registered contract ID to its logical key on the active network", () => {
    expect(
      resolveContractKeyByContractId(contractId, "testnet" as ManifestNetwork)
    ).toBe("core_vault");
  });

  it("returns undefined for an unregistered/foreign contract ID", () => {
    expect(
      resolveContractKeyByContractId(
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "testnet"
      )
    ).toBeUndefined();
  });

  it("does not gate a mutating call targeting a non-active network (network separation)", () => {
    // Backend operates on testnet; a mainnet-bound invocation must pass un-gated.
    expect(() =>
      assertCodeIdentityAllowsMutationByContractId(
        contractId,
        "mainnet" as ManifestNetwork
      )
    ).not.toThrow();
  });

  it("gates a registered contract mutation on the active network when no manifest is trusted", () => {
    // The singleton identityVerificationService cache is empty (verifyAll never
    // ran in this test) so a registered contract mutation is blocked.
    expect(() =>
      assertCodeIdentityAllowsMutationByContractId(
        contractId,
        "testnet" as ManifestNetwork
      )
    ).toThrow(MissingManifestError);
  });
});
