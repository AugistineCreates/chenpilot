/**
 * userKeyTombstone.entity.ts
 *
 * Tracks per-user DEK (Data Encryption Key) lifecycle.
 * When tombstonedAt is set, the DEK is considered destroyed and any data
 * encrypted under it is cryptographically erased (unreadable).
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity({ name: "user_key_tombstone" })
export class UserKeyTombstone {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** The user whose DEK this record tracks */
  @Column({ type: "varchar", unique: true })
  @Index()
  userId!: string;

  /**
   * DEK version — supports future key rotation.
   * Increment when a user requests key rotation.
   */
  @Column({ type: "int", default: 1 })
  dekVersion!: number;

  /**
   * Optional: the randomly-generated DEK encrypted under the master key.
   * If null, key derivation (HKDF) is used instead.
   * Destroying this value (setting to null + tombstoning) achieves cryptographic erasure
   * for the stronger random-key path.
   */
  @Column({ type: "varchar", nullable: true })
  encryptedDek?: string;

  /**
   * When set, the DEK has been destroyed.
   * Any data encrypted under this DEK is no longer decryptable.
   */
  @Column({ type: "timestamp", nullable: true })
  tombstonedAt?: Date;

  @Column({ type: "varchar", nullable: true })
  tombstoneReason?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
