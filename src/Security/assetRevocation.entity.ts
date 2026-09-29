import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

// ── Enums ────────────────────────────────────────────────────────────────────

export type RevocationType = "asset" | "issuer";

export type RevocationReason =
  | "compromised"
  | "regulatory"
  | "fraud"
  | "security_incident"
  | "manual"
  | "other";

export type RevocationScope = "global" | "per_user";

// ── Entity ───────────────────────────────────────────────────────────────────

/**
 * Policy-controlled revocation entry for compromised assets and issuers.
 *
 * Follows the same pattern as IPBlacklist but for Stellar asset/issuer
 * revocation.  Entries can be scoped globally or per-user, have an optional
 * expiry, carry a cryptographic signature for feed integrity, and are
 * fully auditable.
 *
 * Design invariant:
 *   An active, non-expired entry for an asset code (or issuer public key)
 *   means that asset (or all assets from that issuer) must be blocked at
 *   every enforcement boundary.
 */
@Entity("asset_revocation")
@Index(["type", "code", "isActive"])
@Index(["isActive", "expiresAt"])
@Index(["type", "code"])
@Index(["code"])
export class AssetRevocation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** "asset" for a specific asset code, "issuer" for an issuer public key. */
  @Column({ type: "varchar" })
  type!: RevocationType;

  /** Asset code (e.g., "USDC") or issuer public key (e.g., "GABC..."). */
  @Column({ type: "varchar", length: 128 })
  code!: string;

  /** Reason for revocation. */
  @Column({ type: "varchar" })
  reason!: RevocationReason;

  /** Scope: "global" blocks everyone, "per_user" blocks a specific user. */
  @Column({ type: "varchar", default: "global" })
  scope!: RevocationScope;

  /** User ID for per_user scope. Null for global scope. */
  @Column({ type: "varchar", nullable: true })
  userId!: string | null;

  /** Human-readable description of the revocation. */
  @Column({ type: "text", nullable: true })
  description!: string | null;

  /** When the revocation expires. Null = permanent. */
  @Column({ type: "timestamp", nullable: true })
  expiresAt!: Date | null;

  /** Whether this revocation is currently active. */
  @Column({ type: "boolean", default: true })
  @Index()
  isActive!: boolean;

  /** Admin who created this revocation. */
  @Column({ type: "varchar", nullable: true })
  addedBy!: string | null;

  /**
   * Cryptographic signature of the revocation entry fields for feed
   * integrity.  Covers: type, code, reason, scope, expiresAt, createdAt.
   */
  @Column({ type: "text", nullable: true })
  signature!: string | null;

  /** Algorithm used for the signature (e.g., "ed25519"). */
  @Column({ type: "varchar", length: 64, nullable: true })
  signatureAlgorithm!: string | null;

  /** Arbitrary additional metadata. */
  @Column({ type: "simple-json", nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /**
   * Check if this revocation entry is currently active and not expired.
   */
  isCurrentlyRevoked(): boolean {
    if (!this.isActive) {
      return false;
    }
    if (this.expiresAt) {
      return new Date() < this.expiresAt;
    }
    return true;
  }
}
