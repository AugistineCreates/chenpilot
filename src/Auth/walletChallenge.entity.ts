import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from "typeorm";

/**
 * Supported wallet networks for challenge-based ownership proof.
 */
export enum WalletNetwork {
  STELLAR = "stellar",
  BITCOIN = "bitcoin",
}

/**
 * Persistent audit record of every wallet ownership challenge ever issued.
 *
 * Security properties:
 * - `nonce` is 32 cryptographically random bytes encoded as hex (64 chars).
 * - `domain` is the Chen Pilot domain tag baked into the message so a valid
 *   signature for another service cannot be replayed here.
 * - `usedAt` is set atomically when the challenge is consumed; NULL means
 *   it is still pending.
 * - `expiresAt` is always ≤ issuedAt + 60s (enforced by WalletChallengeService).
 */
@Entity("wallet_challenge")
@Index(["userId", "platform"])
@Index(["nonce"], { unique: true })
export class WalletChallenge {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /**
   * The Chen Pilot user that requested the challenge.
   */
  @Column({ type: "uuid" })
  @Index()
  userId!: string;

  /**
   * The wallet address whose private key must produce the signature.
   * Stellar: G… (Ed25519 public key encoded in Stellar base32 format).
   * Bitcoin: 1… / 3… / bc1… (mainnet) or testnet equivalents.
   */
  @Column({ type: "varchar" })
  @Index()
  walletAddress!: string;

  @Column({ type: "enum", enum: WalletNetwork })
  network!: WalletNetwork;

  /**
   * The bot platform being linked (telegram / discord).
   * Baked into the signed message to prevent cross-platform substitution.
   */
  @Column({ type: "varchar" })
  platform!: string;

  /**
   * The platform-specific user ID of the bot account being linked.
   * Baked into the signed message to prevent identity substitution.
   */
  @Column({ type: "varchar" })
  platformUserId!: string;

  /**
   * 64-character hex-encoded 32-byte cryptographically random nonce.
   * Uniqueness is enforced at the DB level.
   */
  @Column({ type: "varchar", length: 64, unique: true })
  nonce!: string;

  /**
   * Domain separation tag — always "chenpilot.wallet-link.v1".
   * Stored so the audit record is self-describing.
   */
  @Column({ type: "varchar" })
  domain!: string;

  @CreateDateColumn({ type: "timestamp" })
  issuedAt!: Date;

  /**
   * Hard expiry enforced server-side.  Stored so expiry can be checked
   * even if the Redis key has already been evicted.
   */
  @Column({ type: "timestamp" })
  expiresAt!: Date;

  /**
   * Set to a non-null timestamp when the challenge is consumed.
   * NULL means the challenge has not been used yet (or has expired unused).
   * This column is the single-use gate — it is written inside a transaction
   * with an optimistic check (see WalletChallengeService).
   */
  @Column({ type: "timestamp", nullable: true })
  @Index()
  usedAt?: Date;
}
