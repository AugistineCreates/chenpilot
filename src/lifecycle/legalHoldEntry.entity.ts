/**
 * legalHoldEntry.entity.ts
 *
 * An explicitly scoped legal / audit hold.
 * Holds block retention purges and user erasure requests for the named
 * data classes until the hold is lifted.
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";
import { DataClass } from "./classification";

@Entity({ name: "legal_hold_entry" })
@Index("idx_lhe_hold_id", ["holdId"])
@Index("idx_lhe_subject_id", ["subjectId"])
export class LegalHoldEntry {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /**
   * Logical hold name/reference (e.g. "LEGAL-2026-042").
   * Groups multiple subject entries under one hold.
   */
  @Column({ type: "varchar" })
  holdId!: string;

  /** What kind of subject is being held */
  @Column({ type: "varchar" })
  subjectType!: "user" | "tenant" | "transaction";

  /** The specific userId / tenantId / transactionId */
  @Column({ type: "varchar" })
  subjectId!: string;

  /**
   * Narrowly scoped: only these data classes are held.
   * Stored as comma-separated string via simple-array.
   */
  @Column({ type: "simple-array" })
  dataClasses!: DataClass[];

  @Column({ type: "text" })
  reason!: string;

  /** Who placed the hold */
  @Column({ type: "varchar" })
  requestedBy!: string;

  @Column({ type: "timestamp" })
  placedAt!: Date;

  /** When set, the hold has been lifted */
  @Column({ type: "timestamp", nullable: true })
  liftedAt?: Date;

  @Column({ type: "varchar", nullable: true })
  liftedBy?: string;

  /**
   * Optional auto-expiry for holds with a defined duration.
   * Holds are still considered active until explicitly lifted even after expiresAt.
   * The service checks expiresAt when evaluating active holds.
   */
  @Column({ type: "timestamp", nullable: true })
  expiresAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
