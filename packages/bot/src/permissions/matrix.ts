/**
 * Bot Command Permission Matrix
 * Unified permission system mapping user roles, platform roles, backend authorization, and contract capabilities
 */

// ============================================================================
// Permission Levels
// ============================================================================

/**
 * Permission levels for bot commands
 * Higher levels include all permissions from lower levels
 */
export enum PermissionLevel {
  /**
   * No special permissions - basic user access
   */
  PUBLIC = 'public',

  /**
   * Requires authenticated user (linked account)
   */
  AUTHENTICATED = 'authenticated',

  /**
   * Requires verified email
   */
  VERIFIED = 'verified',

  /**
   * Requires deployed wallet
   */
  DEPLOYED = 'deployed',

  /**
   * Requires funded wallet
   */
  FUNDED = 'funded',

  /**
   * Moderator-level permissions
   */
  MODERATOR = 'moderator',

  /**
   * Admin-level permissions
   */
  ADMIN = 'admin',

  /**
   * System-level permissions (internal use only)
   */
  SYSTEM = 'system',
}

/**
 * Permission level hierarchy (higher number = more permissions)
 */
export const PermissionLevelHierarchy: Record<PermissionLevel, number> = {
  [PermissionLevel.PUBLIC]: 0,
  [PermissionLevel.AUTHENTICATED]: 1,
  [PermissionLevel.VERIFIED]: 2,
  [PermissionLevel.DEPLOYED]: 3,
  [PermissionLevel.FUNDED]: 4,
  [PermissionLevel.MODERATOR]: 5,
  [PermissionLevel.ADMIN]: 6,
  [PermissionLevel.SYSTEM]: 7,
};

/**
 * Check if a permission level meets or exceeds the required level
 */
export function hasPermissionLevel(
  userLevel: PermissionLevel,
  requiredLevel: PermissionLevel
): boolean {
  return PermissionLevelHierarchy[userLevel] >= PermissionLevelHierarchy[requiredLevel];
}

// ============================================================================
// Contract Capabilities
// ============================================================================

/**
 * Contract operation capabilities
 * These represent sensitive blockchain operations that require specific permissions
 */
export enum ContractCapability {
  /**
   * Read-only operations (querying state, balances, etc.)
   */
  READ = 'read',

  /**
   * Create trustline
   */
  TRUSTLINE = 'trustline',

  /**
   * Send payment
   */
  PAYMENT = 'payment',

  /**
   * Manage assets (issue, mint, burn)
   */
  ASSET_MANAGEMENT = 'asset_management',

  /**
   * Create and manage multisig accounts
   */
  MULTISIG = 'multisig',

  /**
   * Smart contract operations
   */
  SMART_CONTRACT = 'smart_contract',

  /**
   * Sponsorship operations
   */
  SPONSORSHIP = 'sponsorship',

  /**
   * Claimable balance operations
   */
  CLAIMABLE_BALANCE = 'claimable_balance',

  /**
   * Liquidity pool operations
   */
  LIQUIDITY_POOL = 'liquidity_pool',

  /**
   * Atomic swap operations
   */
  ATOMIC_SWAP = 'atomic_swap',

  /**
   * Fee bump operations
   */
  FEE_BUMP = 'fee_bump',

  /**
   * Account merge operations
   */
  ACCOUNT_MERGE = 'account_merge',

  /**
   * Account recovery operations
   */
  ACCOUNT_RECOVERY = 'account_recovery',

  /**
   * Admin operations (minting, configuration, etc.)
   */
  ADMIN = 'admin',
}

/**
 * Permission requirements for each contract capability
 */
export const CapabilityPermissionRequirements: Record<
  ContractCapability,
  PermissionLevel
> = {
  [ContractCapability.READ]: PermissionLevel.PUBLIC,
  [ContractCapability.TRUSTLINE]: PermissionLevel.AUTHENTICATED,
  [ContractCapability.PAYMENT]: PermissionLevel.DEPLOYED,
  [ContractCapability.ASSET_MANAGEMENT]: PermissionLevel.FUNDED,
  [ContractCapability.MULTISIG]: PermissionLevel.VERIFIED,
  [ContractCapability.SMART_CONTRACT]: PermissionLevel.FUNDED,
  [ContractCapability.SPONSORSHIP]: PermissionLevel.FUNDED,
  [ContractCapability.CLAIMABLE_BALANCE]: PermissionLevel.AUTHENTICATED,
  [ContractCapability.LIQUIDITY_POOL]: PermissionLevel.FUNDED,
  [ContractCapability.ATOMIC_SWAP]: PermissionLevel.FUNDED,
  [ContractCapability.FEE_BUMP]: PermissionLevel.AUTHENTICATED,
  [ContractCapability.ACCOUNT_MERGE]: PermissionLevel.ADMIN,
  [ContractCapability.ACCOUNT_RECOVERY]: PermissionLevel.ADMIN,
  [ContractCapability.ADMIN]: PermissionLevel.ADMIN,
};

// ============================================================================
// Backend Roles
// ============================================================================

/**
 * Backend user roles (from User entity)
 */
export enum BackendRole {
  USER = 'user',
  MODERATOR = 'moderator',
  ADMIN = 'admin',
}

/**
 * Map backend roles to permission levels
 */
export const BackendRoleToPermissionLevel: Record<BackendRole, PermissionLevel> = {
  [BackendRole.USER]: PermissionLevel.AUTHENTICATED,
  [BackendRole.MODERATOR]: PermissionLevel.MODERATOR,
  [BackendRole.ADMIN]: PermissionLevel.ADMIN,
};

/**
 * Get permission level from backend role
 */
export function getPermissionLevelFromBackendRole(role: BackendRole): PermissionLevel {
  return BackendRoleToPermissionLevel[role] || PermissionLevel.AUTHENTICATED;
}

// ============================================================================
// Platform Roles
// ============================================================================

/**
 * Platform-specific role mappings
 * Maps Discord/Telegram roles to permission levels
 */
export interface PlatformRoleMapping {
  /**
   * Platform identifier (discord, telegram)
   */
  platform: string;

  /**
   * Platform-specific role ID or name
   */
  roleId: string;

  /**
   * Permission level granted by this role
   */
  permissionLevel: PermissionLevel;

  /**
   * Whether this role grants admin override
   */
  adminOverride?: boolean;
}

/**
 * Default platform role mappings
 */
export const DefaultPlatformRoleMappings: PlatformRoleMapping[] = [
  // Discord admin roles
  {
    platform: 'discord',
    roleId: 'admin',
    permissionLevel: PermissionLevel.ADMIN,
    adminOverride: true,
  },
  {
    platform: 'discord',
    roleId: 'moderator',
    permissionLevel: PermissionLevel.MODERATOR,
  },
  {
    platform: 'discord',
    roleId: 'verified',
    permissionLevel: PermissionLevel.VERIFIED,
  },
  // Telegram doesn't have server roles, so no default mappings
];

// ============================================================================
// Permission Matrix Entry
// ============================================================================

/**
 * Permission matrix entry for a bot command
 */
export interface PermissionMatrixEntry {
  /**
   * Command identifier (e.g., "trustline", "swap", "multisig")
   */
  command: string;

  /**
   * Base permission level required
   */
  permissionLevel: PermissionLevel;

  /**
   * Contract capabilities required (if applicable)
   */
  contractCapabilities?: ContractCapability[];

  /**
   * Backend roles that grant access (in addition to permission level)
   */
  backendRoles?: BackendRole[];

  /**
   * Platform-specific role requirements
   */
  platformRoles?: PlatformRoleMapping[];

  /**
   * Whether command requires DM-only (sensitive operations)
   */
  dmOnly?: boolean;

  /**
   * Whether command requires specific wallet states
   */
  walletRequirements?: {
    deployed?: boolean;
    funded?: boolean;
    verified?: boolean;
  };

  /**
   * Rate limit overrides (optional)
   */
  rateLimit?: {
    maxRequests: number;
    windowMs: number;
  };

  /**
   * Custom permission check function
   */
  customCheck?: (context: PermissionContext) => Promise<boolean>;
}

// ============================================================================
// Permission Context
// ============================================================================

/**
 * Context for permission evaluation
 */
export interface PermissionContext {
  /**
   * User ID
   */
  userId: string;

  /**
   * Backend user role (if authenticated)
   */
  backendRole?: BackendRole;

  /**
   * Platform (discord, telegram)
   */
  platform: string;

  /**
   * Platform-specific roles
   */
  platformRoles: string[];

  /**
   * Whether user is authenticated (linked account)
   */
  isAuthenticated: boolean;

  /**
   * Whether user's email is verified
   */
  isEmailVerified: boolean;

  /**
   * Whether user's wallet is deployed
   */
  isWalletDeployed: boolean;

  /**
   * Whether user's wallet is funded
   */
  isWalletFunded: boolean;

  /**
   * Whether interaction is in DM
   */
  isDM: boolean;

  /**
   * Guild ID (if applicable)
   */
  guildId?: string;

  /**
   * Additional metadata
   */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Permission Check Result
// ============================================================================

/**
 * Result of a permission check
 */
export interface PermissionCheckResult {
  /**
   * Whether permission check passed
   */
  allowed: boolean;

  /**
   * Reason for denial (if not allowed)
   */
  reason?: string;

  /**
   * Required permission level
   */
  requiredLevel?: PermissionLevel;

  /**
   * User's current permission level
   */
  userLevel?: PermissionLevel;

  /**
   * Missing capabilities (if any)
   */
  missingCapabilities?: ContractCapability[];

  /**
   * Missing wallet requirements (if any)
   */
  missingWalletRequirements?: string[];
}

// ============================================================================
// Permission Matrix
// ============================================================================

/**
 * Complete permission matrix for all bot commands
 */
export class PermissionMatrix {
  private entries: Map<string, PermissionMatrixEntry>;
  private platformMappings: PlatformRoleMapping[];

  constructor() {
    this.entries = new Map();
    this.platformMappings = [...DefaultPlatformRoleMappings];
  }

  /**
   * Add or update a permission matrix entry
   */
  setEntry(entry: PermissionMatrixEntry): void {
    this.entries.set(entry.command, entry);
  }

  /**
   * Get a permission matrix entry
   */
  getEntry(command: string): PermissionMatrixEntry | undefined {
    return this.entries.get(command);
  }

  /**
   * Remove a permission matrix entry
   */
  removeEntry(command: string): void {
    this.entries.delete(command);
  }

  /**
   * Add platform role mapping
   */
  addPlatformMapping(mapping: PlatformRoleMapping): void {
    this.platformMappings.push(mapping);
  }

  /**
   * Get platform role mappings for a platform
   */
  getPlatformMappings(platform: string): PlatformRoleMapping[] {
    return this.platformMappings.filter(m => m.platform === platform);
  }

  /**
   * Check if a user has permission to execute a command
   */
  async checkPermission(
    command: string,
    context: PermissionContext
  ): Promise<PermissionCheckResult> {
    const entry = this.entries.get(command);

    if (!entry) {
      // No entry means command is public
      return { allowed: true };
    }

    // Check DM-only requirement
    if (entry.dmOnly && !context.isDM) {
      return {
        allowed: false,
        reason: 'This command can only be used in Direct Messages',
        requiredLevel: entry.permissionLevel,
      };
    }

    // Check wallet requirements
    if (entry.walletRequirements) {
      const missing: string[] = [];

      if (entry.walletRequirements.deployed && !context.isWalletDeployed) {
        missing.push('deployed wallet');
      }
      if (entry.walletRequirements.funded && !context.isWalletFunded) {
        missing.push('funded wallet');
      }
      if (entry.walletRequirements.verified && !context.isEmailVerified) {
        missing.push('verified email');
      }

      if (missing.length > 0) {
        return {
          allowed: false,
          reason: `Missing requirements: ${missing.join(', ')}`,
          requiredLevel: entry.permissionLevel,
          missingWalletRequirements: missing,
        };
      }
    }

    // Determine user's permission level
    const userLevel = this.determineUserPermissionLevel(context);

    // Check base permission level
    if (!hasPermissionLevel(userLevel, entry.permissionLevel)) {
      return {
        allowed: false,
        reason: `Insufficient permissions. Required: ${entry.permissionLevel}`,
        requiredLevel: entry.permissionLevel,
        userLevel,
      };
    }

    // Check backend roles
    if (entry.backendRoles && entry.backendRoles.length > 0) {
      if (!context.backendRole || !entry.backendRoles.includes(context.backendRole)) {
        return {
          allowed: false,
          reason: `Requires backend role: ${entry.backendRoles.join(' or ')}`,
          requiredLevel: entry.permissionLevel,
          userLevel,
        };
      }
    }

    // Check platform roles
    if (entry.platformRoles && entry.platformRoles.length > 0) {
      const hasPlatformRole = entry.platformRoles.some(mapping => {
        if (mapping.platform !== context.platform) return false;
        return context.platformRoles.includes(mapping.roleId);
      });

      if (!hasPlatformRole) {
        return {
          allowed: false,
          reason: `Requires platform role`,
          requiredLevel: entry.permissionLevel,
          userLevel,
        };
      }
    }

    // Check contract capabilities
    if (entry.contractCapabilities && entry.contractCapabilities.length > 0) {
      const missing: ContractCapability[] = [];

      for (const capability of entry.contractCapabilities) {
        const requiredLevel = CapabilityPermissionRequirements[capability];
        if (!hasPermissionLevel(userLevel, requiredLevel)) {
          missing.push(capability);
        }
      }

      if (missing.length > 0) {
        return {
          allowed: false,
          reason: `Missing contract capabilities: ${missing.join(', ')}`,
          requiredLevel: entry.permissionLevel,
          userLevel,
          missingCapabilities: missing,
        };
      }
    }

    // Check custom permission
    if (entry.customCheck) {
      const customAllowed = await entry.customCheck(context);
      if (!customAllowed) {
        return {
          allowed: false,
          reason: 'Custom permission check failed',
          requiredLevel: entry.permissionLevel,
          userLevel,
        };
      }
    }

    return {
      allowed: true,
      requiredLevel: entry.permissionLevel,
      userLevel,
    };
  }

  /**
   * Determine a user's permission level from context without running a full
   * command permission check. Public wrapper around the internal resolution
   * logic so callers that only need the level (e.g. capability checks
   * outside the checkPermission() flow) don't have to reach past
   * encapsulation to get it.
   */
  getUserPermissionLevel(context: PermissionContext): PermissionLevel {
    return this.determineUserPermissionLevel(context);
  }

  /**
   * Determine user's permission level from context
   */
  private determineUserPermissionLevel(context: PermissionContext): PermissionLevel {
    // Check platform role mappings first (highest priority)
    const platformMappings = this.getPlatformMappings(context.platform);
    for (const mapping of platformMappings) {
      if (context.platformRoles.includes(mapping.roleId)) {
        if (mapping.adminOverride) {
          return PermissionLevel.ADMIN;
        }
        return mapping.permissionLevel;
      }
    }

    // Fall back to backend role
    if (context.backendRole) {
      return getPermissionLevelFromBackendRole(context.backendRole);
    }

    // Check authentication and wallet states
    if (context.isWalletFunded) {
      return PermissionLevel.FUNDED;
    }
    if (context.isWalletDeployed) {
      return PermissionLevel.DEPLOYED;
    }
    if (context.isEmailVerified) {
      return PermissionLevel.VERIFIED;
    }
    if (context.isAuthenticated) {
      return PermissionLevel.AUTHENTICATED;
    }

    // Default to public
    return PermissionLevel.PUBLIC;
  }

  /**
   * Get all entries
   */
  getAllEntries(): PermissionMatrixEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries.clear();
    this.platformMappings = [...DefaultPlatformRoleMappings];
  }
}

// ============================================================================
// Default Permission Matrix
// ============================================================================

/**
 * Default permission matrix for common bot commands
 */
export const DefaultPermissionMatrix: PermissionMatrixEntry[] = [
  // Public commands
  {
    command: 'help',
    permissionLevel: PermissionLevel.PUBLIC,
  },
  {
    command: 'ping',
    permissionLevel: PermissionLevel.PUBLIC,
  },
  {
    command: 'discover',
    permissionLevel: PermissionLevel.PUBLIC,
  },
  {
    command: 'validate',
    permissionLevel: PermissionLevel.PUBLIC,
    contractCapabilities: [ContractCapability.READ],
  },

  // Authenticated commands
  {
    command: 'start',
    permissionLevel: PermissionLevel.AUTHENTICATED,
  },
  {
    command: 'link',
    permissionLevel: PermissionLevel.AUTHENTICATED,
  },
  {
    command: 'unlink',
    permissionLevel: PermissionLevel.AUTHENTICATED,
  },
  {
    command: 'linked',
    permissionLevel: PermissionLevel.AUTHENTICATED,
  },
  {
    command: 'alert',
    permissionLevel: PermissionLevel.AUTHENTICATED,
    contractCapabilities: [ContractCapability.READ],
  },

  // Verified commands
  {
    command: 'multisig',
    permissionLevel: PermissionLevel.VERIFIED,
    contractCapabilities: [ContractCapability.MULTISIG],
  },

  // Deployed wallet commands
  {
    command: 'trustline',
    permissionLevel: PermissionLevel.DEPLOYED,
    contractCapabilities: [ContractCapability.TRUSTLINE],
  },
  {
    command: 'claimable',
    permissionLevel: PermissionLevel.DEPLOYED,
    contractCapabilities: [ContractCapability.CLAIMABLE_BALANCE],
  },

  // Funded wallet commands
  {
    command: 'swap',
    permissionLevel: PermissionLevel.FUNDED,
    contractCapabilities: [ContractCapability.PAYMENT],
  },
  {
    command: 'payment',
    permissionLevel: PermissionLevel.FUNDED,
    contractCapabilities: [ContractCapability.PAYMENT],
    dmOnly: true,
  },
  {
    command: 'sponsor',
    permissionLevel: PermissionLevel.FUNDED,
    contractCapabilities: [ContractCapability.SPONSORSHIP],
  },
  {
    command: 'liquidity',
    permissionLevel: PermissionLevel.FUNDED,
    contractCapabilities: [ContractCapability.LIQUIDITY_POOL],
  },

  // Moderator commands
  {
    command: 'ban',
    permissionLevel: PermissionLevel.MODERATOR,
    backendRoles: [BackendRole.MODERATOR, BackendRole.ADMIN],
  },
  {
    command: 'mute',
    permissionLevel: PermissionLevel.MODERATOR,
    backendRoles: [BackendRole.MODERATOR, BackendRole.ADMIN],
  },

  // Admin commands
  {
    command: 'admin',
    permissionLevel: PermissionLevel.ADMIN,
    backendRoles: [BackendRole.ADMIN],
  },
  {
    command: 'config',
    permissionLevel: PermissionLevel.ADMIN,
    backendRoles: [BackendRole.ADMIN],
  },
  {
    command: 'mint',
    permissionLevel: PermissionLevel.ADMIN,
    contractCapabilities: [ContractCapability.ADMIN],
    backendRoles: [BackendRole.ADMIN],
  },
  {
    command: 'recover',
    permissionLevel: PermissionLevel.ADMIN,
    contractCapabilities: [ContractCapability.ACCOUNT_RECOVERY],
    backendRoles: [BackendRole.ADMIN],
  },
];
