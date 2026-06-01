import { Request, Response, NextFunction } from "express";
import { UserRole, hasRequiredRole } from "../../Auth/roles";

/**
 * Middleware factory to check if user has required role
 */
export function requireRole(requiredRole: UserRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const userRole = req.user.role as UserRole;

    if (!hasRequiredRole(userRole, requiredRole)) {
      res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        required: requiredRole,
        current: userRole,
      });
      return;
    }

    next();
  };
}

/**
 * Middleware to require Admin role
 */
export const requireAdmin = requireRole(UserRole.ADMIN);

/**
 * Middleware to require Moderator role or higher (Moderator, Admin)
 */
export const requireModerator = requireRole(UserRole.MODERATOR);

/**
 * Middleware to require User role or higher (any authenticated user)
 */
export const requireUser = requireRole(UserRole.USER);

/**
 * Middleware to check if user has any of the specified roles
 */
export function requireAnyRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const userRole = req.user.role as UserRole;

    const hasPermission = roles.some((role) => hasRequiredRole(userRole, role));

    if (!hasPermission) {
      res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        requiredRoles: roles,
        current: userRole,
      });
      return;
    }

    next();
  };
}

/**
 * Middleware to check if user is accessing their own resource
 * or has elevated permissions (Moderator/Admin)
 */
export function requireOwnerOrElevated(userIdParam: string = "userId") {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const userRole = req.user.role as UserRole;
    const requestedUserId = req.params[userIdParam];

    // Allow if user is accessing their own resource
    const isOwner = req.user.userId === requestedUserId;

    // Allow if user has moderator or admin role
    const hasElevatedPermission = hasRequiredRole(userRole, UserRole.MODERATOR);

    if (!isOwner && !hasElevatedPermission) {
      res.status(403).json({
        success: false,
        message: "You can only access your own resources",
      });
      return;
    }

    next();
  };
}
