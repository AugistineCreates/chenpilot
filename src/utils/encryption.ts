import crypto from "crypto";
import config from "../config/config";

const ALGORITHM = "aes-256-gcm";
const ENVELOPE_PREFIX = "cpenc1";
const ENVELOPE_VERSION = 1;
const LEGACY_KEY_ID = "legacy";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export interface CiphertextMetadata {
  version: number;
  algorithm: typeof ALGORITHM;
  keyId: string;
  legacy: boolean;
}

interface EnvelopeHeader {
  v: number;
  alg: typeof ALGORITHM;
  kid: string;
}

interface Keyring {
  activeKeyId: string;
  keys: Map<string, Buffer>;
  revokedKeyIds: Set<string>;
}

function decodeKey(keyId: string, value: unknown): Buffer {
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new Error(
      "Encryption key identifiers must use 1-64 letters, digits, '.', '_' or '-'"
    );
  }
  if (typeof value !== "string" || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      `Encryption key '${keyId}' must be a 64-character hex string`
    );
  }
  return Buffer.from(value, "hex");
}

function loadKeyring(): Keyring {
  const configured = process.env.ENCRYPTION_KEYS_JSON?.trim();
  const keys = new Map<string, Buffer>();

  if (configured) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(configured);
    } catch {
      throw new Error("ENCRYPTION_KEYS_JSON must be a JSON object");
    }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("ENCRYPTION_KEYS_JSON must be a JSON object");
    }
    for (const [keyId, value] of Object.entries(parsed)) {
      keys.set(keyId, decodeKey(keyId, value));
    }
  } else if (config.encryptionKey) {
    keys.set(LEGACY_KEY_ID, decodeKey(LEGACY_KEY_ID, config.encryptionKey));
  }

  const activeKeyId =
    process.env.ENCRYPTION_ACTIVE_KEY_ID?.trim() ||
    (configured ? "" : LEGACY_KEY_ID);
  if (!activeKeyId || !keys.has(activeKeyId)) {
    throw new Error(
      "ENCRYPTION_ACTIVE_KEY_ID must identify a configured encryption key"
    );
  }

  const revokedKeyIds = new Set(
    (process.env.ENCRYPTION_REVOKED_KEY_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  if (revokedKeyIds.has(activeKeyId)) {
    throw new Error("The active encryption key cannot be revoked");
  }

  return { activeKeyId, keys, revokedKeyIds };
}

function requireReadableKey(keyring: Keyring, keyId: string): Buffer {
  if (keyring.revokedKeyIds.has(keyId)) {
    throw new Error(`Encryption key '${keyId}' has been revoked`);
  }
  const key = keyring.keys.get(keyId);
  if (!key) {
    throw new Error(`Encryption key '${keyId}' is not configured`);
  }
  return key;
}

function parseEnvelope(ciphertext: string): {
  metadata: CiphertextMetadata;
  headerSegment: string;
  iv: Buffer;
  authTag: Buffer;
  encrypted: Buffer;
} {
  const parts = ciphertext.split(".");
  if (parts.length !== 5 || parts[0] !== ENVELOPE_PREFIX) {
    throw new Error("Malformed encrypted envelope");
  }

  let header: EnvelopeHeader;
  try {
    header = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("Malformed encrypted envelope header");
  }
  if (
    header.v !== ENVELOPE_VERSION ||
    header.alg !== ALGORITHM ||
    typeof header.kid !== "string" ||
    !KEY_ID_PATTERN.test(header.kid)
  ) {
    throw new Error("Unsupported encrypted envelope metadata");
  }

  const iv = Buffer.from(parts[2], "base64url");
  const authTag = Buffer.from(parts[3], "base64url");
  const encrypted = Buffer.from(parts[4], "base64url");
  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Malformed encrypted envelope payload");
  }

  return {
    metadata: {
      version: header.v,
      algorithm: header.alg,
      keyId: header.kid,
      legacy: false,
    },
    headerSegment: parts[1],
    iv,
    authTag,
    encrypted,
  };
}

export function getActiveEncryptionKeyId(): string {
  return loadKeyring().activeKeyId;
}

export function inspectCiphertext(ciphertext: string): CiphertextMetadata {
  if (!ciphertext.startsWith(`${ENVELOPE_PREFIX}.`)) {
    return {
      version: 0,
      algorithm: ALGORITHM,
      keyId: LEGACY_KEY_ID,
      legacy: true,
    };
  }
  return parseEnvelope(ciphertext).metadata;
}

export function encrypt(plaintext: string): string {
  const keyring = loadKeyring();
  const key = requireReadableKey(keyring, keyring.activeKeyId);
  const iv = crypto.randomBytes(IV_LENGTH);
  const header: EnvelopeHeader = {
    v: ENVELOPE_VERSION,
    alg: ALGORITHM,
    kid: keyring.activeKeyId,
  };
  const headerSegment = Buffer.from(JSON.stringify(header)).toString(
    "base64url"
  );
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(headerSegment, "utf8"));
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    ENVELOPE_PREFIX,
    headerSegment,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decrypt(ciphertext: string): string {
  const keyring = loadKeyring();

  if (ciphertext.startsWith(`${ENVELOPE_PREFIX}.`)) {
    const envelope = parseEnvelope(ciphertext);
    const key = requireReadableKey(keyring, envelope.metadata.keyId);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, envelope.iv);
    decipher.setAAD(Buffer.from(envelope.headerSegment, "utf8"));
    decipher.setAuthTag(envelope.authTag);
    return Buffer.concat([
      decipher.update(envelope.encrypted),
      decipher.final(),
    ]).toString("utf8");
  }

  // Legacy records contain IV + auth tag + ciphertext and are deliberately
  // readable only through ENCRYPTION_KEY during the compatibility window.
  const legacyKeyValue = process.env.ENCRYPTION_KEY || config.encryptionKey;
  const legacyKey = decodeKey(LEGACY_KEY_ID, legacyKeyValue);
  if (keyring.revokedKeyIds.has(LEGACY_KEY_ID)) {
    throw new Error("Encryption key 'legacy' has been revoked");
  }
  const combined = Buffer.from(ciphertext, "base64");
  if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Malformed legacy ciphertext");
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    legacyKey,
    combined.subarray(0, IV_LENGTH)
  );
  decipher.setAuthTag(
    combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  );
  return Buffer.concat([
    decipher.update(combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH)),
    decipher.final(),
  ]).toString("utf8");
}
