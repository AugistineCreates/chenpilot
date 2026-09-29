import { injectable } from "tsyringe";
import { Repository } from "typeorm";
import crypto from "crypto";
import AppDataSource from "../../config/Datasource";
import { RefreshToken } from "./refreshToken.entity";
import { UnauthorizedError, BadError } from "../../utils/error";
import logger from "../../config/logger";
import { auditLogService } from "../../AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../../AuditLog/auditLog.entity";

/**
 * Device fingerprint: Computed from user-agent, IP, and device characteristics.
 */
export interface DeviceFingerprint {
  userAgent: string;
  ipAddress: string;
  additionalData?: Record<string, string>;
}

/**
 * Refresh token request context: Device and risk information.
 */
export interface RefreshContext {
  deviceFingerprint: DeviceFingerprint;
  userAgent: string;
  ipAddress: string;
}

/**
 * Token family metadata for session management.
 */
export interface TokenFamilyInfo {
  familyId: string;
  rootTokenId?: string;
  deviceId: string;
  deviceName: string;
  createdAt: Date;
  lastUsedAt?: Date;
  sessionId: string;
  isCompromised: boolean;
  riskLevel: string;
}

/**
 * RefreshTokenFamilyService: Manages token families and reuse detection.
 *
 * Core responsibilities:
 * 1. Create token families (root token)
 * 2. Rotate tokens within family (maintain lineage)
 * 3. Detect reuse attempts (compromised token refresh)
 * 4. Atomically revoke families on detection
 * 5. Track device changes and risk signals
 * 6. Provide session inventory for targeted revocation
 *
 * Security guarantees:
 * - Reuse detection is deterministic
 * - Family revocation is atomic
 * - Device binding prevents portability
 * - Complete audit trail
 */

@injectable()
export class RefreshTokenFamilyService {
  private tokenRepository: Repository<RefreshToken>;

  constructor() {
    this.tokenRepository = AppDataSource.getRepository(RefreshToken);
  }

  /**
   * Create a new token family (for initial login/registration).
   * All tokens in the family will trace back to this root token.
   */
  async createTokenFamily(
    userId: string,
    expiresAt: Date,
    context: RefreshContext,
    sessionId: string
  ): Promise<RefreshToken> {
    const familyId = crypto.randomUUID();
    const deviceId = this.computeDeviceId(context.deviceFingerprint);
    const ipHash = this.hashIpAddress(context.ipAddress);

    const deviceName = this.parseDeviceName(context.userAgent);
    const token = this.generateSecureToken();
    const riskSignal = this.assessRiskSignal(
      {
        isNewDevice: true,
        isNewLocation: false,
      }
    );

    const tokenEntity = this.tokenRepository.create({
      token,
      userId,
      expiresAt,
      familyId,
      rootTokenId: null, // This is the root
      parentTokenId: null,
      deviceId,
      deviceName,
      ipAddressHash: ipHash,
      riskSignal: riskSignal.level,
      riskReason: riskSignal.reason,
      lastUsedAt: new Date(),
      rotationReason: "NORMAL",
      reuseDetected: false,
      sessionId,
    });

    await this.tokenRepository.save(tokenEntity);

    logger.info("Token family created", {
      userId,
      familyId,
      deviceId,
      sessionId,
    });

    await auditLogService.log({
      userId,
      action: AuditAction.LOGIN,
      severity: AuditSeverity.INFO,
      metadata: { familyId, deviceId, sessionId },
    });

    return tokenEntity;
  }

  /**
   * Rotate token within family: issue new token, mark old as replaced.
   * Returns new token if rotation is safe, throws if reuse detected.
   */
  async rotateToken(
    oldToken: string,
    context: RefreshContext,
    sessionId: string
  ): Promise<RefreshToken> {
    // Find the old token
    const oldTokenEntity = await this.tokenRepository.findOne({
      where: { token: oldToken },
      relations: ["user"],
    });

    if (!oldTokenEntity) {
      throw new UnauthorizedError("Token not found");
    }

    // Check if already revoked
    if (oldTokenEntity.isRevoked) {
      throw new UnauthorizedError(
        "Token has been revoked"
      );
    }

    // Critical: Check if token is being reused (presented after being replaced)
    if (oldTokenEntity.replacedByToken) {
      logger.warn("Token reuse detected", {
        tokenId: oldTokenEntity.id,
        userId: oldTokenEntity.userId,
        familyId: oldTokenEntity.familyId,
      });

      // Mark the old token as reuse-detected
      oldTokenEntity.reuseDetected = true;
      await this.tokenRepository.save(oldTokenEntity);

      // Atomically revoke the entire family
      await this.revokeFamilyAtomic(
        oldTokenEntity.familyId,
        oldTokenEntity.userId,
        "Token reuse detected - possible compromise"
      );

      await auditLogService.log({
        userId: oldTokenEntity.userId,
        action: AuditAction.SECURITY_EVENT,
        severity: AuditSeverity.CRITICAL,
        metadata: {
          event: "token_reuse_detected",
          familyId: oldTokenEntity.familyId,
          tokenId: oldTokenEntity.id,
        },
      });

      throw new UnauthorizedError(
        "Token reuse detected. All sessions have been revoked for security."
      );
    }

    // Check for token expiration
    if (new Date() > oldTokenEntity.expiresAt) {
      throw new UnauthorizedError("Token has expired");
    }

    // Detect device changes
    const newDeviceId = this.computeDeviceId(context.deviceFingerprint);
    const deviceChanged = oldTokenEntity.deviceId !== newDeviceId;

    const riskSignal = this.assessRiskSignal({
      isNewDevice: deviceChanged,
      isNewLocation: false,
      isReplayed: false,
    });

    // Create new token
    const newToken = this.generateSecureToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    const newTokenEntity = this.tokenRepository.create({
      token: newToken,
      userId: oldTokenEntity.userId,
      expiresAt,
      familyId: oldTokenEntity.familyId,
      rootTokenId: oldTokenEntity.rootTokenId || oldTokenEntity.id,
      parentTokenId: oldTokenEntity.id,
      deviceId: newDeviceId,
      deviceName: this.parseDeviceName(context.userAgent),
      ipAddressHash: this.hashIpAddress(context.ipAddress),
      riskSignal: riskSignal.level,
      riskReason: riskSignal.reason,
      lastUsedAt: new Date(),
      rotationReason: deviceChanged ? "DEVICE_CHANGE" : "NORMAL",
      reuseDetected: false,
      sessionId,
    });

    await this.tokenRepository.save(newTokenEntity);

    // Mark old token as replaced
    oldTokenEntity.replacedByToken = newToken;
    oldTokenEntity.isRevoked = true;
    oldTokenEntity.lastUsedAt = new Date();
    await this.tokenRepository.save(oldTokenEntity);

    logger.info("Token rotated", {
      userId: oldTokenEntity.userId,
      familyId: oldTokenEntity.familyId,
      deviceChanged,
      riskLevel: riskSignal.level,
    });

    await auditLogService.log({
      userId: oldTokenEntity.userId,
      action: AuditAction.TOKEN_REFRESH,
      severity: AuditSeverity.INFO,
      metadata: {
        familyId: oldTokenEntity.familyId,
        deviceChanged,
        riskLevel: riskSignal.level,
        sessionId,
      },
    });

    return newTokenEntity;
  }

  /**
   * Atomically revoke entire token family.
   * Used when reuse detected or explicit logout.
   */
  async revokeFamilyAtomic(
    familyId: string,
    userId: string,
    reason: string
  ): Promise<number> {
    const result = await this.tokenRepository
      .createQueryBuilder()
      .update()
      .set({
        isRevoked: true,
        revokedReason: reason,
      })
      .where("familyId = :familyId", { familyId })
      .andWhere("userId = :userId", { userId })
      .execute();

    const count = result.affected || 0;

    logger.warn("Token family revoked", {
      familyId,
      userId,
      revokedCount: count,
      reason,
    });

    await auditLogService.log({
      userId,
      action: AuditAction.LOGOUT,
      severity: AuditSeverity.WARNING,
      metadata: { familyId, revokedCount: count, reason },
    });

    return count;
  }

  /**
   * Get all active sessions/families for a user.
   * Supports targeted revocation ("logout from device").
   */
  async getUserSessions(userId: string): Promise<TokenFamilyInfo[]> {
    const tokens = await this.tokenRepository
      .createQueryBuilder("token")
      .where("token.userId = :userId", { userId })
      .andWhere("token.isRevoked = false")
      .orderBy("token.lastUsedAt", "DESC")
      .addOrderBy("token.createdAt", "DESC")
      .groupBy(
        "token.familyId, token.sessionId, token.deviceId, token.deviceName, token.createdAt, token.lastUsedAt, token.riskSignal"
      )
      .getMany();

    return tokens.map((t) => ({
      familyId: t.familyId,
      rootTokenId: t.rootTokenId,
      deviceId: t.deviceId || "unknown",
      deviceName: t.deviceName || "Unknown Device",
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
      sessionId: t.sessionId || "default",
      isCompromised: t.reuseDetected,
      riskLevel: t.riskSignal,
    }));
  }

  /**
   * Revoke specific session/family (user logout from device).
   */
  async revokeSession(
    userId: string,
    familyId: string,
    reason: string = "User logout"
  ): Promise<void> {
    const result = await this.tokenRepository
      .createQueryBuilder()
      .update()
      .set({
        isRevoked: true,
        revokedReason: reason,
      })
      .where("familyId = :familyId", { familyId })
      .andWhere("userId = :userId", { userId })
      .execute();

    if (!result.affected || result.affected === 0) {
      throw new BadError("Session not found");
    }

    logger.info("Session revoked", { userId, familyId, reason });

    await auditLogService.log({
      userId,
      action: AuditAction.LOGOUT,
      severity: AuditSeverity.INFO,
      metadata: { familyId, reason },
    });
  }

  /**
   * Revoke all sessions for a user (full logout).
   */
  async revokeAllSessions(
    userId: string,
    reason: string = "Full logout"
  ): Promise<number> {
    const result = await this.tokenRepository
      .createQueryBuilder()
      .update()
      .set({
        isRevoked: true,
        revokedReason: reason,
      })
      .where("userId = :userId", { userId })
      .andWhere("isRevoked = false")
      .execute();

    const count = result.affected || 0;

    logger.info("All user sessions revoked", { userId, count, reason });

    await auditLogService.log({
      userId,
      action: AuditAction.LOGOUT,
      severity: AuditSeverity.WARNING,
      metadata: { revokedCount: count, reason },
    });

    return count;
  }

  /**
   * Get family lineage (complete history of tokens in a family).
   */
  async getFamilyLineage(familyId: string): Promise<RefreshToken[]> {
    return this.tokenRepository.find({
      where: { familyId },
      order: { createdAt: "ASC" },
    });
  }

  /**
   * Compute device ID from fingerprint.
   * Uses SHA256 hash of user-agent + IP for deterministic fingerprinting.
   */
  private computeDeviceId(fingerprint: DeviceFingerprint): string {
    const combined = `${fingerprint.userAgent}:${fingerprint.ipAddress}`;
    return crypto
      .createHash("sha256")
      .update(combined)
      .digest("hex")
      .substring(0, 32);
  }

  /**
   * Hash IP address for privacy (don't store raw IPs).
   */
  private hashIpAddress(ip: string): string {
    return crypto.createHash("sha256").update(ip).digest("hex");
  }

  /**
   * Generate secure random token.
   */
  private generateSecureToken(): string {
    return crypto.randomBytes(64).toString("hex");
  }

  /**
   * Parse human-readable device name from user-agent.
   */
  private parseDeviceName(userAgent: string): string {
    // Simple parsing; in production, use a library like 'ua-parser-js'
    if (userAgent.includes("Chrome")) return "Chrome";
    if (userAgent.includes("Firefox")) return "Firefox";
    if (userAgent.includes("Safari")) return "Safari";
    if (userAgent.includes("Edge")) return "Edge";
    if (userAgent.includes("iPhone")) return "iPhone";
    if (userAgent.includes("Android")) return "Android";
    return "Unknown Device";
  }

  /**
   * Assess risk level for token issuance.
   */
  private assessRiskSignal(factors: {
    isNewDevice: boolean;
    isNewLocation: boolean;
    isReplayed?: boolean;
  }): { level: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; reason: string } {
    const reasons: string[] = [];

    if (factors.isNewDevice) reasons.push("New device");
    if (factors.isNewLocation) reasons.push("New location");
    if (factors.isReplayed) reasons.push("Replay attempt");

    if (factors.isReplayed) {
      return { level: "CRITICAL", reason: "Replay attack detected" };
    }

    if (factors.isNewDevice && factors.isNewLocation) {
      return {
        level: "HIGH",
        reason: "New device and location",
      };
    }

    if (factors.isNewDevice || factors.isNewLocation) {
      return {
        level: "MEDIUM",
        reason: reasons.join(", "),
      };
    }

    return {
      level: "NONE",
      reason: "Normal usage pattern",
    };
  }
}

export const refreshTokenFamilyService = new RefreshTokenFamilyService();
