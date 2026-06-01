import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
  CreateDateColumn,
  Index,
} from "typeorm";

/**
 * Durable cursor store for Stellar/Soroban event indexing.
 * Each indexer stream (identified by streamId) persists its last processed
 * ledger so restarts resume exactly where they left off.
 */
@Entity("indexer_cursor")
export class IndexerCursor {
  /** Unique stream identifier, e.g. "soroban:contract:<contractId>" */
  @PrimaryColumn({ type: "varchar", length: 255 })
  streamId!: string;

  /** Last fully-processed ledger sequence number */
  @Column({ type: "bigint" })
  @Index()
  lastLedger!: number;

  /** Last event id processed within that ledger (for sub-ledger resume) */
  @Column({ type: "varchar", length: 255, nullable: true })
  lastEventId?: string;

  /** ISO timestamp of the last processed ledger close */
  @Column({ type: "varchar", length: 64, nullable: true })
  lastLedgerClosedAt?: string;

  /** Arbitrary metadata (e.g. contract ids, network) */
  @Column({ type: "jsonb", nullable: true })
  meta?: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
