import { AppDataSource } from "../config/Datasource";
import logger from "../config/logger";

/**
 * Service for auditing RLS bypass operations
 * 
 * Provides high-level API for logging privileged database operations
 * that bypass row-level security policies.
 */
export interface RLSBypassAuditEntry {
  executedBy: string;
  operation: string;
  tableName?: string;
  recordId?: string;
  reason: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
}

class RLSAuditService {
  /**
   * Log an RLS bypass operation
   * 
   * This should be called for any operation performed with app_admin role
   * or any other RLS bypass mechanism.
   * 
   * @param entry - Audit entry details
   */
  async logBypass(entry: RLSBypassAuditEntry): Promise<void> {
    try {
      const queryRunner = AppDataSource.createQueryRunner();
      await queryRunner.connect();
      
      try {
        // Use app_admin role to write to audit table
        await queryRunner.query(`SET LOCAL ROLE app_admin`);
        
        const currentRole = await queryRunner.query(`SELECT current_role`);
        const sessionUser = await queryRunner.query(`SELECT current_user`);
        
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
            "sessionUser",
            "ipAddress"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [
            entry.executedBy,
            entry.operation,
            entry.tableName || null,
            entry.recordId || null,
            entry.reason,
            JSON.stringify(entry.metadata || {}),
            currentRole[0]?.current_role || 'unknown',
            sessionUser[0]?.current_user || 'unknown',
            entry.ipAddress || null,
          ]
        );
        
        // Also log to application logger for real-time monitoring
        logger.warn("RLS bypass operation executed", {
          executedBy: entry.executedBy,
          operation: entry.operation,
          tableName: entry.tableName,
          recordId: entry.recordId,
          reason: entry.reason,
          metadata: entry.metadata,
        });
      } finally {
        await queryRunner.release();
      }
    } catch (error) {
      // Audit logging failure is critical
      logger.error("Failed to log RLS bypass operation", {
        error,
        entry,
      });
      throw error;
    }
  }

  /**
   * Query RLS bypass audit logs
   * 
   * @param filters - Query filters
   * @returns Array of audit entries
   */
  async queryBypassLogs(filters: {
    executedBy?: string;
    operation?: string;
    tableName?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<any[]> {
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    
    try {
      // Use app_user role for querying
      await queryRunner.query(`SET LOCAL ROLE app_user`);
      
      let sql = `
        SELECT 
          id,
          "executedBy",
          "executedAt",
          operation,
          "tableName",
          "recordId",
          reason,
          metadata,
          "databaseRole",
          "sessionUser",
          "ipAddress"
        FROM rls_bypass_audit
        WHERE 1=1
      `;
      
      const params: any[] = [];
      let paramIndex = 1;
      
      if (filters.executedBy) {
        sql += ` AND "executedBy" = $${paramIndex++}`;
        params.push(filters.executedBy);
      }
      
      if (filters.operation) {
        sql += ` AND operation = $${paramIndex++}`;
        params.push(filters.operation);
      }
      
      if (filters.tableName) {
        sql += ` AND "tableName" = $${paramIndex++}`;
        params.push(filters.tableName);
      }
      
      if (filters.startDate) {
        sql += ` AND "executedAt" >= $${paramIndex++}`;
        params.push(filters.startDate);
      }
      
      if (filters.endDate) {
        sql += ` AND "executedAt" <= $${paramIndex++}`;
        params.push(filters.endDate);
      }
      
      sql += ` ORDER BY "executedAt" DESC`;
      
      if (filters.limit) {
        sql += ` LIMIT $${paramIndex++}`;
        params.push(filters.limit);
      } else {
        sql += ` LIMIT 100`;
      }
      
      const results = await queryRunner.query(sql, params);
      return results;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Get bypass operation statistics
   * 
   * @param timeWindow - Time window in hours (default: 24)
   * @returns Statistics object
   */
  async getBypassStatistics(timeWindow: number = 24): Promise<{
    totalOperations: number;
    operationsByUser: Record<string, number>;
    operationsByType: Record<string, number>;
    operationsByTable: Record<string, number>;
  }> {
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    
    try {
      await queryRunner.query(`SET LOCAL ROLE app_user`);
      
      const cutoffTime = new Date(Date.now() - timeWindow * 60 * 60 * 1000);
      
      // Total count
      const totalResult = await queryRunner.query(
        `SELECT COUNT(*) as count FROM rls_bypass_audit WHERE "executedAt" >= $1`,
        [cutoffTime]
      );
      
      // By user
      const byUserResult = await queryRunner.query(
        `
        SELECT "executedBy", COUNT(*) as count 
        FROM rls_bypass_audit 
        WHERE "executedAt" >= $1
        GROUP BY "executedBy"
        ORDER BY count DESC
        `,
        [cutoffTime]
      );
      
      // By operation type
      const byTypeResult = await queryRunner.query(
        `
        SELECT operation, COUNT(*) as count 
        FROM rls_bypass_audit 
        WHERE "executedAt" >= $1
        GROUP BY operation
        ORDER BY count DESC
        `,
        [cutoffTime]
      );
      
      // By table
      const byTableResult = await queryRunner.query(
        `
        SELECT "tableName", COUNT(*) as count 
        FROM rls_bypass_audit 
        WHERE "executedAt" >= $1 AND "tableName" IS NOT NULL
        GROUP BY "tableName"
        ORDER BY count DESC
        `,
        [cutoffTime]
      );
      
      return {
        totalOperations: parseInt(totalResult[0].count, 10),
        operationsByUser: Object.fromEntries(
          byUserResult.map((row: any) => [row.executedBy, parseInt(row.count, 10)])
        ),
        operationsByType: Object.fromEntries(
          byTypeResult.map((row: any) => [row.operation, parseInt(row.count, 10)])
        ),
        operationsByTable: Object.fromEntries(
          byTableResult.map((row: any) => [row.tableName, parseInt(row.count, 10)])
        ),
      };
    } finally {
      await queryRunner.release();
    }
  }
}

export const rlsAuditService = new RLSAuditService();
