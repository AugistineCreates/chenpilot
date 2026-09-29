import { Request, Response, NextFunction } from "express";
import { botIdentityService } from "./botIdentity.service";
import { BotPlatform } from "./botIdentity.entity";
import logger from "../config/logger";

declare module "express-serve-static-core" {
  interface Request {
    botIdentity?: {
      userId: string;
      platform: BotPlatform;
      platformUserId: string;
      platformUsername?: string;
    };
  }
}

/**
 * Middleware to authenticate users via linked bot identities
 * This allows users to authenticate using their Telegram or Discord accounts
 * instead of requiring JWT tokens for bot interactions
 */
export async function authenticateBotIdentity(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { platform, platformUserId } = req.headers;

    if (!platform || !platformUserId) {
      res.status(401).json({
        success: false,
        message: "Bot identity headers required (platform, platformUserId)",
      });
      return;
    }

    // Validate platform
    if (!["telegram", "discord"].includes(platform as string)) {
      res.status(400).json({
        success: false,
        message: "Invalid platform. Must be 'telegram' or 'discord'",
      });
      return;
    }

    // Get user by bot identity
    const user = await botIdentityService.getUserByBotIdentity(
      platform as BotPlatform,
      platformUserId as string
    );

    if (!user) {
      res.status(401).json({
        success: false,
        message: "No linked Chen Pilot account found for this bot identity",
      });
      return;
    }

    // Attach bot identity info to request
    req.botIdentity = {
      userId: user.id,
      platform: platform as BotPlatform,
      platformUserId: platformUserId as string,
    };

    // Also attach user info for compatibility with existing middleware
    req.user = {
      userId: user.id,
      name: user.name,
      role: user.role,
    };

    logger.info("Bot identity authenticated", {
      userId: user.id,
      platform,
      platformUserId,
    });

    next();
  } catch (error) {
    logger.error("Bot identity authentication failed", { error });
    res.status(500).json({
      success: false,
      message: "Authentication failed",
    });
  }
}

/**
 * Optional bot identity authentication - doesn't fail if headers are missing
 * Useful for endpoints that work with both authenticated and anonymous users
 */
export async function optionalBotIdentityAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { platform, platformUserId } = req.headers;

    if (platform && platformUserId) {
      // Validate platform
      if (!["telegram", "discord"].includes(platform as string)) {
        next(); // Continue without authentication
        return;
      }

      // Get user by bot identity
      const user = await botIdentityService.getUserByBotIdentity(
        platform as BotPlatform,
        platformUserId as string
      );

      if (user) {
        // Attach bot identity info to request
        req.botIdentity = {
          userId: user.id,
          platform: platform as BotPlatform,
          platformUserId: platformUserId as string,
        };

        // Also attach user info for compatibility
        req.user = {
          userId: user.id,
          name: user.name,
          role: user.role,
        };

        logger.info("Optional bot identity authenticated", {
          userId: user.id,
          platform,
          platformUserId,
        });
      }
    }

    next();
  } catch (error) {
    logger.error("Optional bot identity authentication failed", { error });
    // Continue without authentication
    next();
  }
}

/**
 * Middleware that accepts either JWT token or bot identity authentication
 * Provides flexibility for different client types
 */
export async function authenticateTokenOrBotIdentity(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN
    const { platform, platformUserId } = req.headers;

    // Try JWT authentication first
    if (token) {
      try {
        const { authenticateToken } = await import("./auth.middleware");
        await authenticateToken(req, res, () => {});
        if (req.user) {
          next(); // JWT authentication succeeded
          return;
        }
      } catch (error) {
        // JWT failed, try bot identity
        logger.debug("JWT authentication failed, trying bot identity", {
          error,
        });
      }
    }

    // Try bot identity authentication
    if (platform && platformUserId) {
      if (!["telegram", "discord"].includes(platform as string)) {
        res.status(400).json({
          success: false,
          message: "Invalid platform. Must be 'telegram' or 'discord'",
        });
        return;
      }

      const user = await botIdentityService.getUserByBotIdentity(
        platform as BotPlatform,
        platformUserId as string
      );

      if (user) {
        req.botIdentity = {
          userId: user.id,
          platform: platform as BotPlatform,
          platformUserId: platformUserId as string,
        };

        req.user = {
          userId: user.id,
          name: user.name,
          role: user.role,
        };

        logger.info("Bot identity authenticated (fallback)", {
          userId: user.id,
          platform,
          platformUserId,
        });

        next();
        return;
      }
    }

    // Neither authentication method succeeded
    res.status(401).json({
      success: false,
      message: "Authentication required (JWT token or bot identity headers)",
    });
  } catch (error) {
    logger.error("Hybrid authentication failed", { error });
    res.status(500).json({
      success: false,
      message: "Authentication failed",
    });
  }
}
