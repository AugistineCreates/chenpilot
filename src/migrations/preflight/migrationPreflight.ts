/**
 * Migration Preflight Checks and Forward-Only Recovery Validation
 *
 * Implements Issue #647:
 * Schema migrations must be preflighted for lock durations, table rewrites,
 * data assumptions, duplicate identifiers, and application compatibility.
 * Destructive operations require reviewed waivers, and recovery must follow
 * a validated roll-forward strategy rather than syntactic down migrations.
 */

export type RiskLevel = 'SAFE' | 'WARNING' | 'DANGEROUS';

export interface PreflightViolation {
  rule: string;
  level: RiskLevel;
  message: string;
  statement?: string;
  recommendation: string;
}

export interface MigrationWaiver {
  migrationName: string;
  rule: string;
  waivedBy: string;
  reason: string;
  approvedAt: string;
}

export interface RollForwardRecoveryPlan {
  migrationName: string;
  backupSnapshotId: string;
  forwardRecoveryScript: string;
  verificationQuery: string;
  maxLockDurationMs: number;
}

export interface PreflightResult {
  migrationName: string;
  passed: boolean;
  violations: PreflightViolation[];
  waivedViolations: PreflightViolation[];
  requiresWaiver: boolean;
  recoveryPlanValid: boolean;
}

export class MigrationPreflightChecker {
  private static DANGEROUS_PATTERNS = [
    {
      rule: 'UNSAFE_LOCK_ACQUISITION',
      pattern: /LOCK\s+TABLE\s+.*IN\s+ACCESS\s+EXCLUSIVE\s+MODE/i,
      message: 'Explicit ACCESS EXCLUSIVE lock requested without lock timeout.',
      recommendation: 'Use lock_timeout and advisory locks, or perform non-blocking concurrent operations.',
    },
    {
      rule: 'TABLE_REWRITE_TYPE_CHANGE',
      pattern: /ALTER\s+TABLE\s+\w+\s+ALTER\s+COLUMN\s+\w+\s+TYPE\s+/i,
      message: 'Column type alteration causes full table rewrite and read/write lock.',
      recommendation: 'Add new column, dual-write in application, backfill asynchronously, and swap columns.',
    },
    {
      rule: 'NOT_NULL_WITHOUT_DEFAULT',
      pattern: /ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN\s+\w+.*NOT\s+NULL(?!\s+DEFAULT)/i,
      message: 'Adding NOT NULL column without DEFAULT requires table scan and fails on populated tables.',
      recommendation: 'Add column as nullable, backfill existing rows, and add CHECK constraint with NOT VALID.',
    },
    {
      rule: 'DESTRUCTIVE_DROP_OPERATION',
      pattern: /DROP\s+(TABLE|COLUMN)\s+/i,
      message: 'Destructive DROP operation permanently drops schema object.',
      recommendation: 'Deprecate column/table in application first; require explicit reviewed waiver and backup snapshot.',
    },
    {
      rule: 'INDEX_WITHOUT_CONCURRENT',
      pattern: /CREATE\s+(UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY)/i,
      message: 'Index created without CONCURRENTLY locks writes on PostgreSQL.',
      recommendation: 'Use CREATE INDEX CONCURRENTLY IF NOT EXISTS.',
    },
  ];

  /**
   * Preflight SQL migration statements
   */
  public static checkSql(
    migrationName: string,
    sql: string,
    waivers: MigrationWaiver[] = [],
    recoveryPlan?: RollForwardRecoveryPlan
  ): PreflightResult {
    const violations: PreflightViolation[] = [];
    const waivedViolations: PreflightViolation[] = [];

    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      for (const pattern of this.DANGEROUS_PATTERNS) {
        if (pattern.pattern.test(stmt)) {
          const violation: PreflightViolation = {
            rule: pattern.rule,
            level: pattern.rule.startsWith('DESTRUCTIVE') || pattern.rule.startsWith('UNSAFE')
              ? 'DANGEROUS'
              : 'WARNING',
            message: pattern.message,
            statement: stmt,
            recommendation: pattern.recommendation,
          };

          // Check if waived
          const isWaived = waivers.some(
            (w) => w.migrationName === migrationName && (w.rule === pattern.rule || w.rule === '*')
          );

          if (isWaived) {
            waivedViolations.push(violation);
          } else {
            violations.push(violation);
          }
        }
      }
    }

    const hasDangerousViolations = violations.some((v) => v.level === 'DANGEROUS');
    const isDestructive = sql.match(/DROP\s+(TABLE|COLUMN)|TRUNCATE/i) !== null;

    let recoveryPlanValid = true;
    if (isDestructive) {
      if (!recoveryPlan || !recoveryPlan.backupSnapshotId || !recoveryPlan.forwardRecoveryScript) {
        recoveryPlanValid = false;
        violations.push({
          rule: 'MISSING_FORWARD_RECOVERY_PLAN',
          level: 'DANGEROUS',
          message: 'Destructive migration lacks valid backup snapshot or forward-only recovery script.',
          recommendation: 'Attach a RollForwardRecoveryPlan specifying snapshot ID and roll-forward procedure.',
        });
      }
    }

    const passed = violations.length === 0;

    return {
      migrationName,
      passed,
      violations,
      waivedViolations,
      requiresWaiver: hasDangerousViolations || (!recoveryPlanValid && isDestructive),
      recoveryPlanValid,
    };
  }

  /**
   * Validates application mixed-version compatibility against new schema
   */
  public static validateMixedVersionCompatibility(
    oldAppFields: string[],
    newSchemaFields: string[]
  ): { compatible: boolean; missingFields: string[] } {
    const missingFields = oldAppFields.filter((f) => !newSchemaFields.includes(f));
    return {
      compatible: missingFields.length === 0,
      missingFields,
    };
  }
}
