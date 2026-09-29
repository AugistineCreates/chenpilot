import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { User } from "./user.entity";

/**
 * Enhanced RefreshToken entity with token family binding, device tracking, and risk signals.
 * 
 * Token Family Semantics:
 * - Each token issuance starts a new "family"
 * - All tokens in a family chain back to the first (root) token
 * - If any token in the family is reused, the entire family is revoked atomically
 * - Device changes within a family may trigger step-up authentication
 * 
 * Security Improvements:
 * - Device binding prevents token portability
 * - Risk signals track suspicious patterns (replay attempts, unusual locations)
 * - Family revocation is atomic and deterministic
 * - Rotation creates clear audit trail
 */

@Entity()
export class RefreshToken {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  @Index()
  token!: string;

  @Column({ type: "uuid" })
  @Index()
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ type: "timestamp" })
  @Index()
  expiresAt!: Date;

  @Column({ type: "boolean", default: false })
  @Index()
  isRevoked!: boolean;

  @Column({ type: "varchar", nullable: true })
  replacedByToken?: string;

  @Column({ type: "varchar", nullable: true })
  revokedReason?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Token Family Binding (Issue #659)
  
  /**
   * Family ID: All tokens in a rotation chain share the same family ID.
   * When any token is reused, the entire family is revoked.
   * Format: UUID v4
   */
  @Column({ type: "uuid" })
  @Index()
  familyId!: string;

  /**
   * Root token ID: The first token issued in this family.
   * Allows tracing the entire family lineage.
   */
  @Column({ type: "uuid", nullable: true })
  rootTokenId?: string;

  /**
   * Parent token ID: The previous token in the rotation chain (if not root).
   * Enables linear history walking.
   */
  @Column({ type: "uuid", nullable: true })
  parentTokenId?: string;

  /**
   * Device ID: Cryptographic fingerprint of the device that obtained this token.
   * Computed from: user-agent, IP address hash, and device characteristics.
   * Used to detect cross-device replay attacks.
   */
  @Column({ type: "varchar", nullable: true })
  @Index()
  deviceId?: string;

  /**
   * Device name: Human-readable identifier (e.g., "Chrome on Ubuntu", "Safari on iPhone").
   * For audit trail and user session management.
   */
  @Column({ type: "varchar", nullable: true })
  deviceName?: string;

  /**
   * IP address (hashed): SHA256 hash of the IP that requested this token.
   * Allows detection of unusual access patterns without storing raw IP.
   */
  @Column({ type: "varchar", nullable: true })
  ipAddressHash?: string;

  /**
   * Risk level when token was issued: NONE, LOW, MEDIUM, HIGH, CRITICAL.
   * Based on: device change, unusual time, unusual location, suspicious patterns.
   */
  @Column({
    type: "enum",
    enum: ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"],
    default: "NONE",
  })
  riskSignal!: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

  /**
   * Risk reason: Why the risk signal was assigned.
   * E.g., "Device changed from Chrome to Firefox", "Unusual time (3 AM)",
   *       "Unusual location", "Replay attempt detected"
   */
  @Column({ type: "text", nullable: true })
  riskReason?: string;

  /**
   * Last used timestamp: When this token was last used for a refresh.
   * Used to detect stale/abandoned tokens and unusual activity patterns.
   */
  @Column({ type: "timestamp", nullable: true })
  lastUsedAt?: Date;

  /**
   * Rotation reason: Why this token was rotated.
   * E.g., "NORMAL", "RISK_DETECTED", "MANUAL_LOGOUT", "SECURITY_INCIDENT", "DEVICE_CHANGE"
   */
  @Column({
    type: "enum",
    enum: [
      "NORMAL",
      "RISK_DETECTED",
      "MANUAL_LOGOUT",
      "SECURITY_INCIDENT",
      "DEVICE_CHANGE",
    ],
    default: "NORMAL",
  })
  rotationReason!:
    | "NORMAL"
    | "RISK_DETECTED"
    | "MANUAL_LOGOUT"
    | "SECURITY_INCIDENT"
    | "DEVICE_CHANGE";

  /**
   * Reuse detected flag: True if this token was presented for refresh after being replaced.
   * Signals a potential compromise or replay attack.
   * Triggers immediate family revocation.
   */
  @Column({ type: "boolean", default: false })
  @Index()
  reuseDetected!: boolean;

  /**
   * Session ID: Unique session identifier that groups related tokens.
   * Allows targeted session revocation (e.g., logout from specific device).
   */
  @Column({ type: "uuid", nullable: true })
  @Index()
  sessionId?: string;
}
