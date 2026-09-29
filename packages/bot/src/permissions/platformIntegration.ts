/**
 * Platform Role Integration for Permission Matrix
 * Bridges the permission matrix with Discord/Telegram role systems
 */

import type { Client } from 'discord.js';
import {
  PermissionMatrix,
  PermissionContext,
  PermissionCheckResult,
  PlatformRoleMapping,
} from './matrix.js';

/**
 * Platform-specific role data
 */
export interface PlatformRoleData {
  platform: string;
  userId: string;
  guildId?: string;
  roles: string[];
  isAdmin?: boolean;
  isModerator?: boolean;
  isVerified?: boolean;
}

/**
 * Platform role fetcher interface
 */
export interface PlatformRoleFetcher {
  /**
   * Fetch roles for a user on a platform
   */
  fetchRoles(userId: string, guildId?: string): Promise<string[]>;

  /**
   * Check if user has admin role
   */
  isAdmin(userId: string, guildId?: string): Promise<boolean>;

  /**
   * Check if user has moderator role
   */
  isModerator(userId: string, guildId?: string): Promise<boolean>;

  /**
   * Check if user is verified
   */
  isVerified(userId: string, guildId?: string): Promise<boolean>;
}

/**
 * Discord role fetcher implementation
 */
export class DiscordRoleFetcher implements PlatformRoleFetcher {
  private client: Client;
  private adminRoleIds: Set<string>;
  private moderatorRoleIds: Set<string>;
  private verifiedRoleIds: Set<string>;
  private roleCache: Map<string, { roles: string[]; expiresAt: number }>;

  constructor(
    client: Client,
    options: {
      adminRoleIds?: string[];
      moderatorRoleIds?: string[];
      verifiedRoleIds?: string[];
    } = {}
  ) {
    this.client = client;
    this.adminRoleIds = new Set(options.adminRoleIds || []);
    this.moderatorRoleIds = new Set(options.moderatorRoleIds || []);
    this.verifiedRoleIds = new Set(options.verifiedRoleIds || []);
    this.roleCache = new Map();
  }

  /**
   * Add admin role ID
   */
  addAdminRoleId(roleId: string): void {
    this.adminRoleIds.add(roleId);
  }

  /**
   * Add moderator role ID
   */
  addModeratorRoleId(roleId: string): void {
    this.moderatorRoleIds.add(roleId);
  }

  /**
   * Add verified role ID
   */
  addVerifiedRoleId(roleId: string): void {
    this.verifiedRoleIds.add(roleId);
  }

  /**
   * Fetch roles from Discord
   */
  async fetchRoles(userId: string, guildId?: string): Promise<string[]> {
    if (!guildId) {
      return [];
    }

    // Check cache
    const cacheKey = `${userId}:${guildId}`;
    const cached = this.roleCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.roles;
    }

    try {
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);

      const roles = member.roles.cache.map((role) => role.id);

      // Cache for 5 minutes
      this.roleCache.set(cacheKey, {
        roles,
        expiresAt: Date.now() + 300000,
      });

      return roles;
    } catch (error) {
      // @ts-ignore - console should be available at runtime
      if (typeof console !== 'undefined') {
        // @ts-ignore
        console.error('Failed to fetch Discord roles:', error);
      }
      return [];
    }
  }

  /**
   * Check if user has admin role
   */
  async isAdmin(userId: string, guildId?: string): Promise<boolean> {
    if (!guildId) return false;

    const roles = await this.fetchRoles(userId, guildId);
    return roles.some(roleId => this.adminRoleIds.has(roleId));
  }

  /**
   * Check if user has moderator role
   */
  async isModerator(userId: string, guildId?: string): Promise<boolean> {
    if (!guildId) return false;

    const roles = await this.fetchRoles(userId, guildId);
    return roles.some(roleId => this.moderatorRoleIds.has(roleId));
  }

  /**
   * Check if user is verified
   */
  async isVerified(userId: string, guildId?: string): Promise<boolean> {
    if (!guildId) return false;

    const roles = await this.fetchRoles(userId, guildId);
    return roles.some(roleId => this.verifiedRoleIds.has(roleId));
  }

  /**
   * Invalidate cache for user
   */
  invalidateCache(userId: string, guildId: string): void {
    const cacheKey = `${userId}:${guildId}`;
    this.roleCache.delete(cacheKey);
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.roleCache.clear();
  }
}

/**
 * Telegram role fetcher implementation
 * Note: Telegram doesn't have server roles, so this is a stub
 */
export class TelegramRoleFetcher implements PlatformRoleFetcher {
  async fetchRoles(userId: string, guildId?: string): Promise<string[]> {
    // Telegram doesn't have server roles
    return [];
  }

  async isAdmin(userId: string, guildId?: string): Promise<boolean> {
    // Telegram doesn't have server roles
    return false;
  }

  async isModerator(userId: string, guildId?: string): Promise<boolean> {
    // Telegram doesn't have server roles
    return false;
  }

  async isVerified(userId: string, guildId?: string): Promise<boolean> {
    // Telegram doesn't have server roles
    return false;
  }
}

/**
 * Platform permission integration service
 */
export class PlatformPermissionIntegration {
  private permissionMatrix: PermissionMatrix;
  private roleFetchers: Map<string, PlatformRoleFetcher>;
  private platformMappings: PlatformRoleMapping[];

  constructor(permissionMatrix?: PermissionMatrix) {
    this.permissionMatrix = permissionMatrix || new PermissionMatrix();
    this.roleFetchers = new Map();
    this.platformMappings = [];
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
   * Register a platform role fetcher
   */
  registerRoleFetcher(platform: string, fetcher: PlatformRoleFetcher): void {
    this.roleFetchers.set(platform, fetcher);
  }

  /**
   * Add platform role mapping
   */
  addPlatformMapping(mapping: PlatformRoleMapping): void {
    this.platformMappings.push(mapping);
    this.permissionMatrix.addPlatformMapping(mapping);
  }

  /**
   * Fetch platform roles
   */
  async fetchPlatformRoles(
    platform: string,
    userId: string,
    guildId?: string
  ): Promise<string[]> {
    const fetcher = this.roleFetchers.get(platform);
    if (!fetcher) {
      return [];
    }

    return await fetcher.fetchRoles(userId, guildId);
  }

  /**
   * Create permission context with platform roles
   */
  async createPermissionContext(
    platform: string,
    userId: string,
    isDM: boolean,
    guildId?: string,
    additionalContext?: Partial<PermissionContext>
  ): Promise<PermissionContext> {
    const roles = await this.fetchPlatformRoles(platform, userId, guildId);

    const fetcher = this.roleFetchers.get(platform);
    let isAdmin = false;
    let isModerator = false;
    let isVerified = false;

    if (fetcher) {
      isAdmin = await fetcher.isAdmin(userId, guildId);
      isModerator = await fetcher.isModerator(userId, guildId);
      isVerified = await fetcher.isVerified(userId, guildId);
    }

    return {
      userId,
      platform,
      platformRoles: roles,
      isAuthenticated: false, // Will be set by backend integration
      isEmailVerified: false, // Will be set by backend integration
      isWalletDeployed: false, // Will be set by backend integration
      isWalletFunded: false, // Will be set by backend integration
      isDM,
      guildId,
      metadata: {
        isAdmin,
        isModerator,
        isVerified,
        ...additionalContext?.metadata,
      },
      ...additionalContext,
    };
  }

  /**
   * Check permission with platform roles
   */
  async checkPermission(
    command: string,
    platform: string,
    userId: string,
    isDM: boolean,
    guildId?: string
  ): Promise<PermissionCheckResult> {
    const context = await this.createPermissionContext(
      platform,
      userId,
      isDM,
      guildId
    );

    return await this.permissionMatrix.checkPermission(command, context);
  }

  /**
   * Check if user has platform admin role
   */
  async isPlatformAdmin(
    platform: string,
    userId: string,
    guildId?: string
  ): Promise<boolean> {
    const fetcher = this.roleFetchers.get(platform);
    if (!fetcher) return false;

    return await fetcher.isAdmin(userId, guildId);
  }

  /**
   * Check if user has platform moderator role
   */
  async isPlatformModerator(
    platform: string,
    userId: string,
    guildId?: string
  ): Promise<boolean> {
    const fetcher = this.roleFetchers.get(platform);
    if (!fetcher) return false;

    return await fetcher.isModerator(userId, guildId);
  }

  /**
   * Invalidate platform role cache
   */
  invalidateCache(platform: string, userId: string, guildId?: string): void {
    const fetcher = this.roleFetchers.get(platform);
    if (fetcher && 'invalidateCache' in fetcher) {
      (fetcher as DiscordRoleFetcher).invalidateCache(userId, guildId!);
    }
  }

  /**
   * Clear all platform caches
   */
  clearAllCaches(): void {
    for (const fetcher of this.roleFetchers.values()) {
      if ('clearCache' in fetcher) {
        (fetcher as DiscordRoleFetcher).clearCache();
      }
    }
  }
}
