/**
 * ShadowComparisonRecord.entity.ts
 *
 * Durable record of a shadow divergence comparison (Issue #686).
 * Stored inputs are always privacy-filtered; the entity exposes only the
 * classification, the candidate/active decision signatures, and retention
 * metadata — never raw inputs or credentials.
 */

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("shadow_comparison_records")
export class ShadowComparisonRecord {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ type: "varchar", length: 64 })
  candidateId!: string;

  @Index()
  @Column({ type: "varchar", length: 32 })
  subject!: string;

  @Column({ type: "varchar", length: 32 })
  version!: string;

  @Index()
  @Column({ type: "varchar", length: 128 })
  runId!: string;

  @Column({ type: "boolean", default: false })
  diverged!: boolean;

  @Column({ type: "jsonb", default: () => "'[]'" })
  classes!: string[];

  @Column({ type: "jsonb", default: () => "'{}'" })
  metadata!: Record<string, unknown>;

  @Column({ type: "boolean", default: false })
  reviewedException!: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  evaluatedAt!: Date;
}
