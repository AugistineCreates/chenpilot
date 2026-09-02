import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

// ── Lease status ─────────────────────────────────────────────────────────────

export type LeaseStatus = "reserved" | "consumed" | "expired" | "reclaimed";

// ── Entity ───────────────────────────────────────────────────────────────────

/**
 * Durable lease record for Stellar account sequence numbers.
 *
 * Each lease atomically reserves exactly one sequence number for a given
 * Stellar account.  The `fencingToken` is a per-account monotonic counter
 * that allows callers to detect whether a lease has been superseded by a
 * newer one.
 *
 * Design invariant:
 *   For a given `accountPublicKey`, at most one lease may have
 *   `status = 'reserved'` at any time *with the current fencing token*.
 *   Older reserved leases are automatically expired/reclaimed.
 */
@Entity("sequence_lease")
@Index(["accountPublicKey", "status"])
@Index(["accountPublicKey", "leasedSequence"], { unique: true })
@Index(["status", "expiresAt"])
@Index(["accountPublicKey", "fencingToken"])
export class SequenceLease {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** Stellar account public key whose sequence number is being managed. */
  @Column({ type: "varchar", length: 64 })
  accountPublicKey!: string;

  /** The allocated Stellar sequence number. */
  @Column({ type: "bigint" })
  leasedSequence!: number;

  /**
   * Per-account monotonic counter.  Incremented each time a new lease is
   * created for this account.  Allows callers to detect whether a lease
   * has been superseded.
   */
  @Column({ type: "bigint" })
  fencingToken!: number;

  /** Worker / instance identifier that holds this lease. */
  @Column({ type: "varchar", length: 128 })
  ownerId!: string;

  @Column({
    type: "enum",
    enum: ["reserved", "consumed", "expired", "reclaimed"] as LeaseStatus[],
    default: "reserved",
  })
  status!: LeaseStatus;

  @Column({ type: "timestamp" })
  reservedAt!: Date;

  @Column({ type: "timestamp" })
  expiresAt!: Date;

  /** Set when the lease has been consumed by a successful submission. */
  @Column({ type: "timestamp", nullable: true })
  consumedAt!: Date | null;

  /** Transaction hash from Horizon after successful submission. */
  @Column({ type: "varchar", length: 128, nullable: true })
  txHash!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
