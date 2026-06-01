import { injectable } from "tsyringe";
import jwt from "jsonwebtoken";
import { Repository } from "typeorm";
import { RefreshToken } from "./refreshToken.entity";
import AppDataSource from "../config/Datasource";
import { UnauthorizedError, BadError } from "../utils/error";
import crypto from "crypto";

interface TokenPayload {
  userId: string;
  name: string;
  role: string;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@injectable()
export default class JwtService {
  private refreshTokenRepository: Repository<RefreshToken>;
  private readonly accessTokenSecret: string;
  private readonly refreshTokenSecret: string;
  private readonly accessTokenExpiry: string = "15m";
  private readonly refreshTokenExpiry: string = "7d";

  constructor() {
    this.refreshTokenRepository = AppDataSource.getRepository(RefreshToken);

    this.accessTokenSecret = process.env.JWT_ACCESS_SECRET || "";
    this.refreshTokenSecret = process.env.JWT_REFRESH_SECRET || "";

    if (!this.accessTokenSecret || !this.refreshTokenSecret) {
      throw new Error(
        "JWT secrets must be configured in environment variables"
      );
    }
  }

  /**
   * Generate access and refresh token pair
   */
  async generateTokenPair(
    userId: string,
    name: string,
    role: string = "user"
  ): Promise<TokenPair> {
    const payload: TokenPayload = { userId, name, role };

    // Generate access token (short-lived)
    const accessToken = jwt.sign(payload, this.accessTokenSecret, {
      expiresIn: this.accessTokenExpiry,
    });

    // Generate refresh token (long-lived)
    const refreshToken = this.generateSecureToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    // Store refresh token in database
    const tokenEntity = this.refreshTokenRepository.create({
      token: refreshToken,
      userId,
      expiresAt,
    });

    await this.refreshTokenRepository.save(tokenEntity);

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 minutes in seconds
    };
  }

  /**
   * Verify access token
   */
  verifyAccessToken(token: string): TokenPayload {
    try {
      const decoded = jwt.verify(token, this.accessTokenSecret) as TokenPayload;
      return decoded;
    } catch {
      throw new UnauthorizedError("Invalid or expired access token");
    }
  }

  /**
   * Refresh token rotation - validates old token and issues new pair
   */
  async rotateRefreshToken(oldRefreshToken: string): Promise<TokenPair> {
    // Find the refresh token in database
    const tokenEntity = await this.refreshTokenRepository.findOne({
      where: { token: oldRefreshToken },
      relations: ["user"],
    });

    if (!tokenEntity) {
      throw new UnauthorizedError("Invalid refresh token");
    }

    // Check if token is revoked
    if (tokenEntity.isRevoked) {
      // Token reuse detected - revoke entire token family for security
      await this.revokeTokenFamily(tokenEntity.userId, "Token reuse detected");
      throw new UnauthorizedError(
        "Token has been revoked due to suspicious activity"
      );
    }

    // Check if token is expired
    if (new Date() > tokenEntity.expiresAt) {
      throw new UnauthorizedError("Refresh token has expired");
    }

    // Generate new token pair
    const newTokenPair = await this.generateTokenPair(
      tokenEntity.user.id,
      tokenEntity.user.name,
      tokenEntity.user.role
    );

    // Mark old token as replaced (for audit trail)
    tokenEntity.isRevoked = true;
    tokenEntity.replacedByToken = newTokenPair.refreshToken;
    await this.refreshTokenRepository.save(tokenEntity);

    return newTokenPair;
  }

  /**
   * Revoke a specific refresh token
   */
  async revokeToken(token: string, reason?: string): Promise<void> {
    const tokenEntity = await this.refreshTokenRepository.findOne({
      where: { token },
    });

    if (!tokenEntity) {
      throw new BadError("Token not found");
    }

    tokenEntity.isRevoked = true;
    tokenEntity.revokedReason = reason || "Manual revocation";
    await this.refreshTokenRepository.save(tokenEntity);
  }

  /**
   * Revoke all refresh tokens for a user (logout from all devices)
   */
  async revokeAllUserTokens(userId: string, reason?: string): Promise<void> {
    await this.refreshTokenRepository.update(
      { userId, isRevoked: false },
      {
        isRevoked: true,
        revokedReason: reason || "User logout from all devices",
      }
    );
  }

  /**
   * Revoke entire token family (security measure for token reuse)
   */
  private async revokeTokenFamily(
    userId: string,
    reason: string
  ): Promise<void> {
    await this.revokeAllUserTokens(userId, reason);
  }

  /**
   * Clean up expired tokens (should be run periodically)
   */
  async cleanupExpiredTokens(): Promise<number> {
    const result = await this.refreshTokenRepository
      .createQueryBuilder()
      .delete()
      .where("expiresAt < :now", { now: new Date() })
      .execute();

    return result.affected || 0;
  }

  /**
   * Get all active refresh tokens for a user
   */
  async getUserActiveTokens(userId: string): Promise<RefreshToken[]> {
    return this.refreshTokenRepository.find({
      where: {
        userId,
        isRevoked: false,
      },
      order: { createdAt: "DESC" },
    });
  }

  /**
   * Generate cryptographically secure random token
   */
  private generateSecureToken(): string {
    return crypto.randomBytes(64).toString("hex");
  }
}
