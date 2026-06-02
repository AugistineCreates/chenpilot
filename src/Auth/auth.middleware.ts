import { Request, Response, NextFunction } from "express";
import { container } from "tsyringe";
import JwtService from "./jwt.service";
import { updateObservabilityContext } from "../observability";

// Extend Express Request type to include user
declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
    executionId?: string;
    rootExecutionId?: string;
    parentExecutionId?: string;
    user?: {
      userId: string;
      name: string;
      role: string;
      username?: string;
    };
  }
}

/**
 * Middleware to verify JWT access token
 */
export async function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

    if (!token) {
      res.status(401).json({
        success: false,
        message: "Access token required",
      });
      return;
    }

    const jwtService = container.resolve(JwtService);
    const payload = jwtService.verifyAccessToken(token);

    // Attach user info to request
    req.user = {
      userId: payload.userId,
      name: payload.name,
      role: payload.role,
    };
    updateObservabilityContext({ userId: payload.userId });

    next();
  } catch {
    res.status(401).json({
      success: false,
      message: "Invalid token",
    });
  }
}

/**
 * Optional authentication - doesn't fail if token is missing
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];

    if (token) {
      const jwtService = container.resolve(JwtService);
      const payload = jwtService.verifyAccessToken(token);
      req.user = {
        userId: payload.userId,
        name: payload.name,
        role: payload.role,
      };
      updateObservabilityContext({ userId: payload.userId });
    }

    next();
  } catch {
    // Continue without authentication
    next();
  }
}
