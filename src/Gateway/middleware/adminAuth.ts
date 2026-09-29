
import { Request, Response, NextFunction } from "express";
import ipaddr from "ipaddr.js";
import config from "../../config/config";
import { UserRole, hasRequiredRole } from "../../Auth/roles";
import { ipBlacklistService } from "../../Security/ipBlacklist.service";
import { auditLogService } from "../../AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../../AuditLog/auditLog.entity";
import logger from "../../config/logger";

/**
 * Extract client IP from request
 */
function getClientIp(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    const ips = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)
      .split(",")
      .map((ip) => ip.trim());
    return ips[0];
  }
  const realIp = req.headers["x-real-ip"];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }
  return req.socket?.remoteAddress || "unknown";
}

/**
 * Normalize IP address for consistent checking
 */
function normalizeIp(ip: string): string {
  let normalized = ip.split(":")[0];
  if (normalized === "::1") {
    normalized = "127.0.0.1";
  }
  if (normalized.includes("::ffff:")) {
    normalized = normalized.replace("::ffff:", "");
  }
  return normalized.trim();
}

/**
 * Check if IP is in whitelist
 */
function isIpAllowed(clientIp: string, allowedList: string[]): boolean {
  try {
    const client = ipaddr.parse(clientIp);

    for (const allowed of allowedList) {
      if (clientIp === "unknown") {
        return false;
      }
      if (allowed.includes("/")) {
        const [range, prefixLength] = allowed.split("/");
        const rangeIp = ipaddr.parse(range);
        const prefix = parseInt(prefixLength, 10);

        if (client.kind() === rangeIp.kind()) {
          if (
            (client.kind() === "ipv4" && prefix === 32) ||
            (client.kind() === "ipv6" && prefix === 128)
          ) {
            if (client.toString() === rangeIp.toString()) return true;
          } else {
            try {
              const clientBytes = client.toByteArray();
              const rangeBytes = rangeIp.toByteArray();
              const fullBytes = Math.floor(prefix / 8);
              const remainingBits = prefix % 8;
              let matches = true;
              for (let i = 0; i < fullBytes && i < clientBytes.length; i++) {
                if (clientBytes[i] !== rangeBytes[i]) {
                  matches = false;
                  break;
                }
              }
              if (
                matches &&
                remainingBits > 0 &&
                fullBytes < clientBytes.length
              ) {
                const mask = 0xff << (8 - remainingBits);
                if (
                  (clientBytes[fullBytes] & mask) !==
                  (rangeBytes[fullBytes] & mask)
                ) {
                  matches = false;
                }
              }
              if (matches) return true;
            } catch {
              if (client.toString() === rangeIp.toString()) return true;
            }
          }
        }
      } else {
        if (client.toString() === allowed) {
          return true;
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Unified Admin Authorization Middleware
 * Combines:
 * - IP blacklist check
 * - IP whitelist check (admin)
 * - RBAC check
 * - Audit logging
 */
export function requireAdminAuth(options: {
  requireIpWhitelist?: boolean;
} = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clientIp = normalizeIp(getClientIp(req));
      const userAgent = req.headers["user-agent"];

      // 1. Check IP blacklist (optional)
      let isBlacklisted = false;
      try {
        isBlacklisted = await ipBlacklistService.isBlacklisted(clientIp);
      } catch (error) {
        logger.warn("Failed to check IP blacklist", { error: (error as Error).message });
        // Continue even if blacklist check fails
      }

      if (isBlacklisted) {
        try {
          await auditLogService.log({
            action: AuditAction.UNAUTHORIZED_ACCESS,
            severity: AuditSeverity.WARNING,
            ipAddress: clientIp,
            userAgent,
            resource: req.path,
            metadata: {
              params: req.params,
              query: req.query,
              method: req.method,
            },
            success: false,
            errorMessage: "IP is blacklisted",
          });
        } catch {
          // Ignore audit log failure
        }

        logger.warn("Blocked request from blacklisted IP", {
          ip: clientIp,
          path: req.path,
          method: req.method,
        });

        return res.status(403).json({
          success: false,
          message:
            "Your IP address has been blocked due to suspicious activity",
          code: "IP_BLACKLISTED",
        });
      }

      // 2. Check IP whitelist for admin
      const allowedIps = config.admin?.allowedIps || [];
      if (options.requireIpWhitelist !== false && allowedIps.length > 0) {
        if (!isIpAllowed(clientIp, allowedIps)) {
          try {
            await auditLogService.log({
              action: AuditAction.UNAUTHORIZED_ACCESS,
              severity: AuditSeverity.WARNING,
              ipAddress: clientIp,
              userAgent,
              resource: req.path,
              metadata: {
                params: req.params,
                query: req.query,
                method: req.method,
              },
              success: false,
              errorMessage: "IP not in whitelist",
            });
          } catch {
            // Ignore audit log failure
          }
          logger.warn(
            "IP whitelist violation: " +
              clientIp +
              " tried to access admin route"
          );
          return res.status(403).json({
            success: false,
            message:
              "Access denied. Your IP is not allowed to access this resource.",
          });
        }
      }

      // 3. Check if user is authenticated
      if (!req.user) {
        try {
          await auditLogService.log({
            action: AuditAction.UNAUTHORIZED_ACCESS,
            severity: AuditSeverity.WARNING,
            ipAddress: clientIp,
            userAgent,
            resource: req.path,
            metadata: {
              params: req.params,
              query: req.query,
              method: req.method,
            },
            success: false,
            errorMessage: "Authentication required",
          });
        } catch {
          // Ignore audit log failure
        }
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      // 4. Check admin role
      const userRole = req.user.role as UserRole;
      if (!hasRequiredRole(userRole, UserRole.ADMIN)) {
        try {
          await auditLogService.log({
            userId: req.user.userId,
            action: AuditAction.PERMISSION_DENIED,
            severity: AuditSeverity.WARNING,
            ipAddress: clientIp,
            userAgent,
            resource: req.path,
            metadata: {
              params: req.params,
              query: req.query,
              method: req.method,
            },
            success: false,
            errorMessage: "Insufficient permissions",
          });
        } catch {
          // Ignore audit log failure
        }
        return res.status(403).json({
          success: false,
          message: "Insufficient permissions",
        });
      }

      // 5. Log successful authorization (optional)
      try {
        await auditLogService.log({
          userId: req.user.userId,
          action: AuditAction.SENSITIVE_DATA_ACCESS,
          severity: AuditSeverity.INFO,
          ipAddress: clientIp,
          userAgent,
          resource: req.path,
          metadata: {
            params: req.params,
            query: req.query,
            method: req.method,
          },
          success: true,
        });
      } catch {
        // Ignore audit log failure
      }
      next();
    } catch (error) {
      logger.error("Admin auth middleware failed", { error: (error as Error).message });
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  };
}

export default requireAdminAuth;
