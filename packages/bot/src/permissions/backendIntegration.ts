/**
 * Backend Integration for Permission Matrix
 * Bridges the permission matrix with the backend user system
 */

import {
  PermissionMatrix,
  PermissionContext,
  PermissionCheckResult,
  BackendRole,
  PermissionLevel,
} from './matrix.js';
import { SafeBackendClient } from '../commands/services/BackendClient.js';

/**
 * Backend user data
 */
export interface BackendUserData {
  userId: string;
  role: BackendRole;
  isEmailVerified: boolean;
  isWalletDeployed: boolean;
  isWalletFunded: boolean;
  address?: string;
}

/**
 * Shape of the `get_user` backend command response. Fields are optional
 * because the backend contract isn't independently validated here — see
 * fetchUserData()'s defensive `?? ` fallbacks below, which mirror the
 * `|| default` behaviour this replaces.
 */
interface GetUserResponse {
  success?: boolean;
  data?: {
    id?: string;
    role?: BackendRole;
    isEmailVerified?: boolean;
    isDeployed?: boolean;
    isFunded?: boolean;
    address?: string;
  };
}

/**
 * Backend integration service
 */
export class BackendPermissionIntegration {
  private permissionMatrix: PermissionMatrix;
  private backendClient: SafeBackendClient;
  private userCache: Map<string, { data: BackendUserData; expiresAt: number }>;

  constructor(backendClient: SafeBackendClient, permissionMatrix?: PermissionMatrix) {
    this.backendClient = backendClient;
    this.permissionMatrix = permissionMatrix || new PermissionMatrix();
    this.userCache = new Map();
  }

  /**
   * Get permission matrix
   */
  getPermissionMatrix(): PermissionMatrix {
    return this.permissionMatrix;
  }

  /**
   * Set permission matrix
   */
  setPermissionMatrix(matrix: PermissionMatrix): void {
    this.permissionMatrix = matrix;
  }

  /**
   * Fetch user data from backend
   */
  async fetchUserData(userId: string): Promise<BackendUserData | null> {
    // Check cache first
    const cached = this.userCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    try {
      // Use executeCommand to fetch user data
      const response = await this.backendClient.executeCommand<
        { userId: string },
        GetUserResponse
      >('get_user', { userId }, userId);

      if (!response || !response.success || !response.data) {
        return null;
      }

      const userData: BackendUserData = {
        userId: response.data.id ?? userId,
        role: response.data.role || BackendRole.USER,
        isEmailVerified: response.data.isEmailVerified || false,
        isWalletDeployed: response.data.isDeployed || false,
        isWalletFunded: response.data.isFunded || false,
        address: response.data.address,
      };

      // Cache for 5 minutes
      this.userCache.set(userId, {
        data: userData,
        expiresAt: Date.now() + 300000,
      });

      return userData;
    } catch (error) {
      // @ts-ignore - console should be available at runtime
      if (typeof console !== 'undefined') {
        // @ts-ignore
        console.error('Failed to fetch user data:', error);
      }
      return null;
    }
  }

  /**
   * Create permission context from backend user data
   */
  createPermissionContext(
    userData: BackendUserData | null,
    platform: string,
    platformRoles: string[],
    isDM: boolean,
    guildId?: string
  ): PermissionContext {
    return {
      userId: userData?.userId || '',
      backendRole: userData?.role,
      platform,
      platformRoles,
      isAuthenticated: !!userData,
      isEmailVerified: userData?.isEmailVerified || false,
      isWalletDeployed: userData?.isWalletDeployed || false,
      isWalletFunded: userData?.isWalletFunded || false,
      isDM,
      guildId,
      metadata: {
        address: userData?.address,
      },
    };
  }

  /**
   * Check permission for a command
   */
  async checkCommandPermission(
    command: string,
    userId: string,
    platform: string,
    platformRoles: string[],
    isDM: boolean,
    guildId?: string
  ): Promise<PermissionCheckResult> {
    // Fetch user data
    const userData = await this.fetchUserData(userId);

    // Create permission context
    const context = this.createPermissionContext(
      userData,
      platform,
      platformRoles,
      isDM,
      guildId
    );

    // Check permission
    return await this.permissionMatrix.checkPermission(command, context);
  }

  /**
   * Check permission with custom context
   */
  async checkPermissionWithContext(
    command: string,
    context: PermissionContext
  ): Promise<PermissionCheckResult> {
    return await this.permissionMatrix.checkPermission(command, context);
  }

  /**
   * Get user's permission level
   */
  async getUserPermissionLevel(userId: string): Promise<PermissionLevel> {
    const userData = await this.fetchUserData(userId);

    if (!userData) {
      return PermissionLevel.PUBLIC;
    }

    // Map backend role to permission level
    const roleMapping: Record<BackendRole, PermissionLevel> = {
      [BackendRole.USER]: PermissionLevel.AUTHENTICATED,
      [BackendRole.MODERATOR]: PermissionLevel.MODERATOR,
      [BackendRole.ADMIN]: PermissionLevel.ADMIN,
    };

    // Check wallet states for higher levels
    if (userData.isWalletFunded) {
      return PermissionLevel.FUNDED;
    }
    if (userData.isWalletDeployed) {
      return PermissionLevel.DEPLOYED;
    }
    if (userData.isEmailVerified) {
      return PermissionLevel.VERIFIED;
    }

    return roleMapping[userData.role] || PermissionLevel.AUTHENTICATED;
  }

  /**
   * Invalidate user cache
   */
  invalidateUserCache(userId: string): void {
    this.userCache.delete(userId);
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.userCache.clear();
  }

  /**
   * Clean up expired cache entries
   */
  cleanupCache(): void {
    const now = Date.now();
    for (const [userId, cached] of this.userCache.entries()) {
      if (cached.expiresAt < now) {
        this.userCache.delete(userId);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    entries: Array<{ userId: string; expiresAt: number }>;
  } {
    return {
      size: this.userCache.size,
      entries: Array.from(this.userCache.entries()).map(([userId, cached]) => ({
        userId,
        expiresAt: cached.expiresAt,
      })),
    };
  }
}
