# Bot Command Permission Matrix

Unified permission system mapping user roles, platform roles, backend authorization, and contract capabilities into one coherent access policy.

## Overview

The Permission Matrix provides a comprehensive, type-safe system for controlling access to bot commands across multiple dimensions:

- **Backend Roles**: User roles from the Chen Pilot backend (user, moderator, admin)
- **Platform Roles**: Discord/Telegram server roles
- **Permission Levels**: Hierarchical permission levels (public → system)
- **Contract Capabilities**: Blockchain operation permissions
- **Wallet States**: Deployment and funding requirements

## Architecture

### Core Components

1. **Permission Matrix** (`matrix.ts`)
   - Central permission definition and checking logic
   - Permission levels and hierarchy
   - Contract capability mappings
   - Default permission entries for common commands

2. **Backend Integration** (`backendIntegration.ts`)
   - Bridges permission matrix with backend user system
   - User data caching
   - Backend role to permission level mapping

3. **Platform Integration** (`platformIntegration.ts`)
   - Discord role fetcher with caching
   - Telegram role fetcher (stub - no server roles)
   - Platform-specific role mappings

4. **Middleware** (`middleware.ts`)
   - Permission checking guard for command handlers
   - Integration with existing guard system
   - Permission context creation

## Permission Levels

Permission levels are hierarchical - higher levels include all permissions from lower levels.

```typescript
enum PermissionLevel {
  PUBLIC = 'public',           // No special permissions
  AUTHENTICATED = 'authenticated', // Requires linked account
  VERIFIED = 'verified',       // Requires verified email
  DEPLOYED = 'deployed',       // Requires deployed wallet
  FUNDED = 'funded',           // Requires funded wallet
  MODERATOR = 'moderator',     // Moderator-level permissions
  ADMIN = 'admin',             // Admin-level permissions
  SYSTEM = 'system',           // System-level (internal)
}
```

### Permission Hierarchy

```
SYSTEM (7)
  └─ ADMIN (6)
      └─ MODERATOR (5)
          └─ FUNDED (4)
              └─ DEPLOYED (3)
                  └─ VERIFIED (2)
                      └─ AUTHENTICATED (1)
                          └─ PUBLIC (0)
```

## Contract Capabilities

Contract capabilities represent sensitive blockchain operations that require specific permissions.

```typescript
enum ContractCapability {
  READ = 'read',                      // Read-only operations
  TRUSTLINE = 'trustline',            // Create trustline
  PAYMENT = 'payment',                // Send payment
  ASSET_MANAGEMENT = 'asset_management', // Manage assets
  MULTISIG = 'multisig',              // Multisig operations
  SMART_CONTRACT = 'smart_contract',  // Smart contract operations
  SPONSORSHIP = 'sponsorship',        // Sponsorship operations
  CLAIMABLE_BALANCE = 'claimable_balance', // Claimable balances
  LIQUIDITY_POOL = 'liquidity_pool', // Liquidity pool operations
  ATOMIC_SWAP = 'atomic_swap',        // Atomic swap operations
  FEE_BUMP = 'fee_bump',            // Fee bump operations
  ACCOUNT_MERGE = 'account_merge',    // Account merge operations
  ACCOUNT_RECOVERY = 'account_recovery', // Account recovery
  ADMIN = 'admin',                    // Admin operations
}
```

### Capability Permission Requirements

| Capability | Required Level |
|------------|----------------|
| READ | PUBLIC |
| TRUSTLINE | AUTHENTICATED |
| PAYMENT | DEPLOYED |
| ASSET_MANAGEMENT | FUNDED |
| MULTISIG | VERIFIED |
| SMART_CONTRACT | FUNDED |
| SPONSORSHIP | FUNDED |
| CLAIMABLE_BALANCE | AUTHENTICATED |
| LIQUIDITY_POOL | FUNDED |
| ATOMIC_SWAP | FUNDED |
| FEE_BUMP | AUTHENTICATED |
| ACCOUNT_MERGE | ADMIN |
| ACCOUNT_RECOVERY | ADMIN |
| ADMIN | ADMIN |

## Backend Roles

Backend roles map directly to permission levels:

```typescript
enum BackendRole {
  USER = 'user',
  MODERATOR = 'moderator',
  ADMIN = 'admin',
}
```

| Backend Role | Permission Level |
|--------------|------------------|
| USER | AUTHENTICATED |
| MODERATOR | MODERATOR |
| ADMIN | ADMIN |

## Platform Roles

Platform-specific roles can be mapped to permission levels:

```typescript
interface PlatformRoleMapping {
  platform: string;           // 'discord' or 'telegram'
  roleId: string;             // Platform-specific role ID
  permissionLevel: PermissionLevel;
  adminOverride?: boolean;    // Grants admin override
}
```

### Default Discord Mappings

| Discord Role | Permission Level | Admin Override |
|--------------|------------------|----------------|
| admin | ADMIN | true |
| moderator | MODERATOR | false |
| verified | VERIFIED | false |

## Usage

### Basic Setup

```typescript
import { PermissionMatrix } from './permissions/matrix.js';
import { BackendPermissionIntegration } from './permissions/backendIntegration.js';
import { PlatformPermissionIntegration } from './permissions/platformIntegration.js';
import { DiscordRoleFetcher } from './permissions/platformIntegration.js';
import { permissionMiddleware } from './permissions/middleware.js';

// Create permission matrix
const permissionMatrix = new PermissionMatrix();

// Load default entries
import { DefaultPermissionMatrix } from './permissions/matrix.js';
for (const entry of DefaultPermissionMatrix) {
  permissionMatrix.setEntry(entry);
}

// Create backend integration
const backendClient = new SafeBackendClient(backendUrl);
const backendIntegration = new BackendPermissionIntegration(backendClient, permissionMatrix);

// Create platform integration
const platformIntegration = new PlatformPermissionIntegration(permissionMatrix);

// Register Discord role fetcher
const discordRoleFetcher = new DiscordRoleFetcher(discordClient, {
  adminRoleIds: ['admin_role_id'],
  moderatorRoleIds: ['mod_role_id'],
  verifiedRoleIds: ['verified_role_id'],
});
platformIntegration.registerRoleFetcher('discord', discordRoleFetcher);

// Configure middleware
permissionMiddleware.setPermissionMatrix(permissionMatrix);
permissionMiddleware.setBackendIntegration(backendIntegration);
permissionMiddleware.setPlatformIntegration(platformIntegration);
```

### Adding Custom Permission Entry

```typescript
permissionMatrix.setEntry({
  command: 'mycommand',
  permissionLevel: PermissionLevel.AUTHENTICATED,
  contractCapabilities: [ContractCapability.PAYMENT],
  walletRequirements: {
    deployed: true,
    funded: true,
  },
  dmOnly: true,
});
```

### Checking Permissions

```typescript
// Check command permission
const result = await permissionMiddleware.checkCommandPermission('trustline', ctx);

if (!result.allowed) {
  console.log('Permission denied:', result.reason);
  console.log('Required level:', result.requiredLevel);
  console.log('User level:', result.userLevel);
}
```

### Using Permission Guard

```typescript
import { permissionMatrixGuard } from './commands/guards.js';

// In command registry
const guards = [
  floodGuard,
  rateLimitGuard,
  dmOnlyGuard,
  platformGuard,
  roleGuard,
  permissionMatrixGuard, // Add permission matrix guard
];
```

### Custom Permission Check

```typescript
// Check if user has specific permission level
const hasLevel = await permissionMiddleware.hasPermissionLevel(ctx, PermissionLevel.ADMIN);

// Check if user has specific contract capability
const hasCapability = await permissionMiddleware.hasContractCapability(ctx, ContractCapability.PAYMENT);
```

## Default Permission Matrix

### Public Commands (No Authentication)

| Command | Description |
|---------|-------------|
| help | Display help information |
| ping | Check bot status |
| discover | Discover assets |
| validate | Validate asset information |

### Authenticated Commands (Linked Account)

| Command | Description | Capabilities |
|---------|-------------|--------------|
| start | Start bot interaction | - |
| link | Link bot account | - |
| unlink | Unlink bot account | - |
| linked | View linked accounts | - |
| alert | Set price alerts | READ |

### Verified Commands (Email Verified)

| Command | Description | Capabilities |
|---------|-------------|--------------|
| multisig | Multisig operations | MULTISIG |

### Deployed Wallet Commands

| Command | Description | Capabilities |
|---------|-------------|--------------|
| trustline | Create trustline | TRUSTLINE |
| claimable | Claimable balances | CLAIMABLE_BALANCE |

### Funded Wallet Commands

| Command | Description | Capabilities |
|---------|-------------|--------------|
| swap | Swap tokens | PAYMENT |
| payment | Send payment | PAYMENT |
| sponsor | Sponsor operations | SPONSORSHIP |
| liquidity | Liquidity pool operations | LIQUIDITY_POOL |

### Moderator Commands

| Command | Description | Backend Roles |
|---------|-------------|---------------|
| ban | Ban user | MODERATOR, ADMIN |
| mute | Mute user | MODERATOR, ADMIN |

### Admin Commands

| Command | Description | Backend Roles | Capabilities |
|---------|-------------|---------------|--------------|
| admin | Admin commands | ADMIN | - |
| config | Configuration | ADMIN | - |
| mint | Mint assets | ADMIN | ADMIN |
| recover | Account recovery | ADMIN | ACCOUNT_RECOVERY |

## Permission Context

The permission context contains all information needed for permission evaluation:

```typescript
interface PermissionContext {
  userId: string;
  backendRole?: BackendRole;
  platform: string;
  platformRoles: string[];
  isAuthenticated: boolean;
  isEmailVerified: boolean;
  isWalletDeployed: boolean;
  isWalletFunded: boolean;
  isDM: boolean;
  guildId?: string;
  metadata?: Record<string, unknown>;
}
```

## Permission Check Result

```typescript
interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  requiredLevel?: PermissionLevel;
  userLevel?: PermissionLevel;
  missingCapabilities?: ContractCapability[];
  missingWalletRequirements?: string[];
}
```

## Advanced Features

### Custom Permission Checks

Add custom permission logic to permission matrix entries:

```typescript
permissionMatrix.setEntry({
  command: 'special',
  permissionLevel: PermissionLevel.AUTHENTICATED,
  customCheck: async (context) => {
    // Custom logic
    return context.userId === 'special_user_id';
  },
});
```

### Platform-Specific Role Mappings

Add custom platform role mappings:

```typescript
platformIntegration.addPlatformMapping({
  platform: 'discord',
  roleId: 'premium',
  permissionLevel: PermissionLevel.VERIFIED,
});
```

### Rate Limit Overrides

Set custom rate limits for specific commands:

```typescript
permissionMatrix.setEntry({
  command: 'heavy_command',
  permissionLevel: PermissionLevel.AUTHENTICATED,
  rateLimit: {
    maxRequests: 5,
    windowMs: 60000, // 1 minute
  },
});
```

### Wallet Requirements

Require specific wallet states:

```typescript
permissionMatrix.setEntry({
  command: 'sensitive',
  permissionLevel: PermissionLevel.AUTHENTICATED,
  walletRequirements: {
    deployed: true,
    funded: true,
    verified: true,
  },
});
```

## Integration with Existing Guards

The permission matrix guard integrates seamlessly with existing command guards:

```typescript
// Guard execution order
const guards = [
  floodGuard,              // First: prevent spam
  rateLimitGuard,          // Second: enforce rate limits
  dmOnlyGuard,             // Third: check DM requirement
  platformGuard,           // Fourth: check platform support
  roleGuard,               // Fifth: check platform roles (legacy)
  permissionMatrixGuard,   // Sixth: comprehensive permission check
];
```

The permission matrix guard can replace or complement the existing role guard, providing more comprehensive permission checking.

## Caching

### Backend User Data Cache

User data is cached for 5 minutes to reduce backend API calls:

```typescript
// Invalidate specific user cache
backendIntegration.invalidateUserCache(userId);

// Clear all caches
backendIntegration.clearCache();

// Get cache statistics
const stats = backendIntegration.getCacheStats();
```

### Platform Role Cache

Discord roles are cached for 5 minutes:

```typescript
// Invalidate specific user cache
discordRoleFetcher.invalidateCache(userId, guildId);

// Clear all caches
discordRoleFetcher.clearCache();
```

## Troubleshooting

### Permission Denied

If a user is denied permission:

1. Check the permission matrix entry for the command
2. Verify the user's backend role and wallet state
3. Check platform role mappings
4. Review the permission check result for specific reasons

```typescript
const result = await permissionMiddleware.checkCommandPermission('command', ctx);
console.log('Permission check result:', result);
```

### Cache Issues

If permissions aren't updating after role changes:

```typescript
// Clear caches
backendIntegration.clearCache();
platformIntegration.clearAllCaches();
```

### Platform Role Fetching

If Discord roles aren't being fetched:

1. Verify Discord client is properly initialized
2. Check that guildId is available in the command context
3. Ensure role IDs are correctly configured
4. Check Discord API permissions

## Best Practices

1. **Use Default Matrix**: Start with the default permission matrix and customize as needed
2. **Principle of Least Privilege**: Grant minimum required permissions for each command
3. **Layer Security**: Use permission matrix alongside other security measures
4. **Monitor Permissions**: Log permission denials for security monitoring
5. **Test Permissions**: Write tests for permission checks
6. **Document Custom Rules**: Document any custom permission entries
7. **Regular Audits**: Regularly review and audit permission configurations

## Security Considerations

1. **Backend Authority**: Backend roles take precedence over platform roles
2. **Admin Override**: Platform admin roles can override permission levels
3. **DM-Only Commands**: Sensitive operations should require DM-only
4. **Contract Capabilities**: High-risk operations require higher permission levels
5. **Audit Trail**: All permission checks should be logged
6. **Rate Limiting**: Apply appropriate rate limits based on permission level

## Migration from Legacy Role Guard

### Before (Legacy Role Guard)

```typescript
const handler: CommandHandler = {
  name: 'admin',
  requiredRoles: ['admin'],
  // ...
};
```

### After (Permission Matrix)

```typescript
permissionMatrix.setEntry({
  command: 'admin',
  permissionLevel: PermissionLevel.ADMIN,
  backendRoles: [BackendRole.ADMIN],
});
```

The permission matrix provides more granular control and integrates with backend authorization and wallet states.

## Testing

### Unit Test Permission Check

```typescript
import { PermissionMatrix, PermissionLevel } from './permissions/matrix.js';

describe('Permission Matrix', () => {
  it('should allow admin to access admin commands', async () => {
    const matrix = new PermissionMatrix();
    matrix.setEntry({
      command: 'admin',
      permissionLevel: PermissionLevel.ADMIN,
    });

    const context: PermissionContext = {
      userId: 'user1',
      backendRole: BackendRole.ADMIN,
      platform: 'discord',
      platformRoles: [],
      isAuthenticated: true,
      isEmailVerified: true,
      isWalletDeployed: true,
      isWalletFunded: true,
      isDM: false,
    };

    const result = await matrix.checkPermission('admin', context);
    expect(result.allowed).toBe(true);
  });
});
```

### Integration Test with Middleware

```typescript
describe('Permission Middleware', () => {
  it('should deny unauthorized command execution', async () => {
    const ctx: CommandContext = {
      command: 'admin',
      args: [],
      userId: 'user1',
      platform: 'discord',
      isDM: false,
      reply: async () => {},
      roles: [],
      raw: {},
    };

    const handler: CommandHandler = {
      name: 'admin',
      description: 'Admin command',
    };

    const result = await permissionMiddleware.permissionGuard(handler, ctx);
    expect(result.passed).toBe(false);
  });
});
```

## Performance

- **Caching**: 5-minute cache for user data and platform roles
- **Efficient Lookups**: O(1) permission matrix lookups
- **Lazy Loading**: User data fetched only when needed
- **Batch Operations**: Support for batch permission checks

## Future Enhancements

- [ ] Visual permission matrix editor
- [ ] Permission inheritance from groups
- [ ] Time-based permissions (temporary access)
- [ ] Conditional permissions (based on time, location, etc.)
- [ ] Permission audit logging
- [ ] Permission change notifications
- [ ] Advanced caching strategies (Redis, etc.)
- [ ] Permission templates for common patterns
