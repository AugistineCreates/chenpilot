/**
 * erasureReceipt.entity.ts
 *
 * Persistent storage for cryptographic proof-of-erasure receipts.
 * The subjectId is hashed (SHA-256) before storage — receipts do not
 * expose the identity of erased subjects.
 */

import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

@Entity({ name: "erasure_receipt" })
export class ErasureReceipt {
  /** UUID — matches the receiptId in the receipt payload */
  @PrimaryColumn({ type: "uuid" })
  id!: string;

  /**
   * SHA-256(userId) — proves erasure without revealing which user.
   * Can be presented by the user to verify their erasure was processed.
   */
  @Column({ type: "varchar" })
  @Index("idx_er_subject_hash")
  subjectIdHash!: string;

  /** Full receipt JSON for auditor retrieval */
  @Column({ type: "jsonb" })
  receiptJson!: Record<string, unknown>;

  /** SHA-256 of canonical receipt fields — proves receipt was not tampered */
  @Column({ type: "varchar" })
  receiptHash!: string;

  @CreateDateColumn()
  @Index("idx_er_created_at")
  createdAt!: Date;
}
