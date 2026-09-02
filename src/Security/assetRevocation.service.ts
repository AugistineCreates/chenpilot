import { Repository } from "typeorm";
import { createHash, createHmac } from "crypto";
import AppDataSource from "../config/Datasource";
import logger from "../config/logger";
import {
  AssetRevocation,
  RevocationType,
  RevocationReason,
  RevocationScope,
} from "./assetRevocation.entity";

// ── Configuration ────────────────────────────────────────────────────────────

const DEFAULT_MAX_PROPAGATION_DELAY_MS = 5_000; // 5 seconds
const CLEANUP_BATCH_SIZE = 100;

// ── Types ────────────────────────────────────────────────────────────────────

export interface RevokeParams {
  type: RevocationType;
  code: string;
  reason: RevocationReason;
  scope?: RevocationScope;
  userId?: string;
  description?: string;
  expiresAt?: Date;
  addedBy?: string;
  metadata?: Record<string, unknown>;
}

export interface RevocationCheckResult {
  revoked: boolean;
  entry?: AssetRevocation;
  reason?: string;
}

export interface RevocationFeedEntry {
  id: string;
  type: RevocationType;
  code: string;
  reason: RevocationReason;
  scope: RevocationScope;
  userId: string | null;
  expiresAt: Date | null;
  signature: string | null;
  signatureAlgorithm: string | null;
  createdAt: Date;
}

// ── Service ──────────────────────────────────────────────────────────────────

/**
 * Policy-controlled revocation service for compromised assets and issuers.
 *
 * Follows the same database-backed pattern as IPBlacklist but for Stellar
 * asset/issuer revocation.  Provides:
 * - Revocation creation with cryptographic signing
 * - Fast revocation checks for enforcement boundaries
 * - Issuer-level revocation (all assets from an issuer)
 * - Expiry and cleanup
 * - Feed signature verification
 *
 * Invariants:
 * 1. An active, non-expired entry for a code means that code must be
 *    blocked at every enforcement boundary.
 * 2. Issuer revocation implicitly revokes all assets from that issuer.
 * 3. Signatures are computed over canonical entry fields and can be
 *    verified independently.
 */
export class AssetRevocationService {
  private get repo(): Repository<AssetRevocation> {
    return AppDataSource.getRepository(AssetRevocation);
  }

  // ── Revocation ────────────────────────────────────────────────────────────

  /**
   * Create a new revocation entry.
   *
   * @param params - Revocation parameters
   * @returns The created revocation entry
   */
  async revoke(params: RevokeParams): Promise<AssetRevocation> {
    const entry = this.repo.create({
      type: params.type,
      code: params.code.toUpperCase(),
      reason: params.reason,
      scope: params.scope || "global",
      userId: params.userId || null,
      description: params.description || null,
      expiresAt: params.expiresAt || null,
      isActive: true,
      addedBy: params.addedBy || null,
      metadata: params.metadata || null,
    });

    // Compute signature over canonical fields
    const signaturePayload = this.computeSignaturePayload(entry);
    entry.signature = this.signPayload(signaturePayload);
    entry.signatureAlgorithm = "sha256-hmac";

    const saved = await this.repo.save(entry);

    logger.warn("Asset/issuer revoked", {
      revocationId: saved.id,
      type: saved.type,
      code: saved.code,
      reason: saved.reason,
      scope: saved.scope,
      expiresAt: saved.expiresAt?.toISOString() || "permanent",
      addedBy: saved.addedBy,
    });

    return saved;
  }

  /**
   * Check if an asset or issuer is currently revoked.
   *
   * Checks both direct asset revocation AND issuer-level revocation
   * (an issuer revocation implicitly revokes all assets from that issuer).
   *
   * @param code - Asset code or issuer public key
   * @param type - "asset" or "issuer"
   * @param userId - Optional user ID for per_user scope checks
   * @returns Revocation check result
   */
  async isRevoked(
    code: string,
    type: RevocationType,
    userId?: string
  ): Promise<RevocationCheckResult> {
    const now = new Date();
    const upperCode = code.toUpperCase();

    // 1. Check direct revocation for this code
    const directRevocation = await this.findActiveRevocation(upperCode, type, now);
    if (directRevocation) {
      // Check scope
      if (directRevocation.scope === "global") {
        return {
          revoked: true,
          entry: directRevocation,
          reason: `Direct ${type} revocation: ${directRevocation.reason}`,
        };
      }
      // Per-user scope
      if (userId && directRevocation.userId === userId) {
        return {
          revoked: true,
          entry: directRevocation,
          reason: `Per-user ${type} revocation for user ${userId}: ${directRevocation.reason}`,
        };
      }
    }

    // 2. If checking an asset, also check if its issuer is revoked
    //    (This requires the caller to pass the issuer separately via checkAssetWithIssuer)
    //    For simple checks, we only do direct revocation here.

    return { revoked: false };
  }

  /**
   * Check if an asset is revoked, including issuer-level revocation.
   *
   * @param assetCode - The asset code
   * @param issuerCode - The issuer public key
   * @param userId - Optional user ID for per_user scope
   * @returns Revocation check result
   */
  async checkAssetWithIssuer(
    assetCode: string,
    issuerCode: string,
    userId?: string
  ): Promise<RevocationCheckResult> {
    const now = new Date();
    const upperAsset = assetCode.toUpperCase();
    const upperIssuer = issuerCode.toUpperCase();

    // 1. Check direct asset revocation
    const assetResult = await this.findActiveRevocation(upperAsset, "asset", now);
    if (assetResult && this.isScopeMatch(assetResult, userId)) {
      return {
        revoked: true,
        entry: assetResult,
        reason: `Asset revocation: ${assetResult.reason}`,
      };
    }

    // 2. Check issuer revocation (implicit asset revocation)
    const issuerResult = await this.findActiveRevocation(upperIssuer, "issuer", now);
    if (issuerResult && this.isScopeMatch(issuerResult, userId)) {
      return {
        revoked: true,
        entry: issuerResult,
        reason: `Issuer revocation (affects ${upperAsset}): ${issuerResult.reason}`,
      };
    }

    return { revoked: false };
  }

  /**
   * Revoke all assets from an issuer.
   */
  async revokeIssuer(
    issuerPublicKey: string,
    reason: RevocationReason,
    addedBy?: string,
    description?: string
  ): Promise<AssetRevocation> {
    return this.revoke({
      type: "issuer",
      code: issuerPublicKey,
      reason,
      addedBy,
      description: description || `All assets from issuer ${issuerPublicKey} revoked`,
    });
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  /**
   * Get all active revocations.
   */
  async getActiveRevocations(): Promise<AssetRevocation[]> {
    const now = new Date();
    return this.repo
      .createQueryBuilder("ar")
      .where("ar.isActive = :isActive", { isActive: true })
      .andWhere("(ar.expiresAt IS NULL OR ar.expiresAt > :now)", { now })
      .orderBy("ar.createdAt", "DESC")
      .getMany();
  }

  /**
   * Get the revocation feed (all entries, for signed feed consumption).
   */
  async getRevocationFeed(limit: number = 100): Promise<RevocationFeedEntry[]> {
    const entries = await this.repo.find({
      order: { createdAt: "DESC" },
      take: limit,
    });

    return entries.map((e) => ({
      id: e.id,
      type: e.type,
      code: e.code,
      reason: e.reason,
      scope: e.scope,
      userId: e.userId,
      expiresAt: e.expiresAt,
      signature: e.signature,
      signatureAlgorithm: e.signatureAlgorithm,
      createdAt: e.createdAt,
    }));
  }

  // ── Expiry / Cleanup ──────────────────────────────────────────────────────

  /**
   * Mark expired revocations as inactive.
   */
  async cleanupExpired(batchSize: number = CLEANUP_BATCH_SIZE): Promise<number> {
    const now = new Date();
    const expired = await this.repo
      .createQueryBuilder("ar")
      .where("ar.isActive = :isActive", { isActive: true })
      .andWhere("ar.expiresAt IS NOT NULL")
      .andWhere("ar.expiresAt < :now", { now })
      .limit(batchSize)
      .getMany();

    if (expired.length === 0) return 0;

    for (const entry of expired) {
      entry.isActive = false;
      await this.repo.save(entry);
    }

    logger.info("Expired revocations cleaned up", { count: expired.length });
    return expired.length;
  }

  // ── Signature ──────────────────────────────────────────────────────────────

  /**
   * Verify a revocation entry's signature.
   */
  verifySignature(entry: RevocationFeedEntry): boolean {
    if (!entry.signature || !entry.signatureAlgorithm) {
      return false;
    }

    const payload = this.computeSignatureFeedPayload(entry);
    const expected = this.signPayload(payload);
    return entry.signature === expected;
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private async findActiveRevocation(
    code: string,
    type: RevocationType,
    now: Date
  ): Promise<AssetRevocation | null> {
    return this.repo
      .createQueryBuilder("ar")
      .where("ar.code = :code", { code })
      .andWhere("ar.type = :type", { type })
      .andWhere("ar.isActive = :isActive", { isActive: true })
      .andWhere("(ar.expiresAt IS NULL OR ar.expiresAt > :now)", { now })
      .orderBy("ar.createdAt", "DESC")
      .getOne();
  }

  private isScopeMatch(entry: AssetRevocation, userId?: string): boolean {
    if (entry.scope === "global") return true;
    if (entry.scope === "per_user" && userId && entry.userId === userId) return true;
    return false;
  }

  private computeSignaturePayload(entry: AssetRevocation): string {
    return [
      entry.type,
      entry.code,
      entry.reason,
      entry.scope,
      entry.userId || "",
      entry.expiresAt?.toISOString() || "",
      entry.createdAt?.toISOString() || "",
    ].join("|");
  }

  private computeSignatureFeedPayload(entry: RevocationFeedEntry): string {
    return [
      entry.type,
      entry.code,
      entry.reason,
      entry.scope,
      entry.userId || "",
      entry.expiresAt?.toISOString() || "",
      entry.createdAt?.toISOString() || "",
    ].join("|");
  }

  /**
   * Sign a payload using HMAC-SHA256.
   * In production, this would use an asymmetric key pair.  For now,
   * HMAC with a server-side secret provides integrity guarantees.
   */
  private signPayload(payload: string): string {
    const secret = process.env.REVOCATION_SIGNING_KEY || "default-dev-signing-key";
    return createHmac("sha256", secret).update(payload).digest("hex");
  }
}

export const assetRevocationService = new AssetRevocationService();
