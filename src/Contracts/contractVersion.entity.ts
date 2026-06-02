import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Unique } from "typeorm";

/**
 * Represents a specific version of a deployed Chen Pilot contract.
 * Stores compatibility metadata to help backend and SDK reason about capabilities.
 */
@Entity({ name: "contract_versions" })
@Unique(["contractId", "version"])
export class ContractVersion {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** Stellar contract ID (e.g., "C..."), must start with "C" */
  @Column({ type: "varchar", length: 56 })
  contractId: string;

  /** Semantic version string, e.g., "1.0.0" */
  @Column({ type: "varchar", length: 20 })
  version: string;

  /** Optional description of changes or capabilities */
  @Column({ type: "text", nullable: true })
  description?: string;

  /** JSON field storing arbitrary compatibility metadata */
  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown>;

  /** When this version entry was created */
  @CreateDateColumn({ type: "timestamp with time zone" })
  createdAt: Date;

  /** When this version entry was last updated */
  @UpdateDateColumn({ type: "timestamp with time zone" })
  updatedAt: Date;
}
