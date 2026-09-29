import { injectable } from "tsyringe";
import { Repository } from "typeorm";
import crypto from "crypto";
import { BotIdentity, BotPlatform } from "./botIdentity.entity";
import { User } from "./user.entity";
import AppDataSource from "../config/Datasource";
import { auditLogService } from "../AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../AuditLog/auditLog.entity";
import logger from "../config/logger";

export interface LinkBotIdentityPayload {
  userId: string;
  platform: BotPlatform;
  platformUserId: string;
  platformUsername?: string;
  metadata?: Record<string, unknown>;
}

export interface GenerateLinkTokenPayload {
  userId: string;
  platform: BotPlatform;
}

export interface VerifyLinkTokenPayload {
  token: string;
  platformUserId: string;
  platformUsername?: string;
}

@injectable()
export class BotIdentityService {
  private botIdentityRepository: Repository<BotIdentity>;
  private userRepository: Repository<User>;

  constructor() {
    this.botIdentityRepository = AppDataSource.getRepository(BotIdentity);
    this.userRepository = AppDataSource.getRepository(User);
  }

  /**
   * Link a bot identity to a user account
   */
  async linkBotIdentity(
    payload: LinkBotIdentityPayload
  ): Promise<BotIdentity> {
    const { userId, platform, platformUserId, platformUsername, metadata } =
      payload;

    // Verify user exists
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error("User not found");
    }

    // Check if this platform identity is already linked to another user
    const existingIdentity = await this.botIdentityRepository.findOne({
      where: { platform, platformUserId },
    });

    if (existingIdentity) {
      if (existingIdentity.userId === userId) {
        // Already linked to this user, just update
        existingIdentity.platformUsername = platformUsername;
        existingIdentity.metadata = metadata;
        existingIdentity.lastLinkedAt = new Date();
        existingIdentity.isActive = true;
        await this.botIdentityRepository.save(existingIdentity);

        await auditLogService.log({
          userId,
          action: AuditAction.BOT_IDENTITY_LINKED,
          severity: AuditSeverity.INFO,
          metadata: { platform, platformUserId },
        });

        logger.info("Bot identity updated", { userId, platform, platformUserId });
        return existingIdentity;
      } else {
        throw new Error(
          "This bot identity is already linked to another user account"
        );
      }
    }

    // Create new identity link
    const botIdentity = this.botIdentityRepository.create({
      userId,
      platform,
      platformUserId,
      platformUsername,
      metadata,
      lastLinkedAt: new Date(),
      lastUsedAt: new Date(),
      isActive: true,
    });

    await this.botIdentityRepository.save(botIdentity);

    await auditLogService.log({
      userId,
      action: AuditAction.BOT_IDENTITY_LINKED,
      severity: AuditSeverity.INFO,
      metadata: { platform, platformUserId },
    });

    logger.info("Bot identity linked", { userId, platform, platformUserId });
    return botIdentity;
  }

  /**
   * Generate a secure one-time link token for bot identity linking
   */
  async generateLinkToken(
    payload: GenerateLinkTokenPayload
  ): Promise<{ token: string; expiresAt: Date }> {
    const { userId, platform } = payload;

    // Verify user exists
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error("User not found");
    }

    // Generate secure token
    const tokenData = JSON.stringify({
      userId,
      platform,
      timestamp: Date.now(),
      nonce: crypto.randomBytes(16).toString("hex"),
    });
    const token = crypto
      .createHash("sha256")
      .update(tokenData)
      .digest("hex")
      .substring(0, 32);

    // Store token with expiry (15 minutes)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Store in metadata for now (in production, use Redis)
    await this.userRepository.update(userId, {
      resetTokenHash: token,
      resetTokenExpiry: expiresAt,
    });

    await auditLogService.log({
      userId,
      action: AuditAction.BOT_LINK_TOKEN_GENERATED,
      severity: AuditSeverity.INFO,
      metadata: { platform },
    });

    logger.info("Bot link token generated", { userId, platform });
    return { token, expiresAt };
  }

  /**
   * Verify and consume a link token
   */
  async verifyLinkToken(
    payload: VerifyLinkTokenPayload
  ): Promise<{ userId: string; platform: BotPlatform }> {
    const { token, platformUserId, platformUsername } = payload;

    // Find user with valid token
    const user = await this.userRepository.findOne({
      where: {
        resetTokenHash: token,
        resetTokenExpiry: { $gte: new Date() } as any,
      },
    });

    if (!user) {
      throw new Error("Invalid or expired link token");
    }

    // Check if token has expired
    if (user.resetTokenExpiry && new Date() > user.resetTokenExpiry) {
      throw new Error("Link token has expired");
    }

    // Extract platform from token (simplified - in production, decode properly)
    const platform = this.extractPlatformFromToken(token);

    // Clear the token
    await this.userRepository.update(user.id, {
      resetTokenHash: undefined,
      resetTokenExpiry: undefined,
    });

    await auditLogService.log({
      userId: user.id,
      action: AuditAction.BOT_LINK_TOKEN_VERIFIED,
      severity: AuditSeverity.INFO,
      metadata: { platform: platform, platformUserId },
    });

    logger.info("Bot link token verified", {
      userId: user.id,
      platform,
      platformUserId,
    });

    return { userId: user.id, platform };
  }

  /**
   * Get all bot identities for a user
   */
  async getUserBotIdentities(userId: string): Promise<BotIdentity[]> {
    return this.botIdentityRepository.find({
      where: { userId, isActive: true },
      order: { createdAt: "DESC" },
    });
  }

  /**
   * Get user by bot identity
   */
  async getUserByBotIdentity(
    platform: BotPlatform,
    platformUserId: string
  ): Promise<User | null> {
    const identity = await this.botIdentityRepository.findOne({
      where: { platform, platformUserId, isActive: true },
      relations: ["user"],
    });

    if (!identity) {
      return null;
    }

    // Update last used timestamp
    identity.lastUsedAt = new Date();
    await this.botIdentityRepository.save(identity);

    return identity.user;
  }

  /**
   * Unlink a bot identity
   */
  async unlinkBotIdentity(
    userId: string,
    platform: BotPlatform
  ): Promise<void> {
    const identity = await this.botIdentityRepository.findOne({
      where: { userId, platform },
    });

    if (!identity) {
      throw new Error("Bot identity not found");
    }

    await this.botIdentityRepository.remove(identity);

    await auditLogService.log({
      userId,
      action: AuditAction.BOT_IDENTITY_UNLINKED,
      severity: AuditSeverity.INFO,
      metadata: { platform },
    });

    logger.info("Bot identity unlinked", { userId, platform });
  }

  /**
   * Update last used timestamp for a bot identity
   */
  async updateLastUsed(
    platform: BotPlatform,
    platformUserId: string
  ): Promise<void> {
    const identity = await this.botIdentityRepository.findOne({
      where: { platform, platformUserId },
    });

    if (identity) {
      identity.lastUsedAt = new Date();
      await this.botIdentityRepository.save(identity);
    }
  }

  /**
   * Extract platform from token (simplified implementation)
   * In production, use proper JWT or encrypted token
   */
  private extractPlatformFromToken(token: string): BotPlatform {
    // This is a simplified version. In production, decode the token properly
    // For now, we'll need to pass the platform explicitly or use a better token format
    return BotPlatform.TELEGRAM; // Default fallback
  }
}

export const botIdentityService = new BotIdentityService();
