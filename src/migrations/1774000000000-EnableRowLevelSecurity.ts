import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration to enable PostgreSQL Row Level Security (RLS) for tenant isolation
 *
 * This migration implements database-enforced tenant boundaries to prevent
 * cross-tenant data access, even if application-level checks are bypassed.
 *
 * Key changes:
 * 1. Create database roles (app_user, app_admin, app_system)
 * 2. Enable RLS on all tenant-scoped tables
 * 3. Create isolation policies that enforce userId = current_setting('app.current_user_id')
 * 4. Add foreign key constraints for referential integrity
 * 5. Grant appropriate permissions to each role
 *
 * Security Model:
 * - app_user: Normal operations, RLS enforced
 * - app_admin: Maintenance operations, RLS bypassed (audited)
 * - app_system: Background jobs, limited scope bypass
 *
 * Tables with RLS enabled:
 * - contact: User address book
 * - refresh_token: Session management
 * - user_preferences: User settings
 * - bot_session: Conversation state
 * - bot_identity: Platform account links
 * - agent_execution_metrics: AI agent logs
 * - audit_log: Security audit trail
 * - admin_workflow_instance: Approval workflows
 * - admin_workflow_approval: Approval decisions
 */
export class EnableRowLevelSecurity1774000000000 implements MigrationInterface {
  name = "EnableRowLevelSecurity1774000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ===================================================================
    // STEP 1: Create Database Roles
    // ===================================================================

    // Create app_user role for normal application operations
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_user') THEN
          CREATE ROLE app_user NOINHERIT;
        END IF;
      END
      $$;
    `);

    // Create app_admin role for maintenance operations (RLS bypass)
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_admin') THEN
          CREATE ROLE app_admin BYPASSRLS;
        END IF;
      END
      $$;
    `);

    // Create app_system role for background jobs
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_system') THEN
          CREATE ROLE app_system NOINHERIT;
        END IF;
      END
      $$;
    `);

    // Grant roles to current database user (for migration and application use)
    // This allows the application to SET ROLE to these roles
    const currentUser = await queryRunner.query(`SELECT current_user`);
    const dbUser = currentUser[0].current_user;
    
    await queryRunner.query(`GRANT app_user TO ${dbUser}`);
    await queryRunner.query(`GRANT app_admin TO ${dbUser}`);
    await queryRunner.query(`GRANT app_system TO ${dbUser}`);

    // ===================================================================
    // STEP 2: Add Foreign Key Constraints for Tenant Boundaries
    // ===================================================================

    // Add FK for contact.userId (if not exists)
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_contact_user'
        ) THEN
          ALTER TABLE contact
          ADD CONSTRAINT fk_contact_user
          FOREIGN KEY ("userId")
          REFERENCES "user"(id)
          ON DELETE CASCADE;
        END IF;
      END
      $$;
    `);

    // Add FK for user_preferences.userId (if not exists)
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_preferences_user'
        ) THEN
          ALTER TABLE user_preferences
          ADD CONSTRAINT fk_user_preferences_user
          FOREIGN KEY ("userId")
          REFERENCES "user"(id)
          ON DELETE CASCADE;
        END IF;
      END
      $$;
    `);

    // Add FK for bot_session.userId (if not exists)
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_bot_session_user'
        ) THEN
          ALTER TABLE bot_session
          ADD CONSTRAINT fk_bot_session_user
          FOREIGN KEY ("userId")
          REFERENCES "user"(id)
          ON DELETE CASCADE;
        END IF;
      END
      $$;
    `);

    // Add FK for agent_execution_metrics.userId (nullable, no cascade)
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_agent_execution_metrics_user'
        ) THEN
          ALTER TABLE agent_execution_metrics
          ADD CONSTRAINT fk_agent_execution_metrics_user
          FOREIGN KEY ("userId")
          REFERENCES "user"(id)
          ON DELETE SET NULL;
        END IF;
      END
      $$;
    `);

    // Add FK for audit_log.userId (nullable, preserve for audit trail)
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_audit_log_user'
        ) THEN
          ALTER TABLE audit_log
          ADD CONSTRAINT fk_audit_log_user
          FOREIGN KEY ("userId")
          REFERENCES "user"(id)
          ON DELETE SET NULL;
        END IF;
      END
      $$;
    `);

    // Add FK for admin_workflow_instance.initiatorId
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_admin_workflow_instance_initiator'
        ) THEN
          ALTER TABLE admin_workflow_instance
          ADD CONSTRAINT fk_admin_workflow_instance_initiator
          FOREIGN KEY ("initiatorId")
          REFERENCES "user"(id)
          ON DELETE SET NULL;
        END IF;
      END
      $$;
    `);

    // Add FK for admin_workflow_approval.approverId
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_admin_workflow_approval_approver'
        ) THEN
          ALTER TABLE admin_workflow_approval
          ADD CONSTRAINT fk_admin_workflow_approval_approver
          FOREIGN KEY ("approverId")
          REFERENCES "user"(id)
          ON DELETE SET NULL;
        END IF;
      END
      $$;
    `);

    // ===================================================================
    // STEP 3: Enable RLS on Tenant-Scoped Tables
    // ===================================================================

    await queryRunner.query(`ALTER TABLE contact ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE refresh_token ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE bot_session ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE bot_identity ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE agent_execution_metrics ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE admin_workflow_instance ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`ALTER TABLE admin_workflow_approval ENABLE ROW LEVEL SECURITY`);

    // ===================================================================
    // STEP 4: Create RLS Policies for Tenant Isolation
    // ===================================================================

    // Policy for contact table
    await queryRunner.query(`
      CREATE POLICY contact_tenant_isolation ON contact
      FOR ALL
      TO app_user
      USING (
        "userId" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    `);

    // Policy for refresh_token table
    await queryRunner.query(`
      CREATE POLICY refresh_token_tenant_isolation ON refresh_token
      FOR ALL
      TO app_user
      USING (
        "userId" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    `);

    // Policy for user_preferences table
    await queryRunner.query(`
      CREATE POLICY user_preferences_tenant_isolation ON user_preferences
      FOR ALL
      TO app_user
      USING (
        "userId" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    `);

    // Policy for bot_session table
    await queryRunner.query(`
      CREATE POLICY bot_session_tenant_isolation ON bot_session
      FOR ALL
      TO app_user
      USING (
        "userId" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    `);

    // Policy for bot_identity table
    await queryRunner.query(`
      CREATE POLICY bot_identity_tenant_isolation ON bot_identity
      FOR ALL
      TO app_user
      USING (
        "userId" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    `);

    // Policy for agent_execution_metrics (nullable userId)
    await queryRunner.query(`
      CREATE POLICY agent_execution_metrics_tenant_isolation ON agent_execution_metrics
      FOR ALL
      TO app_user
      USING (
        "userId" IS NULL OR "userId" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    `);

    // Policy for audit_log (read-only for own records, write for all)
    await queryRunner.query(`
      CREATE POLICY audit_log_tenant_isolation_select ON audit_log
      FOR SELECT
      TO app_user
      USING (
        "userId" IS NULL OR "userId" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    `);

    await queryRunner.query(`
      CREATE POLICY audit_log_tenant_isolation_insert ON audit_log
      FOR INSERT
      TO app_user
      WITH CHECK (true)
    `);

    // Policy for admin_workflow_instance (can see own initiated workflows or if assigned)
    await queryRunner.query(`
      CREATE POLICY admin_workflow_instance_tenant_isolation ON admin_workflow_instance
      FOR ALL
      TO app_user
      USING (
        "initiatorId" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    `);

    // Policy for admin_workflow_approval (can see if approver)
    await queryRunner.query(`
      CREATE POLICY admin_workflow_approval_tenant_isolation ON admin_workflow_approval
      FOR ALL
      TO app_user
      USING (
        "approverId" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
      )
    `);

    // ===================================================================
    // STEP 5: System Role Policies (Background Jobs)
    // ===================================================================

    // app_system can read all records but write only to system tables
    await queryRunner.query(`
      CREATE POLICY agent_execution_metrics_system_access ON agent_execution_metrics
      FOR ALL
      TO app_system
      USING (true)
    `);

    await queryRunner.query(`
      CREATE POLICY audit_log_system_access ON audit_log
      FOR INSERT
      TO app_system
      WITH CHECK (true)
    `);

    // ===================================================================
    // STEP 6: Grant Table Permissions to Roles
    // ===================================================================

    // Grant permissions to app_user (normal operations)
    const userTables = [
      'contact', 'refresh_token', 'user_preferences', 'bot_session',
      'bot_identity', 'agent_execution_metrics', 'audit_log',
      'admin_workflow_instance', 'admin_workflow_approval', 'user',
      'agent_tool', 'prompt_version', 'webhook_idempotency',
      'deployed_contract', 'indexer_cursor', 'admin_workflow_policy'
    ];

    for (const table of userTables) {
      await queryRunner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO app_user`);
    }

    // Grant permissions to app_system (background jobs)
    const systemTables = [
      'agent_execution_metrics', 'audit_log', 'durable_operation',
      'webhook_idempotency', 'indexer_cursor', 'user', 'deployed_contract'
    ];

    for (const table of systemTables) {
      await queryRunner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO app_system`);
    }

    // app_admin has BYPASSRLS, no explicit grants needed (uses superuser connection)

    // ===================================================================
    // STEP 7: Create Audit Table for RLS Bypass Operations
    // ===================================================================

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS rls_bypass_audit (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "executedBy" varchar NOT NULL,
        "executedAt" timestamp NOT NULL DEFAULT now(),
        "operation" varchar NOT NULL,
        "tableName" varchar,
        "recordId" uuid,
        "reason" text,
        "metadata" jsonb,
        "databaseRole" varchar NOT NULL,
        "sessionUser" varchar NOT NULL,
        "ipAddress" varchar
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS IDX_rls_bypass_audit_executed_at 
      ON rls_bypass_audit ("executedAt")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS IDX_rls_bypass_audit_executed_by 
      ON rls_bypass_audit ("executedBy")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS IDX_rls_bypass_audit_table_name 
      ON rls_bypass_audit ("tableName")
    `);

    // Grant permissions for audit table
    await queryRunner.query(`GRANT INSERT ON rls_bypass_audit TO app_admin`);
    await queryRunner.query(`GRANT SELECT ON rls_bypass_audit TO app_user`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ===================================================================
    // Rollback: Drop policies, disable RLS, drop constraints
    // ===================================================================

    // Drop RLS bypass audit table
    await queryRunner.query(`DROP TABLE IF EXISTS rls_bypass_audit`);

    // Drop policies
    const tables = [
      'contact', 'refresh_token', 'user_preferences', 'bot_session',
      'bot_identity', 'agent_execution_metrics', 'audit_log',
      'admin_workflow_instance', 'admin_workflow_approval'
    ];

    for (const table of tables) {
      await queryRunner.query(`DROP POLICY IF EXISTS ${table}_tenant_isolation ON ${table}`);
      await queryRunner.query(`DROP POLICY IF EXISTS ${table}_tenant_isolation_select ON ${table}`);
      await queryRunner.query(`DROP POLICY IF EXISTS ${table}_tenant_isolation_insert ON ${table}`);
      await queryRunner.query(`DROP POLICY IF EXISTS ${table}_system_access ON ${table}`);
      await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    }

    // Drop foreign key constraints
    await queryRunner.query(`ALTER TABLE contact DROP CONSTRAINT IF EXISTS fk_contact_user`);
    await queryRunner.query(`ALTER TABLE user_preferences DROP CONSTRAINT IF EXISTS fk_user_preferences_user`);
    await queryRunner.query(`ALTER TABLE bot_session DROP CONSTRAINT IF EXISTS fk_bot_session_user`);
    await queryRunner.query(`ALTER TABLE agent_execution_metrics DROP CONSTRAINT IF EXISTS fk_agent_execution_metrics_user`);
    await queryRunner.query(`ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS fk_audit_log_user`);
    await queryRunner.query(`ALTER TABLE admin_workflow_instance DROP CONSTRAINT IF EXISTS fk_admin_workflow_instance_initiator`);
    await queryRunner.query(`ALTER TABLE admin_workflow_approval DROP CONSTRAINT IF EXISTS fk_admin_workflow_approval_approver`);

    // Revoke role grants (optional, depends on rollback strategy)
    const currentUser = await queryRunner.query(`SELECT current_user`);
    const dbUser = currentUser[0].current_user;
    
    await queryRunner.query(`REVOKE app_user FROM ${dbUser}`);
    await queryRunner.query(`REVOKE app_admin FROM ${dbUser}`);
    await queryRunner.query(`REVOKE app_system FROM ${dbUser}`);

    // Note: We don't drop the roles themselves as they may be in use
    // To fully remove: DROP ROLE app_user; DROP ROLE app_admin; DROP ROLE app_system;
  }
}
