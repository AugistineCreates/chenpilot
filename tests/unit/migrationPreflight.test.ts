import {
  MigrationPreflightChecker,
  MigrationWaiver,
  RollForwardRecoveryPlan,
} from '../../src/migrations/preflight/migrationPreflight';

describe('Issue #647: Migration Preflight Checks & Roll-Forward Recovery', () => {
  it('should pass on safe migration statements', () => {
    const safeSql = `
      CREATE TABLE IF NOT EXISTS user_preferences (
        id VARCHAR(36) PRIMARY KEY,
        theme VARCHAR(20) DEFAULT 'dark'
      );
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_prefs_theme ON user_preferences(theme);
    `;

    const result = MigrationPreflightChecker.checkSql('CreateUserPrefs', safeSql);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('should flag unsafe lock acquisition without waiver', () => {
    const unsafeLockSql = `
      LOCK TABLE user_balances IN ACCESS EXCLUSIVE MODE;
      ALTER TABLE user_balances ADD COLUMN locked_amount NUMERIC(20, 7);
    `;

    const result = MigrationPreflightChecker.checkSql('LockUserBalances', unsafeLockSql);
    expect(result.passed).toBe(false);
    expect(result.requiresWaiver).toBe(true);
    expect(result.violations.some((v) => v.rule === 'UNSAFE_LOCK_ACQUISITION')).toBe(true);
  });

  it('should permit unsafe lock if a valid reviewed waiver is provided', () => {
    const unsafeLockSql = `
      LOCK TABLE user_balances IN ACCESS EXCLUSIVE MODE;
    `;
    const waivers: MigrationWaiver[] = [
      {
        migrationName: 'LockUserBalances',
        rule: 'UNSAFE_LOCK_ACQUISITION',
        waivedBy: 'lead-architect@chenpilot.internal',
        reason: 'Maintenance window downtime approved',
        approvedAt: '2026-09-27T00:00:00Z',
      },
    ];

    const result = MigrationPreflightChecker.checkSql('LockUserBalances', unsafeLockSql, waivers);
    expect(result.passed).toBe(true);
    expect(result.waivedViolations).toHaveLength(1);
    expect(result.waivedViolations[0].rule).toBe('UNSAFE_LOCK_ACQUISITION');
  });

  it('should reject destructive DROP operations without a valid forward recovery plan', () => {
    const destructiveSql = `DROP TABLE deprecated_orders;`;

    const result = MigrationPreflightChecker.checkSql('DropDeprecatedOrders', destructiveSql);
    expect(result.passed).toBe(false);
    expect(result.recoveryPlanValid).toBe(false);
    expect(result.violations.some((v) => v.rule === 'MISSING_FORWARD_RECOVERY_PLAN')).toBe(true);
  });

  it('should validate forward recovery plan on destructive migrations', () => {
    const destructiveSql = `DROP TABLE deprecated_orders;`;
    const recoveryPlan: RollForwardRecoveryPlan = {
      migrationName: 'DropDeprecatedOrders',
      backupSnapshotId: 'snap-2026-09-27-pre-drop',
      forwardRecoveryScript: 'RESTORE TABLE deprecated_orders FROM SNAPSHOT snap-2026-09-27-pre-drop;',
      verificationQuery: 'SELECT COUNT(*) FROM deprecated_orders;',
      maxLockDurationMs: 500,
    };
    const waivers: MigrationWaiver[] = [
      {
        migrationName: 'DropDeprecatedOrders',
        rule: 'DESTRUCTIVE_DROP_OPERATION',
        waivedBy: 'db-team@chenpilot.internal',
        reason: 'Data archived to cold storage',
        approvedAt: '2026-09-27T00:00:00Z',
      },
    ];

    const result = MigrationPreflightChecker.checkSql(
      'DropDeprecatedOrders',
      destructiveSql,
      waivers,
      recoveryPlan
    );
    expect(result.passed).toBe(true);
    expect(result.recoveryPlanValid).toBe(true);
  });

  it('should test mixed-version application compatibility', () => {
    const oldAppFields = ['id', 'user_id', 'status', 'created_at'];
    const newSchemaFields = ['id', 'user_id', 'status', 'created_at', 'new_feature_flag'];

    const res = MigrationPreflightChecker.validateMixedVersionCompatibility(oldAppFields, newSchemaFields);
    expect(res.compatible).toBe(true);
    expect(res.missingFields).toHaveLength(0);

    const breakingSchema = ['id', 'status'];
    const resBreaking = MigrationPreflightChecker.validateMixedVersionCompatibility(
      oldAppFields,
      breakingSchema
    );
    expect(resBreaking.compatible).toBe(false);
    expect(resBreaking.missingFields).toContain('user_id');
  });
});
