/**
 * WalletChallengeService
 *
 * Issues short-lived, domain-separated challenges and verifies that the
 * response is a valid cryptographic signature produced by the private key
 * corresponding to the claimed wallet address.
 *
 * Security guarantees:
 * 1. **Single-use** – `usedAt` is set atomically on the DB row; a second
 *    attempt always fails.
 * 2. **Short-lived** – challenges expire after CHALLENGE_TTL_SECONDS (60 s).
 * 3. **Domain-separated** – the canonical message includes `DOMAIN_TAG`, so
 *    a signature obtained for any other service cannot be replayed here.
 * 4. **Platform-bound** – platform and platformUserId are embedded in the
 *    signed message, so a signature from one platform cannot be substituted
 *    for another.
 * 5. **Network-bound** – the network name is embedded in the signed message.
 */

import crypto from "crypto";
import AppDataSource from "../config/Datasource";
import { Repository } from "typeorm";
import { WalletChallenge, WalletNetwork } from "./walletChallenge.entity";
import { auditLogService } from "../AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../AuditLog/auditLog.entity";
import logger from "../config/logger";

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum lifetime of a challenge in seconds. */
export const CHALLENGE_TTL_SECONDS = 60;

/**
 * Domain separation tag baked into every signed message.
 * Changing this value invalidates all previously issued challenges.
 */
export const DOMAIN_TAG = "chenpilot.wallet-link.v1";

// ── Types ────────────────────────────────────────────────────────────────────

export interface IssueParams {
  userId: string;
  walletAddress: string;
  network: WalletNetwork;
  platform: string;
  platformUserId: string;
}

export interface IssuedChallenge {
  challengeId: string;
  nonce: string;
  /** Exact string the wallet must sign. */
  message: string;
  expiresAt: Date;
  domain: string;
}

export interface VerifyParams {
  challengeId: string;
  /** Hex-encoded signature bytes. */
  signature: string;
  /**
   * For Bitcoin P2PKH/P2WPKH the compressed public key (hex) must be
   * supplied because it is not recoverable from a standard message signature
   * without the full signature payload. Optional for Stellar (public key
   * is the wallet address itself).
   */
  publicKey?: string;
}

export interface VerifiedChallenge {
  userId: string;
  walletAddress: string;
  network: WalletNetwork;
  platform: string;
  platformUserId: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the canonical UTF-8 string that the wallet holder must sign.
 *
 * Format:
 * ```
 * chenpilot.wallet-link.v1
 * domain: chenpilot.wallet-link.v1
 * userId: <uuid>
 * wallet: <address>
 * network: <stellar|bitcoin>
 * platform: <telegram|discord>
 * platformUserId: <id>
 * nonce: <64-char hex>
 * issuedAt: <ISO-8601 UTC>
 * expiresAt: <ISO-8601 UTC>
 * ```
 *
 * Every field is on its own line to make the message unambiguous.
 */
export function buildChallengeMessage(
  domain: string,
  userId: string,
  walletAddress: string,
  network: string,
  platform: string,
  platformUserId: string,
  nonce: string,
  issuedAt: Date,
  expiresAt: Date
): string {
  return [
    domain,
    `domain: ${domain}`,
    `userId: ${userId}`,
    `wallet: ${walletAddress}`,
    `network: ${network}`,
    `platform: ${platform}`,
    `platformUserId: ${platformUserId}`,
    `nonce: ${nonce}`,
    `issuedAt: ${issuedAt.toISOString()}`,
    `expiresAt: ${expiresAt.toISOString()}`,
  ].join("\n");
}

// ── Signature verification ────────────────────────────────────────────────────

/**
 * Verify a Stellar Ed25519 signature.
 *
 * The Stellar SDK signs 32-byte SHA-256 hashes directly.  We follow the same
 * convention: `sha256(message_utf8)` → sign/verify.
 *
 * @param message   Canonical challenge message string.
 * @param signature Hex-encoded 64-byte Ed25519 signature.
 * @param address   Stellar public key (G…).
 */
export function verifyStellarSignature(
  message: string,
  signature: string,
  address: string
): boolean {
  try {
    // Lazy-load stellar-sdk to avoid a hard import-time dependency in tests
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Keypair } = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
    const keypair = Keypair.fromPublicKey(address);
    const messageHash = crypto.createHash("sha256").update(message, "utf8").digest();
    const sigBytes = Buffer.from(signature, "hex");
    return keypair.verify(messageHash, sigBytes);
  } catch (err) {
    logger.debug("verifyStellarSignature: error", { err });
    return false;
  }
}

/**
 * Verify a Bitcoin message signature.
 *
 * Bitcoin "message signing" (legacy / Electrum style) is:
 *   hash = dSHA256("\x18Bitcoin Signed Message:\n" + varint(len) + message)
 *   signature = compact ECDSA (65 bytes: recovery_id || r || s)
 *
 * This implementation uses Node's built-in `crypto` to perform ECDSA
 * verification against the *supplied* public key (we do NOT attempt
 * signature recovery, which avoids ambiguities with P2WPKH vs P2PKH).
 *
 * @param message   Canonical challenge message string.
 * @param signature Hex-encoded 65-byte compact signature (r, s, v).
 * @param address   Bitcoin address (informational only — used for logging).
 * @param publicKey Hex-encoded 33-byte compressed SEC public key.
 */
export function verifyBitcoinSignature(
  message: string,
  signature: string,
  address: string,
  publicKey: string
): boolean {
  try {
    const PREFIX = "Bitcoin Signed Message:\n";
    // varint encode message length (simple version; handles up to 252 bytes)
    const msgBuf = Buffer.from(message, "utf8");
    const msgLenVarint =
      msgBuf.length < 0xfd
        ? Buffer.from([msgBuf.length])
        : (() => {
            const b = Buffer.alloc(3);
            b.writeUInt8(0xfd, 0);
            b.writeUInt16LE(msgBuf.length, 1);
            return b;
          })();

    const prefixBuf = Buffer.from(PREFIX, "utf8");
    const prefixLenVarint = Buffer.from([prefixBuf.length]);

    const full = Buffer.concat([prefixLenVarint, prefixBuf, msgLenVarint, msgBuf]);
    // Double-SHA256
    const hash = crypto.createHash("sha256").update(
      crypto.createHash("sha256").update(full).digest()
    ).digest();

    const sigBuf = Buffer.from(signature, "hex");
    if (sigBuf.length < 64) {
      return false;
    }
    // Compact signature layout: 1 byte header + 32 r + 32 s (65 bytes total)
    // We use the last 64 bytes as DER-less r||s and verify with secp256k1 via
    // Node's ECDH / verify APIs.
    const rBuf = sigBuf.slice(sigBuf.length - 64, sigBuf.length - 32);
    const sBuf = sigBuf.slice(sigBuf.length - 32);

    // Build DER-encoded signature for Node's `crypto.createVerify`
    const toMinimalDer = (b: Buffer): Buffer => {
      // Remove leading zeros but keep at least one byte
      let start = 0;
      while (start < b.length - 1 && b[start] === 0) start++;
      const trimmed = b.slice(start);
      // Prepend 0x00 if high bit is set
      const needsPad = (trimmed[0] & 0x80) !== 0;
      const val = needsPad ? Buffer.concat([Buffer.from([0x00]), trimmed]) : trimmed;
      return Buffer.concat([Buffer.from([0x02, val.length]), val]);
    };

    const rDer = toMinimalDer(rBuf);
    const sDer = toMinimalDer(sBuf);
    const seq = Buffer.from([0x30, rDer.length + sDer.length]);
    const der = Buffer.concat([seq, rDer, sDer]);

    // Import the public key in SEC format
    const keyObj = crypto.createPublicKey({
      key: Buffer.from(publicKey, "hex"),
      format: "der",
      type: "spki",
    });

    const verify = crypto.createVerify("SHA256");
    // We already have the double-sha256 hash, so pass it directly
    // by using `verify.update(hash)` and setting the algorithm to
    // a raw-RSA-style digest.  Node doesn't have ECDSA-raw, so we
    // fall back to passing the pre-hashed value and signing with
    // a 0-byte digest.
    void address; // used for logging context only
    const ok = crypto.verify(null, hash, { key: keyObj, dsaEncoding: "der" }, der);
    return ok;
  } catch (err) {
    logger.debug("verifyBitcoinSignature: error", { err });
    return false;
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export class WalletChallengeService {
  private repo: Repository<WalletChallenge>;

  constructor() {
    this.repo = AppDataSource.getRepository(WalletChallenge);
  }

  // --------------------------------------------------------------------------
  // Issue
  // --------------------------------------------------------------------------

  /**
   * Issue a new challenge and persist it for audit.
   *
   * Returns the `IssuedChallenge` including the exact message string the
   * wallet owner must sign.
   */
  async issueChallenge(params: IssueParams): Promise<IssuedChallenge> {
    const { userId, walletAddress, network, platform, platformUserId } = params;

    const nonce = crypto.randomBytes(32).toString("hex"); // 64 hex chars
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_SECONDS * 1000);
    const domain = DOMAIN_TAG;

    const message = buildChallengeMessage(
      domain,
      userId,
      walletAddress,
      network,
      platform,
      platformUserId,
      nonce,
      issuedAt,
      expiresAt
    );

    const entity = this.repo.create({
      userId,
      walletAddress,
      network,
      platform,
      platformUserId,
      nonce,
      domain,
      issuedAt,
      expiresAt,
    });

    await this.repo.save(entity);

    await auditLogService.log({
      userId,
      action: AuditAction.WALLET_CHALLENGE_ISSUED,
      severity: AuditSeverity.INFO,
      metadata: { challengeId: entity.id, walletAddress, network, platform, platformUserId },
    });

    logger.info("Wallet challenge issued", {
      challengeId: entity.id,
      userId,
      walletAddress,
      network,
      platform,
    });

    return {
      challengeId: entity.id,
      nonce,
      message,
      expiresAt,
      domain,
    };
  }

  // --------------------------------------------------------------------------
  // Verify & Consume
  // --------------------------------------------------------------------------

  /**
   * Verify the signature for a previously issued challenge and mark it used.
   *
   * Throws descriptive errors so the caller can return appropriate HTTP
   * responses without leaking internals.
   */
  async verifyAndConsume(params: VerifyParams): Promise<VerifiedChallenge> {
    const { challengeId, signature, publicKey } = params;

    // ── Load ────────────────────────────────────────────────────────────────
    const challenge = await this.repo.findOne({ where: { id: challengeId } });

    if (!challenge) {
      throw new WalletChallengeError("CHALLENGE_NOT_FOUND", "Challenge not found");
    }

    // ── Expiry ───────────────────────────────────────────────────────────────
    if (new Date() > challenge.expiresAt) {
      throw new WalletChallengeError("CHALLENGE_EXPIRED", "Challenge has expired");
    }

    // ── Single-use gate ──────────────────────────────────────────────────────
    if (challenge.usedAt != null) {
      // Replay attempt — log at higher severity
      await auditLogService.log({
        userId: challenge.userId,
        action: AuditAction.WALLET_CHALLENGE_REPLAY,
        severity: AuditSeverity.WARNING,
        metadata: {
          challengeId,
          walletAddress: challenge.walletAddress,
          platform: challenge.platform,
        },
      });
      throw new WalletChallengeError("CHALLENGE_ALREADY_USED", "Challenge has already been used");
    }

    // ── Rebuild the message ──────────────────────────────────────────────────
    const message = buildChallengeMessage(
      challenge.domain,
      challenge.userId,
      challenge.walletAddress,
      challenge.network,
      challenge.platform,
      challenge.platformUserId,
      challenge.nonce,
      challenge.issuedAt,
      challenge.expiresAt
    );

    // ── Verify signature ─────────────────────────────────────────────────────
    let valid = false;

    if (challenge.network === WalletNetwork.STELLAR) {
      valid = verifyStellarSignature(message, signature, challenge.walletAddress);
    } else if (challenge.network === WalletNetwork.BITCOIN) {
      if (!publicKey) {
        throw new WalletChallengeError(
          "MISSING_PUBLIC_KEY",
          "publicKey is required for Bitcoin signature verification"
        );
      }
      valid = verifyBitcoinSignature(message, signature, challenge.walletAddress, publicKey);
    } else {
      throw new WalletChallengeError("UNSUPPORTED_NETWORK", `Unsupported network: ${challenge.network as string}`);
    }

    if (!valid) {
      await auditLogService.log({
        userId: challenge.userId,
        action: AuditAction.WALLET_CHALLENGE_SIGNATURE_FAILED,
        severity: AuditSeverity.WARNING,
        metadata: {
          challengeId,
          walletAddress: challenge.walletAddress,
          network: challenge.network,
          platform: challenge.platform,
        },
      });
      throw new WalletChallengeError("INVALID_SIGNATURE", "Signature verification failed");
    }

    // ── Atomic consume ────────────────────────────────────────────────────────
    // Use an UPDATE with a WHERE usedAt IS NULL to prevent a race condition
    // where two concurrent requests both pass the in-memory NULL check.
    const now = new Date();
    const result = await this.repo
      .createQueryBuilder()
      .update(WalletChallenge)
      .set({ usedAt: now })
      .where("id = :id AND \"usedAt\" IS NULL", { id: challengeId })
      .execute();

    if (!result.affected || result.affected === 0) {
      // Another request consumed it between our read and this update
      await auditLogService.log({
        userId: challenge.userId,
        action: AuditAction.WALLET_CHALLENGE_REPLAY,
        severity: AuditSeverity.WARNING,
        metadata: { challengeId, walletAddress: challenge.walletAddress },
      });
      throw new WalletChallengeError("CHALLENGE_ALREADY_USED", "Challenge has already been used (race condition)");
    }

    await auditLogService.log({
      userId: challenge.userId,
      action: AuditAction.WALLET_CHALLENGE_VERIFIED,
      severity: AuditSeverity.INFO,
      metadata: {
        challengeId,
        walletAddress: challenge.walletAddress,
        network: challenge.network,
        platform: challenge.platform,
        platformUserId: challenge.platformUserId,
      },
    });

    logger.info("Wallet challenge verified and consumed", {
      challengeId,
      userId: challenge.userId,
      walletAddress: challenge.walletAddress,
      network: challenge.network,
      platform: challenge.platform,
    });

    return {
      userId: challenge.userId,
      walletAddress: challenge.walletAddress,
      network: challenge.network,
      platform: challenge.platform,
      platformUserId: challenge.platformUserId,
    };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /** For testing/CLI: look up a challenge by its nonce. */
  async findByNonce(nonce: string): Promise<WalletChallenge | null> {
    return this.repo.findOne({ where: { nonce } });
  }
}

// ── Error type ────────────────────────────────────────────────────────────────

export type WalletChallengeErrorCode =
  | "CHALLENGE_NOT_FOUND"
  | "CHALLENGE_EXPIRED"
  | "CHALLENGE_ALREADY_USED"
  | "INVALID_SIGNATURE"
  | "MISSING_PUBLIC_KEY"
  | "UNSUPPORTED_NETWORK";

export class WalletChallengeError extends Error {
  constructor(
    public readonly code: WalletChallengeErrorCode,
    message: string
  ) {
    super(message);
    this.name = "WalletChallengeError";
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
export const walletChallengeService = new WalletChallengeService();
