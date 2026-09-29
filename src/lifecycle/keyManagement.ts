/**
 * keyManagement.ts
 *
 * Per-user envelope encryption using HKDF-derived DEKs.
 *
 * Architecture:
 *   Master Key (ENCRYPTION_KEY env)
 *       └─ HKDF(masterKey, userId, 'chenpilot-dek-v1') → per-user DEK
 *
 * Cryptographic erasure:
 *   Tombstoning a user's key record in user_key_tombstone prevents getDek()
 *   from returning the key. Any data encrypted under that DEK is effectively
 *   unreadable without the key — no plaintext removal required.
 *
 * For data already encrypted under the global ENCRYPTION_KEY (legacy path),
 * use the global encrypt/decrypt from src/utils/encryption.ts directly.
 */

import crypto from "crypto";
import { Repository } from "typeorm";
import AppDataSource from "../config/Datasource";
import { UserKeyTombstone } from "./userKeyTombstone.entity";
import logger from "../config/logger";

// ─── Constants ─────────────────────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm" as const;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const DEK_LENGTH = 32; // 256-bit AES key

// ─── Errors ────────────────────────────────────────────────────────────────────

export class ErasedKeyError extends Error {
  constructor(
    public readonly userId: string,
    public readonly tombstonedAt: Date
  ) {
    super(
      `DEK for user ${userId} was cryptographically erased at ${tombstonedAt.toISOString()}. ` +
        "Data encrypted under this key is no longer accessible."
    );
    this.name = "ErasedKeyError";
  }
}

export class KeyManagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyManagementError";
  }
}

// ─── Service ───────────────────────────────────────────────────────────────────

export class KeyManagementService {
  private get repo(): Repository<UserKeyTombstone> {
    return AppDataSource.getRepository(UserKeyTombstone);
  }

  /**
   * Returns the master key as a Buffer.
   * Validates that ENCRYPTION_KEY is a 64-char hex string (32 bytes).
   */
  private getMasterKey(): Buffer {
    const hex = process.env.ENCRYPTION_KEY;
    if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new KeyManagementError(
        "ENCRYPTION_KEY must be set and be a 64-character hex string"
      );
    }
    return Buffer.from(hex, "hex");
  }

  /**
   * Derives the per-user DEK using HKDF-SHA256.
   * Input keying material = masterKey
   * Salt = userId (UTF-8)
   * Info = 'chenpilot-dek-v1'
   * Output length = 32 bytes (256-bit AES key)
   *
   * The derived key is deterministic: same (masterKey, userId) always produces
   * the same DEK, so no DEK storage is needed for the HKDF path.
   */
  private deriveDek(userId: string): Buffer {
    const masterKey = this.getMasterKey();
    const salt = Buffer.from(userId, "utf8");
    const info = Buffer.from("chenpilot-dek-v1", "utf8");
    return Buffer.from(
      crypto.hkdfSync("sha256", masterKey, salt, info, DEK_LENGTH)
    );
  }

  /**
   * Returns the active DEK for a user.
   * Throws ErasedKeyError if the key has been tombstoned.
   * Creates a tombstone record if one does not yet exist (lazy init).
   */
  async getDek(userId: string): Promise<Buffer> {
    let record = await this.repo.findOne({ where: { userId } });

    if (record?.tombstonedAt) {
      throw new ErasedKeyError(userId, record.tombstonedAt);
    }

    if (!record) {
      // Lazy-create the tombstone record (active, key not yet erased)
      record = this.repo.create({ userId });
      await this.repo.save(record);
    }

    return this.deriveDek(userId);
  }

  /**
   * Encrypts a plaintext string using the per-user DEK.
   * Format (base64): IV(12) + AuthTag(16) + Ciphertext
   */
  async encryptForUser(userId: string, plaintext: string): Promise<string> {
    const dek = await this.getDek(userId);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, dek, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    const combined = Buffer.concat([iv, authTag, encrypted]);
    return combined.toString("base64");
  }

  /**
   * Decrypts a ciphertext string using the per-user DEK.
   * Throws ErasedKeyError if the key has been tombstoned.
   */
  async decryptForUser(userId: string, ciphertext: string): Promise<string> {
    const dek = await this.getDek(userId);
    const combined = Buffer.from(ciphertext, "base64");

    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, dek, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  }

  /**
   * Cryptographic erasure: marks the DEK as destroyed.
   * After tombstoning, getDek() throws ErasedKeyError and no
   * user-encrypted data can be decrypted.
   *
   * For the HKDF path this means: even though the HKDF derivation is
   * still mathematically possible given the master key and userId,
   * the tombstone record acts as the authoritative "this key is destroyed"
   * gate — getDek() checks it before returning the derived key.
   */
  async tombstoneKey(userId: string, reason: string): Promise<void> {
    let record = await this.repo.findOne({ where: { userId } });

    if (!record) {
      record = this.repo.create({ userId });
    }

    if (record.tombstonedAt) {
      logger.info("DEK already tombstoned for user", {
        userId,
        tombstonedAt: record.tombstonedAt,
      });
      return;
    }

    record.tombstonedAt = new Date();
    record.tombstoneReason = reason;
    // Destroy the stored DEK (if any was stored for the random-key path)
    record.encryptedDek = undefined;

    await this.repo.save(record);

    logger.info("Cryptographic erasure: DEK tombstoned", {
      userId,
      reason,
      tombstonedAt: record.tombstonedAt,
    });
  }

  /**
   * Returns true if the user's key has been cryptographically erased.
   */
  async hasBeenErased(userId: string): Promise<boolean> {
    const record = await this.repo.findOne({ where: { userId } });
    return !!record?.tombstonedAt;
  }

  /**
   * Returns the tombstone record for a user, or null if none exists.
   */
  async getTombstone(userId: string): Promise<UserKeyTombstone | null> {
    return this.repo.findOne({ where: { userId } });
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

export const keyManagementService = new KeyManagementService();
