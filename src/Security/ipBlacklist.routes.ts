import { Router, Request, Response, NextFunction } from "express";
import { ipBlacklistService } from "./ipBlacklist.service";
import { authenticate } from "../Auth/auth";
import {
  ApiError,
  ok,
  created,
  validateBody,
  validateQuery,
  validateParams,
  IpAddressParamDto,
  BlacklistAddBodyDto,
  BlacklistBulkAddBodyDto,
  BlacklistListQueryDto,
} from "../contracts";
import { asyncHandler } from "../utils/expressAsync";
import logger from "../config/logger";

// The auth middleware in `src/Auth/auth.middleware.ts` augments
// `express-serve-static-core.Request` with `{ user?: { userId, name, role, username } }`.
// We accept either `user.id` (some legacy services) or `user.userId` here for
// backwards compatibility, and centralise the resolution into `actorId()`.
type RequestWithUser = Request & {
  user?: {
    id?: string;
    userId?: string;
    role?: string;
  };
};

const actorId = (req: Request): string | undefined => {
  const u = (req as RequestWithUser).user;
  return u?.id ?? u?.userId;
};

const router = Router();

/**
 * Admin gate — replaces the previous hand-rolled `isAdmin` which used
 * a bespoke `{ success:false, error:"Forbidden", message:"..." }`
 * envelope. Non-admins now reach `ApiError.forbidden` and the central
 * handler renders the canonical envelope.
 */
const isAdmin = (req: Request, _res: Response, next: NextFunction): void => {
  const user = (req as RequestWithUser).user;
  if (!user || user.role !== "admin") {
    return next(
      ApiError.forbidden("Only administrators can manage IP blacklist")
    );
  }
  next();
};

/**
 * GET /security/blacklist/check/:ip
 */
router.get(
  "/check/:ip",
  authenticate,
  validateParams(IpAddressParamDto),
  asyncHandler(async (req, res) => {
    const { ip } = req.params as unknown as IpAddressParamDto;

    const isBlacklisted = await ipBlacklistService.isBlacklisted(ip);
    const entry = await ipBlacklistService.getBlacklistEntry(ip);

    return ok(res, { isBlacklisted, entry });
  })
);

/**
 * GET /security/blacklist — list blacklisted IPs
 */
router.get(
  "/",
  authenticate,
  isAdmin,
  validateQuery(BlacklistListQueryDto),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as BlacklistListQueryDto;

    const result = await ipBlacklistService.listBlacklist({
      limit: q.limit ?? 50,
      offset: q.offset ?? 0,
      activeOnly: q.activeOnly ?? true,
      reason: q.reason,
    });

    return ok(res, result);
  })
);

/**
 * GET /security/blacklist/stats
 */
router.get(
  "/stats",
  authenticate,
  isAdmin,
  asyncHandler(async (_req, res) => {
    const stats = await ipBlacklistService.getStatistics();
    return ok(res, stats);
  })
);

/**
 * POST /security/blacklist — add IP to blacklist
 */
router.post(
  "/",
  authenticate,
  isAdmin,
  validateBody(BlacklistAddBodyDto),
  asyncHandler(async (req, res) => {
    const body = req.body as BlacklistAddBodyDto;
    const addedBy = actorId(req);

    const entry = await ipBlacklistService.addToBlacklist(body.ipAddress, {
      reason: body.reason,
      description: body.description,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      addedBy,
      metadata: body.metadata,
    });

    logger.info("IP added to blacklist via API", {
      ipAddress: body.ipAddress,
      reason: body.reason,
      addedBy,
    });

    return created(res, entry, "IP address added to blacklist");
  })
);

/**
 * POST /security/blacklist/bulk — bulk-add IPs to blacklist
 */
router.post(
  "/bulk",
  authenticate,
  isAdmin,
  validateBody(BlacklistBulkAddBodyDto),
  asyncHandler(async (req, res) => {
    const body = req.body as BlacklistBulkAddBodyDto;
    const addedBy = actorId(req);

    const entries = await ipBlacklistService.bulkAddToBlacklist(
      body.ips.map((ip) => ({
        ip,
        options: {
          reason: body.reason,
          description: body.description,
          addedBy,
        },
      }))
    );

    logger.info("Bulk IPs added to blacklist via API", {
      count: entries.length,
      reason: body.reason,
      addedBy,
    });

    return created(
      res,
      { added: entries.length, entries },
      `${entries.length} IP addresses added to blacklist`
    );
  })
);

/**
 * DELETE /security/blacklist/:ip
 */
router.delete(
  "/:ip",
  authenticate,
  isAdmin,
  validateParams(IpAddressParamDto),
  asyncHandler(async (req, res) => {
    const { ip } = req.params as unknown as IpAddressParamDto;

    const removed = await ipBlacklistService.removeFromBlacklist(ip);

    if (!removed) {
      throw ApiError.notFound("IP address not found in blacklist");
    }

    logger.info("IP removed from blacklist via API", {
      ip,
      removedBy: actorId(req),
    });

    return ok(res, undefined, "IP address removed from blacklist");
  })
);

/**
 * POST /security/blacklist/cleanup — cleanup expired entries
 */
router.post(
  "/cleanup",
  authenticate,
  isAdmin,
  asyncHandler(async (req, res) => {
    const count = await ipBlacklistService.cleanupExpiredEntries();

    logger.info("Cleaned up expired blacklist entries", {
      count,
      cleanedBy: actorId(req),
    });

    return ok(res, { cleaned: count }, `${count} expired entries cleaned up`);
  })
);

export default router;
export const ipBlacklistRoutes = router;
