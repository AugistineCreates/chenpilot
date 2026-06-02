import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Unique } from "typeorm";

/**
 * Represents a deployed Chen Pilot contract with compatibility metadata.
 */
@Entity({ name: "deployed_contracts" })
@Unique(["contractId", "network"])
export class DeployedContract {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** Human readable contract name (e.g., "core_vault") */
  @Column({ type: "varchar", length: 64 })
  contractName: string;

  /** Stellar contract ID (must start with "C") */
  @Column({ type: "varchar", length: 56 })
  contractId: string;

  /** Network where the contract is deployed: "testnet" | "mainnet" */
  @Column({ type: "varchar", length: 10 })
  network: string;

  /** Semantic version string, e.g., "1.0.0" */
  @Column({ type: "varchar", length: 20 })
  version: string;

  /** Array of capability identifiers supported by this contract version */
  @Column({ type: "jsonb" })
  capabilities: string[];

  /** Status of the contract version: "active", "deprecated", "stale" */
  @Column({ type: "varchar", length: 12, default: "active" })
  status: string;

  /** Minimum SDK version required to interact with this contract version */
  @Column({ type: "varchar", length: 20, nullable: true })
  minSdkVersion?: string;

  /** When the contract was deployed on the network */
  @Column({ type: "timestamp with time zone", nullable: true })
  deployedAt?: Date;

  @CreateDateColumn({ type: "timestamp with time zone" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamp with time zone" })
  updatedAt: Date;
}
