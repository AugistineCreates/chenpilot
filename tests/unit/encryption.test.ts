import crypto from "crypto";
import {
  decrypt,
  encrypt,
  inspectCiphertext,
} from "../../src/utils/encryption";

const LEGACY_KEY = "11".repeat(32);
const OLD_KEY = "22".repeat(32);
const NEW_KEY = "33".repeat(32);

function legacyEncrypt(plaintext: string): string {
  const iv = Buffer.alloc(12, 7);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    Buffer.from(LEGACY_KEY, "hex"),
    iv
  );
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

describe("versioned encryption envelopes", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = LEGACY_KEY;
    process.env.ENCRYPTION_KEYS_JSON = JSON.stringify({
      old: OLD_KEY,
      next: NEW_KEY,
    });
    process.env.ENCRYPTION_ACTIVE_KEY_ID = "next";
    delete process.env.ENCRYPTION_REVOKED_KEY_IDS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("identifies and authenticates the algorithm and active key version", () => {
    const ciphertext = encrypt("account-secret");

    expect(inspectCiphertext(ciphertext)).toEqual({
      version: 1,
      algorithm: "aes-256-gcm",
      keyId: "next",
      legacy: false,
    });
    expect(decrypt(ciphertext)).toBe("account-secret");

    const parts = ciphertext.split(".");
    parts[1] = Buffer.from(
      JSON.stringify({ v: 1, alg: "aes-256-gcm", kid: "old" })
    ).toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });

  it("dual-reads legacy ciphertext while writing only the active version", () => {
    const legacy = legacyEncrypt("legacy-secret");

    expect(inspectCiphertext(legacy).keyId).toBe("legacy");
    expect(decrypt(legacy)).toBe("legacy-secret");
    expect(inspectCiphertext(encrypt("new-secret")).keyId).toBe("next");
  });

  it("fails closed for malformed, missing, and revoked keys", () => {
    expect(() => decrypt("too-short")).toThrow("Malformed legacy ciphertext");

    const ciphertext = encrypt("secret");
    process.env.ENCRYPTION_KEYS_JSON = JSON.stringify({ old: OLD_KEY });
    process.env.ENCRYPTION_ACTIVE_KEY_ID = "old";
    expect(() => decrypt(ciphertext)).toThrow("is not configured");

    process.env.ENCRYPTION_KEYS_JSON = JSON.stringify({
      old: OLD_KEY,
      next: NEW_KEY,
    });
    process.env.ENCRYPTION_REVOKED_KEY_IDS = "next";
    expect(() => decrypt(ciphertext)).toThrow("has been revoked");
  });

  it("rejects invalid configuration and boundary batch identifiers", () => {
    process.env.ENCRYPTION_KEYS_JSON = JSON.stringify({
      "invalid key": NEW_KEY,
    });
    expect(() => encrypt("secret")).toThrow("Encryption key identifiers");

    process.env.ENCRYPTION_KEYS_JSON = "[]";
    expect(() => encrypt("secret")).toThrow("must be a JSON object");
  });
});
