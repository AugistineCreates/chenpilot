import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { TransactionLifecycle } from "./TransactionLifecycle.entity";

export type TransactionResult = "SUCCESS" | "FAILED" | "NOT_FOUND";

/**
 * Audit trail of ledger observations for each confirmation poll.
 * Never deleted — provides immutable history of ancestry checks and provider views.
 */
@Entity("ledger_observations")
@Index(["transactionId"])
@Index(["provider", "ledgerSequence"])
@Index(["observedAt"])
export class LedgerObservation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  transactionId!: string;

  @ManyToOne(() => TransactionLifecycle, { onDelete: "CASCADE" })
  @JoinColumn({ name: "transactionId" })
  transaction!: TransactionLifecycle;

  /** Horizon endpoint URL that provided this observation */
  @Column({ type: "varchar", length: 128 })
  provider!: string;

  /** Ledger sequence number observed */
  @Column({ type: "bigint" })
  ledgerSequence!: number;

  /** Hash of the ledger at this sequence */
  @Column({ type: "varchar", length: 64 })
  ledgerHash!: string;

  /** Parent ledger hash (for ancestry verification) */
  @Column({ type: "varchar", length: 64, nullable: true })
  parentLedgerHash!: string | null;

  /** Result from this provider for the transaction hash */
  @Column({ type: "varchar", length: 32 })
  txResult!: TransactionResult;

  @CreateDateColumn()
  observedAt!: Date;
}
