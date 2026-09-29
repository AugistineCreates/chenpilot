/**
 * Permission Checking Middleware
 * Integrates the permission matrix with bot command guards
 */

import type { CommandContext, CommandHandler, GuardResult } from '../commands/types.js';
import {
  PermissionMatrix,
  PermissionContext,
  PermissionCheckResult,
  PermissionMatrixEntry,
  PermissionLevel,
  PermissionLevelHierarchy,
  ContractCapability,
  CapabilityPermissionRequirements,
  DefaultPermissionMatrix,
} from './matrix.js';
import { BackendPermissionIntegration } from './backendIntegration.js';
import { PlatformPermissionIntegration } from './platformIntegration.js';

/**
 * Permission middleware configuration
 */
export interface PermissionMiddlewareConfig {
  permissionMatrix?: PermissionMatrix;
  backendIntegration?: BackendPermissionIntegration;
  platformIntegration?: PlatformPermissionIntegration;
}

/**
 * Narrow an opaque adapter payload down to `{ guildId: string }` without a
 * blanket cast. `ctx.raw` is intentionally `unknown` — see CommandContext.
 */
function isRecordWithGuildId(value: unknown): value is { guildId: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'guildId' in value &&
    typeof (value as { guildId: unknown }).guildId === 'string'
  );
}

/**
 * Permission middleware service
 */
export class PermissionMiddleware {
  private permissionMatrix: PermissionMatrix;
  private backendIntegration?: BackendPermissionIntegration;
  private platformIntegration?: PlatformPermissionIntegration;

  constructor(config: PermissionMiddlewareConfig = {}) {
    this.permissionMatrix = config.permissionMatrix || new PermissionMatrix();
    this.backendIntegration = config.backendIntegration;
    this.platformIntegration = config.platformIntegration;

    // Load default permission matrix if not provided
    if (!config.permissionMatrix) {
      for (const entry of DefaultPermissionMatrix) {
        this.permissionMatrix.setEntry(entry);
      }
    }
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
   * Set backend integration
   */
  setBackendIntegration(integration: BackendPermissionIntegration): void {
    this.backendIntegration = integration;
  }

  /**
   * Set platform integration
   */
  setPlatformIntegration(integration: PlatformPermissionIntegration): void {
    this.platformIntegration = integration;
  }

  /**
   * Create permission context from command context
   */
  async createPermissionContext(ctx: CommandContext): Promise<PermissionContext> {
    // Fetch backend user data if available
    let backendRole = undefined;
    let isAuthenticated = false;
    let isEmailVerified = false;
    let isWalletDeployed = false;
    let isWalletFunded = false;

    if (this.backendIntegration) {
      const userData = await this.backendIntegration.fetchUserData(ctx.userId);
      if (userData) {
        backendRole = userData.role;
        isAuthenticated = true;
        isEmailVerified = userData.isEmailVerified;
        isWalletDeployed = userData.isWalletDeployed;
        isWalletFunded = userData.isWalletFunded;
      }
    }

    // Fetch platform roles if available
    let platformRoles = ctx.roles || [];
    let guildId: string | undefined;

    // Try to extract guildId from raw context if available. `ctx.raw` is
    // intentionally `unknown` (it's an opaque, adapter-specific payload —
    // see CommandContext) so we narrow it defensively rather than casting.
    if (isRecordWithGuildId(ctx.raw)) {
      guildId = ctx.raw.guildId;
    }

    if (this.platformIntegration) {
      platformRoles = await this.platformIntegration.fetchPlatformRoles(
        ctx.platform,
        ctx.userId,
        guildId
      );
    }

    return {
      userId: ctx.userId,
      backendRole,
      platform: ctx.platform,
      platformRoles,
      isAuthenticated,
      isEmailVerified,
      isWalletDeployed,
      isWalletFunded,
      isDM: ctx.isDM,
      guildId,
      metadata: ctx.raw ? { raw: ctx.raw } : undefined,
    };
  }

  /**
   * Check permission for a command
   */
  async checkCommandPermission(
    command: string,
    ctx: CommandContext
  ): Promise<PermissionCheckResult> {
    const permissionContext = await this.createPermissionContext(ctx);
    return await this.permissionMatrix.checkPermission(command, permissionContext);
  }

  /**
   * Permission guard for command handlers
   */
  async permissionGuard(
    handler: CommandHandler,
    ctx: CommandContext
  ): Promise<GuardResult> {
    const command = handler.name || ctx.command;

    // Check if command has permission entry
    const entry = this.permissionMatrix.getEntry(command);
    if (!entry) {
      // No entry means command is public
      return { passed: true };
    }

    // Check permission
    const result = await this.checkCommandPermission(command, ctx);

    if (result.allowed) {
      return { passed: true };
    }

    // Build denial message
    let reason = result.reason || 'Insufficient permissions';

    // Add helpful information
    if (result.requiredLevel && result.userLevel) {
      reason += `\nRequired: ${result.requiredLevel}\nCurrent: ${result.userLevel}`;
    }

    if (result.missingCapabilities && result.missingCapabilities.length > 0) {
      reason += `\nMissing capabilities: ${result.missingCapabilities.join(', ')}`;
    }

    if (result.missingWalletRequirements && result.missingWalletRequirements.length > 0) {
      reason += `\nMissing requirements: ${result.missingWalletRequirements.join(', ')}`;
    }

    return {
      passed: false,
      reason: `🔒 ${reason}`,
    };
  }

  /**
   * Check if user has specific permission level
   */
  async hasPermissionLevel(
    ctx: CommandContext,
    requiredLevel: PermissionLevel
  ): Promise<boolean> {
    const permissionContext = await this.createPermissionContext(ctx);
    const userLevel = this.permissionMatrix.getUserPermissionLevel(permissionContext);
    return PermissionLevelHierarchy[userLevel] >= PermissionLevelHierarchy[requiredLevel];
  }

  /**
   * Check if user has specific contract capability
   */
  async hasContractCapability(
    ctx: CommandContext,
    capability: ContractCapability
  ): Promise<boolean> {
    const permissionContext = await this.createPermissionContext(ctx);
    const userLevel = this.permissionMatrix.getUserPermissionLevel(permissionContext);
    const requiredLevel = CapabilityPermissionRequirements[capability];
    return PermissionLevelHierarchy[userLevel] >= PermissionLevelHierarchy[requiredLevel];
  }

  /**
   * Add permission matrix entry
   */
  addPermissionEntry(entry: PermissionMatrixEntry): void {
    this.permissionMatrix.setEntry(entry);
  }

  /**
   * Remove permission matrix entry
   */
  removePermissionEntry(command: string): void {
    this.permissionMatrix.removeEntry(command);
  }

  /**
   * Get all permission entries
   */
  getAllEntries(): PermissionMatrixEntry[] {
    return this.permissionMatrix.getAllEntries();
  }
}

/**
 * Global permission middleware instance
 */
export const permissionMiddleware = new PermissionMiddleware();

/**
 * Permission guard function for use in command handlers
 */
export async function permissionGuard(
  handler: CommandHandler,
  ctx: CommandContext
): Promise<GuardResult> {
  return await permissionMiddleware.permissionGuard(handler, ctx);
}
