/**
 * Role Gate
 * Role-based access control system for Discord
 */

export interface RoleGate {
  command: string;
  requiredRoles: string[];
  requireAll?: boolean;
  allowAdminOverride?: boolean;
  customCheck?: (userId: string, roles: string[]) => Promise<boolean>;
}

export interface RoleCacheEntry {
  userId: string;
  roles: string[];
  guildId: string;
  cachedAt: number;
  ttl: number;
}

export class RoleGate {
  private gates: Map<string, RoleGate>;
  private roleCache: Map<string, RoleCacheEntry>;
  private adminRoleIds: Set<string>;

  constructor() {
    this.gates = new Map();
    this.roleCache = new Map();
    this.adminRoleIds = new Set();
  }

  /**
   * Register a role gate for a command
   */
  registerGate(gate: RoleGate): void {
    this.gates.set(gate.command, gate);
  }

  /**
   * Unregister a role gate
   */
  unregisterGate(command: string): void {
    this.gates.delete(command);
  }

  /**
   * Check if user can execute command based on roles
   */
  async checkGate(command: string, userId: string, guildId: string): Promise<boolean> {
    const gate = this.gates.get(command);
    if (!gate) {
      // No gate means command is public
      return true;
    }

    const userRoles = await this.getUserRoles(userId, guildId);

    // Check admin override
    if (gate.allowAdminOverride && this.hasAdminRole(userRoles)) {
      return true;
    }

    // Check custom check if provided
    if (gate.customCheck) {
      return await gate.customCheck(userId, userRoles);
    }

    // Check required roles
    if (gate.requireAll) {
      return gate.requiredRoles.every(role => userRoles.includes(role));
    } else {
      return gate.requiredRoles.some(role => userRoles.includes(role));
    }
  }

  /**
   * Get required roles for a command
   */
  getRequiredRoles(command: string): string[] {
    const gate = this.gates.get(command);
    return gate?.requiredRoles || [];
  }

  /**
   * Check custom gate condition
   */
  async checkCustomGate(command: string, userId: string, roles: string[]): Promise<boolean> {
    const gate = this.gates.get(command);
    if (!gate || !gate.customCheck) {
      return true;
    }
    return await gate.customCheck(userId, roles);
  }

  /**
   * Get user roles with caching
   */
  private async getUserRoles(userId: string, guildId: string): Promise<string[]> {
    const cacheKey = `${userId}:${guildId}`;
    const cached = this.roleCache.get(cacheKey);

    if (cached && Date.now() - cached.cachedAt < cached.ttl) {
      return cached.roles;
    }

    // TODO: Fetch roles from Discord API
    const roles: string[] = []; // Placeholder

    // Cache the result
    this.roleCache.set(cacheKey, {
      userId,
      roles,
      guildId,
      cachedAt: Date.now(),
      ttl: 300000, // 5 minutes
    });

    return roles;
  }

  /**
   * Check if user has admin role
   */
  private hasAdminRole(roles: string[]): boolean {
    return roles.some(role => this.adminRoleIds.has(role));
  }

  /**
   * Set admin role IDs
   */
  setAdminRoleIds(roleIds: string[]): void {
    this.adminRoleIds = new Set(roleIds);
  }

  /**
   * Add admin role ID
   */
  addAdminRoleId(roleId: string): void {
    this.adminRoleIds.add(roleId);
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

  /**
   * Clean up expired cache entries
   */
  cleanupCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.roleCache.entries()) {
      if (now - entry.cachedAt > entry.ttl) {
        this.roleCache.delete(key);
      }
    }
  }

  /**
   * Get all registered gates
   */
  getAllGates(): RoleGate[] {
    return Array.from(this.gates.values());
  }
}
