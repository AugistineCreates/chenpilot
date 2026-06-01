# Role-Based Access Control (RBAC) Middleware

This directory contains RBAC decorators/middleware for protecting API routes based on user roles.

## Overview

The RBAC system implements a hierarchical role structure with three levels:

- **User** (level 1): Basic authenticated user
- **Moderator** (level 2): Elevated permissions for content moderation
- **Admin** (level 3): Full system access

## Role Hierarchy

Roles are hierarchical, meaning higher roles inherit permissions from lower roles:

- Admin can access Admin, Moderator, and User routes
- Moderator can access Moderator and User routes
- User can only access User routes

## Available Middleware

### `requireAdmin`

Requires the user to have Admin role.

```typescript
import { authenticateToken } from "../../Auth/auth.middleware";
import { requireAdmin } from "./rbac.middleware";

router.get("/admin/stats", authenticateToken, requireAdmin, (req, res) => {
  // Only admins can access this route
});
```

### `requireModerator`

Requires the user to have Moderator role or higher (Moderator or Admin).

```typescript
import { authenticateToken } from "../../Auth/auth.middleware";
import { requireModerator } from "./rbac.middleware";

router.delete(
  "/posts/:postId",
  authenticateToken,
  requireModerator,
  (req, res) => {
    // Moderators and admins can delete posts
  }
);
```

### `requireUser`

Requires the user to be authenticated (any role).

```typescript
import { authenticateToken } from "../../Auth/auth.middleware";
import { requireUser } from "./rbac.middleware";

router.get("/profile", authenticateToken, requireUser, (req, res) => {
  // Any authenticated user can access
});
```

### `requireRole(role: UserRole)`

Generic middleware factory for custom role requirements.

```typescript
import { authenticateToken } from "../../Auth/auth.middleware";
import { requireRole } from "./rbac.middleware";
import { UserRole } from "../../Auth/roles";

router.post(
  "/custom",
  authenticateToken,
  requireRole(UserRole.MODERATOR),
  (req, res) => {
    // Custom role requirement
  }
);
```

### `requireAnyRole(...roles: UserRole[])`

Requires the user to have at least one of the specified roles.

```typescript
import { authenticateToken } from "../../Auth/auth.middleware";
import { requireAnyRole } from "./rbac.middleware";
import { UserRole } from "../../Auth/roles";

router.get(
  "/special",
  authenticateToken,
  requireAnyRole(UserRole.ADMIN, UserRole.MODERATOR),
  (req, res) => {
    // Admins OR moderators can access
  }
);
```

### `requireOwnerOrElevated(userIdParam?: string)`

Allows access if the user is accessing their own resource OR has Moderator/Admin role.

```typescript
import { authenticateToken } from "../../Auth/auth.middleware";
import { requireOwnerOrElevated } from "./rbac.middleware";

router.get(
  "/account/:userId/transactions",
  authenticateToken,
  requireOwnerOrElevated("userId"),
  (req, res) => {
    // Users can access their own transactions
    // Moderators and admins can access any user's transactions
  }
);
```

## Usage Pattern

**Always use `authenticateToken` before RBAC middleware:**

```typescript
// ✅ Correct
router.get("/protected", authenticateToken, requireAdmin, handler);

// ❌ Wrong - RBAC middleware requires authenticated user
router.get("/protected", requireAdmin, handler);
```

## Response Codes

- **401 Unauthorized**: User is not authenticated
- **403 Forbidden**: User is authenticated but lacks required role

### 401 Response Example

```json
{
  "success": false,
  "message": "Authentication required"
}
```

### 403 Response Example

```json
{
  "success": false,
  "message": "Insufficient permissions",
  "required": "admin",
  "current": "user"
}
```

## Setting User Roles

User roles are stored in the `User` entity and included in JWT tokens. To change a user's role:

1. Update the database directly (for now):

```sql
UPDATE "user" SET role = 'admin' WHERE id = 'user-id-here';
```

2. The role will be included in new JWT tokens after the user logs in again.

## Database Migration

After implementing RBAC, run the migration to add the `role` column:

```bash
npm run migration:generate -- AddRoleToUser
npm run migration:run
```

## Security Considerations

1. **Token Refresh**: Role changes only take effect after token refresh
2. **Hierarchical**: Higher roles automatically have lower role permissions
3. **Default Role**: New users default to "user" role
4. **Validation**: Role values are validated against the `UserRole` enum

## Future Enhancements

- Admin API endpoint to manage user roles
- Role-based rate limiting
- Audit logging for role changes
- Permission-based access (more granular than roles)
