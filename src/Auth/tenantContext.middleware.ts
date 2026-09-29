import { Request, Response, NextFunction } from "express";
import { AppDataSource } from "../config/Datasource";

/**
 * Middleware to set PostgreSQL session variable for Row Level Security (RLS)
 * 
 * This middleware sets app.current_user_id session variable that RLS policies
 * use to enforce tenant isolation at the database level.
 * 
 * Must be applied AFTER authenticateToken middleware so req.user is populated.
 * 
 * Usage:
 *   app.use(authenticateToken);
 *   app.use(setTenantContext);
 * 
 * The session variable is transaction-scoped using SET LOCAL, ensuring:
 * - Isolation between concurrent requests on the same connection
 * - Automatic cleanup when transaction commits/rolls back
 * - No cross-tenant leakage in connection pool
 */
export async function setTenantContext(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Only set context if user is authenticated
    if (!req.user?.userId) {
      next();
      return;
    }

    const queryRunner = AppDataSource.createQueryRunner();
    
    try {
      // Start a transaction to use SET LOCAL
      await queryRunner.startTransaction();
      
      // Set the current user ID for RLS policies
      await queryRunner.query(
        `SET LOCAL app.current_user_id = $1`,
        [req.user.userId]
      );
      
      // Set database role to app_user for RLS enforcement
      await queryRunner.query(`SET LOCAL ROLE app_user`);
      
      // Commit the session settings (they persist for the session)
      await queryRunner.commitTransaction();
      
      // Store queryRunner in request for later use in transaction wrapper
      req.queryRunner = queryRunner;
      
      next();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      // Clean up connection
      await queryRunner.release();
    }
  } catch (error) {
    console.error("Failed to set tenant context:", error);
    res.status(500).json({
      success: false,
      message: "Failed to initialize tenant context",
    });
  }
}

/**
 * Optional tenant context - sets context if authenticated, but doesn't fail
 * Used for endpoints that support both authenticated and unauthenticated access
 */
export async function setOptionalTenantContext(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (req.user?.userId) {
      const queryRunner = AppDataSource.createQueryRunner();
      
      try {
        await queryRunner.startTransaction();
        await queryRunner.query(
          `SET LOCAL app.current_user_id = $1`,
          [req.user.userId]
        );
        await queryRunner.query(`SET LOCAL ROLE app_user`);
        await queryRunner.commitTransaction();
        req.queryRunner = queryRunner;
      } catch (error) {
        await queryRunner.rollbackTransaction();
        console.warn("Failed to set optional tenant context:", error);
      } finally {
        await queryRunner.release();
      }
    }
    
    next();
  } catch (error) {
    console.warn("Error in optional tenant context:", error);
    next();
  }
}

// Extend Express Request type
declare module "express-serve-static-core" {
  interface Request {
    queryRunner?: any; // TypeORM QueryRunner
  }
}
