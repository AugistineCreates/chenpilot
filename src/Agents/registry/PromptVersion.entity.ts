import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity()
export class PromptVersion {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  name!: string;

  @Column()
  type!: string;

  @Column("text")
  content!: string;

  @Column()
  version!: string;

  @Column({ default: false })
  isActive!: boolean;

  @Column({ default: 50 })
  weight!: number;

  @Column("jsonb", { nullable: true })
  compatibility!: {
    minAgentVersion?: string;
    requiredTools?: string[];
    deprecatedTools?: string[];
  };

  @Column({ type: "varchar", nullable: true })
  rollbackVersionId?: string;

  @Column({ type: "jsonb", nullable: true })
  rolloutPolicy!: {
    autoRollbackThreshold?: number; // success rate threshold (0-100)
    minExecutionsBeforePolicy?: number;
    canaryWeight?: number;
  };

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity()
export class PromptMetric {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column("uuid")
  promptVersionId!: string;

  @Column("uuid", { nullable: true })
  userId?: string;

  @Column()
  success!: boolean;

  @Column({ nullable: true })
  responseTime?: number;

  @Column("jsonb", { nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;
}
