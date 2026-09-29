import { QueryRunner } from "typeorm";
import { AppDataSource } from "../config/Datasource";

/**
 * Transaction wrapper that ensures tenant context is set within transactions
 * 
 * This utility ensures that SET LOCAL app.current_user_id is executed within
 * the same transaction as the business logic, preventing race conditions and
 * ensuring proper isolation.
 * 
 * Usage:
 * 
 * ```typescript
 * import { withTenantContext, withSystemContext } from './utils/rlsTransaction';
 * 
 * // Normal tenant-scoped operation
 * await withTenantContext(userId, async (queryRunner) => {
 *   await queryRunner.manager.save(Contact, contact);
 * });
 * 
 * // System operation (background job)
 * await withSystemContext(async (queryRunner) => {
 *   await queryRunner.manager.save(AgentExecutionMetrics, metrics);
 * });
 * 
 * // Admin operation with audit
 * await withAdminContext('admin-user-id', 'data migration', async (queryRunner) => {
 *   await queryRunner.manager.update(User, {}, { someField: newValue });
 * });
 * ```
 */

export interface RLSTransactionOptions {
  /**
   * Isolation level for the transaction
   * Default: READ COMMITTED
   */
  isolationLevel?: "READ UNCOMMITTED" | "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE";
  
  /**
   * Whether to log the operation for auditing
   * Default: false (true for admin operations)
   */
  auditLog?: boolean;
  
  /**
   * Additional metadata for audit log
   */
  auditMetadata?: Record<string, any>;
}

/**
 * Execute a function within a tenant-scoped transaction
 * 
 * Sets app.current_user_id and database role to app_user, ensuring
 * RLS policies are enforced.
 * 
 * @param userId - The user ID to set as the current tenant context
 * @param fn - Async function to execute within the transaction
 * @param options - Transaction options
 * @returns Result of the function
 */
export async function withTenantContext<T>(
  userId: string,
  fn: (queryRunner: QueryRunner) => Promise<T>,
  options: RLSTransactionOptions = {}
): Promise<T> {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  
  try {
    // Start transaction with specified isolation level
    await queryRunner.startTransaction(options.isolationLevel);
    
    // Set tenant context for RLS
    await queryRunner.query(`SET LOCAL app.current_user_id = $1`, [userId]);
    await queryRunner.query(`SET LOCAL ROLE app_user`);
    
    // Execute the business logic
    const result = await fn(queryRunner);
    
    // Commit transaction
    await queryRunner.commitTransaction();
    
    return result;
  } catch (error) {
    // Rollback on error
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    // Release the connection back to pool
    await queryRunner.release();
  }
}

/**
 * Execute a function within a system-scoped transaction
 * 
 * Uses app_system role for background jobs that need to access
 * multiple tenants or system-level data.
 * 
 * @param fn - Async function to execute within the transaction
 * @param options - Transaction options
 * @returns Result of the function
 */
export async function withSystemContext<T>(
  fn: (queryRunner: QueryRunner) => Promise<T>,
  options: RLSTransactionOptions = {}
): Promise<T> {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  
  try {
    await queryRunner.startTransaction(options.isolationLevel);
    
    // Set system role (has broader access)
    await queryRunner.query(`SET LOCAL ROLE app_system`);
    
    const result = await fn(queryRunner);
    await queryRunner.commitTransaction();
    
    return result;
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}

/**
 * Execute a function with RLS bypass (admin operations)
 * 
 * Uses app_admin role which has BYPASSRLS privilege.
 * All operations are automatically audited to rls_bypass_audit table.
 * 
 * ⚠️ WARNING: Use sparingly and only for legitimate maintenance operations
 * 
 * @param executedBy - User or service performing the operation
 * @param reason - Justification for bypassing RLS
 * @param fn - Async function to execute within the transaction
 * @param options - Transaction options
 * @returns Result of the function
 */
export async function withAdminContext<T>(
  executedBy: string,
  reason: string,
  fn: (queryRunner: QueryRunner) => Promise<T>,
  options: RLSTransactionOptions = {}
): Promise<T> {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  
  const startTime = Date.now();
  let operation = "ADMIN_OPERATION";
  let tableName: string | undefined;
  let recordId: string | undefined;
  
  try {
    await queryRunner.startTransaction(options.isolationLevel);
    
    // Set admin role (bypasses RLS)
    await queryRunner.query(`SET LOCAL ROLE app_admin`);
    
    // Execute the business logic
    const result = await fn(queryRunner);
    
    // Extract operation details if available
    if (options.auditMetadata) {
      operation = options.auditMetadata.operation || operation;
      tableName = options.auditMetadata.tableName;
      recordId = options.auditMetadata.recordId;
    }
    
    // Log to audit table (always for admin operations)
    await logRLSBypass(queryRunner, {
      executedBy,
      operation,
      tableName,
      recordId,
      reason,
      metadata: {
        ...options.auditMetadata,
        durationMs: Date.now() - startTime,
      },
    });
    
    await queryRunner.commitTransaction();
    
    return result;
  } catch (error) {
    await queryRunner.rollbackTransaction();
    
    // Log failed operation attempt
    try {
      const failQueryRunner = AppDataSource.createQueryRunner();
      await failQueryRunner.connect();
      await failQueryRunner.startTransaction();
      await failQueryRunner.query(`SET LOCAL ROLE app_admin`);
      
      await logRLSBypass(failQueryRunner, {
        executedBy,
        operation: `${operation}_FAILED`,
        tableName,
        recordId,
        reason,
        metadata: {
          ...options.auditMetadata,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
        },
      });
      
      await failQueryRunner.commitTransaction();
      await failQueryRunner.release();
    } catch (auditError) {
      console.error("Failed to audit RLS bypass failure:", auditError);
    }
    
    throw error;
  } finally {
    await queryRunner.release();
  }
}

/**
 * Log RLS bypass operation to audit table
 */
async function logRLSBypass(
  queryRunner: QueryRunner,
  details: {
    executedBy: string;
    operation: string;
    tableName?: string;
    recordId?: string;
    reason: string;
    metadata?: Record<string, any>;
  }
): Promise<void> {
  const sessionUser = await queryRunner.query(`SELECT current_user`);
  const currentRole = await queryRunner.query(`SELECT current_role`);
  
  await queryRunner.query(
    `
    INSERT INTO rls_bypass_audit (
      "executedBy",
      "operation",
      "tableName",
      "recordId",
      "reason",
      "metadata",
      "databaseRole",
      "sessionUser"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      details.executedBy,
      details.operation,
      details.tableName || null,
      details.recordId || null,
      details.reason,
      JSON.stringify(details.metadata || {}),
      currentRole[0].current_role,
      sessionUser[0].current_user,
    ]
  );
}

/**
 * Execute a read-only query with tenant context
 * 
 * Lighter-weight alternative to full transaction for SELECT queries.
 * Still enforces RLS but with less overhead.
 * 
 * @param userId - The user ID to set as the current tenant context
 * @param fn - Async function to execute
 * @returns Result of the function
 */
export async function withTenantContextReadOnly<T>(
  userId: string,
  fn: (queryRunner: QueryRunner) => Promise<T>
): Promise<T> {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  
  try {
    // For read-only, we can use a simpler approach
    await queryRunner.query(`SET LOCAL app.current_user_id = $1`, [userId]);
    await queryRunner.query(`SET LOCAL ROLE app_user`);
    await queryRunner.query(`SET TRANSACTION READ ONLY`);
    
    const result = await fn(queryRunner);
    
    return result;
  } finally {
    await queryRunner.release();
  }
}

/**
 * Verify that RLS is active for the current session
 * 
 * Useful for testing and debugging.
 * 
 * @param queryRunner - Query runner to check
 * @returns Object with RLS status information
 */
export async function checkRLSStatus(
  queryRunner: QueryRunner
): Promise<{
  currentUserId: string | null;
  currentRole: string;
  rlsEnabled: boolean;
}> {
  const userIdResult = await queryRunner.query(
    `SELECT current_setting('app.current_user_id', true) as user_id`
  );
  const roleResult = await queryRunner.query(`SELECT current_role`);
  const rlsStatusResult = await queryRunner.query(`
    SELECT tablename, 
           rowsecurity as rls_enabled
    FROM pg_tables 
    WHERE schemaname = 'public' 
      AND tablename IN ('contact', 'refresh_token', 'user_preferences', 'bot_session', 
                        'bot_identity', 'agent_execution_metrics', 'audit_log')
  `);
  
  return {
    currentUserId: userIdResult[0].user_id || null,
    currentRole: roleResult[0].current_role,
    rlsEnabled: rlsStatusResult.every((row: any) => row.rls_enabled),
  };
}
