import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

/**
 * Entity for tracking processed webhooks to ensure idempotency and replay protection
 * Prevents duplicate processing of webhooks from Telegram, Discord, Stellar, and other platforms
 * 
 * AC: Replay identifiers are shared across instances via database
 */
@Entity()
@Index(["webhookId", "platform"], { unique: true })
@Index(["createdAt"])
@Index(["timestamp"])
@Index(["signatureHash"])
export class WebhookIdempotency {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 255 })
  webhookId!: string;

  @Column({ type: "varchar", length: 50 })
  platform!: "telegram" | "discord" | "stellar" | "github" | string;

  // Replay protection fields
  @Column({ type: "varchar", length: 128, nullable: true })
  signatureHash?: string; // SHA-256 hash of signature for duplicate detection

  @Column({ type: "timestamp", nullable: true })
  timestamp?: Date; // Event timestamp from provider headers

  @Column({ type: "varchar", length: 64, nullable: true })
  payloadHash?: string; // SHA-256 hash of payload for mutation detection

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;
}
