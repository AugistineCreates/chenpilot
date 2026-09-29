import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from "typeorm";

/**
 * TypeORM entity representing a registered agent tool with configuration and activation state
 */
@Entity()
export class AgentTool {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: true, type: "varchar" })
  @Index()
  name!: string; // Unique tool name

  @Column({ type: "varchar" })
  description!: string; // Tool description

  @Column({ type: "jsonb", nullable: true })
  parameters?: object;
  // Optional JSON object to store input schema, e.g. { assetCode: "USDC", depthLimit: 10 }

  @Column({ type: "boolean", default: true })
  @Index()
  isActive!: boolean; // Admin toggle for enabling/disabling the tool

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn({ nullable: true })
  deletedAt?: Date; // Soft delete: timestamp when the tool was disabled
}
