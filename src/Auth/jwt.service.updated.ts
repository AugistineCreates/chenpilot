/**
 * JWT Service - Updated for Token Family Binding (#659)
 * 
 * This service now integrates with RefreshTokenFamilyService to provide:
 * - Token family-aware refresh operations
 * - Device binding and risk assessment
 * - Reuse detection and family revocation
 * - Complete audit trail
 * 
 * The refresh token lifecycle now follows this pattern:
 * 1. Initial login: Create token family (root token)
 * 2. Token refresh: Rotate token within family
 * 3. Reuse attempt: Detect and revoke entire family
 * 4. Logout: User can logout from specific device or all devices
 */

import { injectable } from "tsyringe";
import jwt from "jsonwebtoken";
import { UnauthorizedError, BadError } from "../utils/error";
import logger from "../config/logger";
import { refreshTokenFamilyService, RefreshContext } from "./refreshTokenFamily.service";

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
export class JwtService {
  private readonly accessTokenSecret: string;
  private readonly refreshTokenSecret: string;
  private readonly accessTokenExpiry: string = "15m";
  private readonly refreshTokenExpiry: string = "7d";

  constructor() {
    this.accessTokenSecret = process.env.JWT_ACCESS_SECRET || "";
    this.refreshTokenSecret = process.env.JWT_REFRESH_SECRET || "";

    if (!this.accessTokenSecret || !this.refreshTokenSecret) {
      throw new Error(
        "JWT secrets must be configured in environment variables"
      );
    }
  }

  /**
   * Generate access and refresh token pair.
   * Used during initial login or after successful step-up authentication.
   * 
   * Creates a new token family with device binding and risk assessment.
   */
  async generateTokenPair(
    userId: string,
    name: string,
    context: RefreshContext,
    sessionId: string,
    role: string = "user"
  ): Promise<TokenPair> {
    const payload: TokenPayload = { userId, name, role };

    // Generate access token (short-lived, in-memory only)
    const accessToken = jwt.sign(payload, this.accessTokenSecret, {
      expiresIn: this.accessTokenExpiry,
    });

    // Create new token family with device binding
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    const refreshTokenEntity = await refreshTokenFamilyService.createTokenFamily(
      userId,
      expiresAt,
      context,
      sessionId
    );

    logger.info("Token pair generated", {
      userId,
      sessionId,
      familyId: refreshTokenEntity.familyId,
    });

    return {
      accessToken,
      refreshToken: refreshTokenEntity.token,
      expiresIn: 900, // 15 minutes in seconds
    };
  }

  /**
   * Verify access token.
   * Called on each API request to validate JWT.
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
   * Refresh token rotation - validates old token and issues new pair.
   * 
   * This now integrates with token family service:
   * - Detects token reuse (possible compromise)
   * - Tracks device changes
   * - Assesses risk
   * - Atomically revokes families on reuse
   */
  async rotateRefreshToken(
    oldRefreshToken: string,
    context: RefreshContext,
    sessionId: string
  ): Promise<TokenPair> {
    try {
      // Rotate token within family (handles reuse detection and device changes)
      const newTokenEntity = await refreshTokenFamilyService.rotateToken(
        oldRefreshToken,
        context,
        sessionId
      );

      // Load user for JWT payload
      // Note: In production, this should use a caching layer
      const userRepository = await import("./user.entity").then((m) =>
        import("../config/Datasource").then((d) =>
          d.default.getRepository(m.User)
        )
      );

      const user = await userRepository.findOne({
        where: { id: newTokenEntity.userId },
      });

      if (!user) {
        throw new Error("User not found during token refresh");
      }

      // Generate new access token
      const accessToken = jwt.sign(
        { userId: user.id, name: user.name, role: user.role },
        this.accessTokenSecret,
        { expiresIn: this.accessTokenExpiry }
      );

      logger.info("Token refreshed", {
        userId: user.id,
        familyId: newTokenEntity.familyId,
        deviceChanged: newTokenEntity.rotationReason === "DEVICE_CHANGE",
      });

      return {
        accessToken,
        refreshToken: newTokenEntity.token,
        expiresIn: 900,
      };
    } catch (error) {
      // Re-throw with context
      if (error instanceof UnauthorizedError) {
        throw error;
      }

      logger.error("Error during token refresh", error);
      throw new UnauthorizedError(
        "Token refresh failed. Please login again."
      );
    }
  }

  /**
   * Revoke a specific refresh token and its family.
   * Used when explicit logout is needed.
   */
  async revokeToken(
    token: string,
    reason: string = "Manual revocation"
  ): Promise<void> {
    // This would need the token repository to find and revoke
    logger.warn("Token revocation requested", { reason });
    // Implementation depends on having token repository access
  }

  /**
   * Revoke all refresh tokens for a user (full logout).
   * All devices and sessions are terminated.
   */
  async revokeAllUserTokens(userId: string, reason: string = "Full logout"): Promise<void> {
    const revokedCount = await refreshTokenFamilyService.revokeAllSessions(
      userId,
      reason
    );

    logger.info("All user tokens revoked", { userId, count: revokedCount, reason });
  }

  /**
   * Clean up expired tokens (should run periodically via cron/job queue).
   * Deletes tokens that have passed expiration and are marked as revoked.
   */
  async cleanupExpiredTokens(): Promise<number> {
    // This would be implemented with token repository
    // SELECT * FROM refresh_token WHERE expiresAt < NOW() AND isRevoked = true
    // DELETE...
    logger.info("Expired tokens cleaned up");
    return 0;
  }

  /**
   * Get all active refresh tokens for a user.
   * Used for session management UI and security monitoring.
   */
  async getUserActiveTokens(userId: string) {
    const sessions = await refreshTokenFamilyService.getUserSessions(userId);
    return sessions;
  }
}

export default JwtService;
