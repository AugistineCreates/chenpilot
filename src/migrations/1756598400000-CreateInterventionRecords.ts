import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from "typeorm";

/**
 * Creates the `intervention_records` table.
 *
 * Design notes
 * ────────────
 * - Rows are INSERT-only after initial creation (no UPDATE path in application
 *   code, enforced by convention).  The table has no ON UPDATE trigger so any
 *   ad-hoc UPDATE is visible in Postgres WAL for auditing.
 * - executionId references durable_execution(id) but uses RESTRICT to prevent
 *   cascade-deleting the forensic record if an execution is ever purged.
 * - Composite indexes mirror the most common forensic query patterns:
 *     execution timeline, operator timeline, command/status filtering.
 */
export class CreateInterventionRecords1756598400000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "intervention_records",
        columns: [
          // ── Primary Key ─────────────────────────────────────────────────
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },

          // ── Execution linkage ────────────────────────────────────────────
          {
            name: "executionId",
            type: "uuid",
            isNullable: false,
          },
          {
            name: "targetStepNumber",
            type: "integer",
            isNullable: true,
            comment:
              "Step targeted by RETRY/SKIP/COMPENSATE; NULL for execution-level commands",
          },

          // ── Command & Status ─────────────────────────────────────────────
          {
            name: "command",
            type: "varchar",
            isNullable: false,
            comment: "One of: retry, skip, compensate, quarantine, resolve",
          },
          {
            name: "status",
            type: "varchar",
            default: "'pending_approval'",
            isNullable: false,
            comment:
              "pending_approval | approved | rejected | dry_run | applied | failed",
          },

          // ── Operator ─────────────────────────────────────────────────────
          {
            name: "operatorId",
            type: "uuid",
            isNullable: false,
          },

          // ── Signed payload ────────────────────────────────────────────────
          {
            name: "payload",
            type: "jsonb",
            isNullable: false,
            comment: "Command payload as submitted (PII-scrubbed)",
          },
          {
            name: "signature",
            type: "varchar",
            length: "64",
            isNullable: false,
            comment: "HMAC-SHA256 hex digest from the signed envelope",
          },
          {
            name: "nonce",
            type: "varchar",
            length: "128",
            isNullable: false,
            comment: "One-time nonce preventing replay attacks",
          },
          {
            name: "issuedAt",
            type: "varchar",
            length: "32",
            isNullable: false,
            comment: "ISO-8601 timestamp from the signed envelope",
          },

          // ── Execution transcript binding ──────────────────────────────────
          {
            name: "executionTranscriptHash",
            type: "varchar",
            length: "64",
            isNullable: false,
            comment:
              "SHA-256 of execution state snapshot at evaluation time; " +
              "verifying this hash detects retrospective transcript tampering",
          },

          // ── Dry-run ───────────────────────────────────────────────────────
          {
            name: "dryRun",
            type: "boolean",
            default: false,
            isNullable: false,
          },
          {
            name: "dryRunOutput",
            type: "jsonb",
            isNullable: true,
            comment: "JSON preview for dry-run records; NULL for live records",
          },

          // ── Multi-party approval linkage ──────────────────────────────────
          {
            name: "workflowInstanceId",
            type: "uuid",
            isNullable: true,
            comment:
              "FK → admin_workflow_instances.id; set for high-risk commands requiring approval",
          },

          // ── Audit log linkage ─────────────────────────────────────────────
          {
            name: "auditLogId",
            type: "uuid",
            isNullable: true,
            comment: "FK → audit_log.id; set when intervention is applied",
          },

          // ── Application result ────────────────────────────────────────────
          {
            name: "resultMessage",
            type: "text",
            isNullable: true,
          },
          {
            name: "errorMessage",
            type: "text",
            isNullable: true,
          },
          {
            name: "executionStatusBefore",
            type: "varchar",
            isNullable: true,
            comment: "DurableExecution.status before the intervention was applied",
          },
          {
            name: "executionStatusAfter",
            type: "varchar",
            isNullable: true,
            comment: "DurableExecution.status after the intervention was applied",
          },

          // ── Timestamps ────────────────────────────────────────────────────
          {
            name: "createdAt",
            type: "timestamp",
            default: "now()",
            isNullable: false,
          },
          {
            name: "appliedAt",
            type: "timestamp",
            isNullable: true,
          },
        ],
      }),
      true
    );

    // ── Indexes ──────────────────────────────────────────────────────────────

    // Primary forensic query: all interventions on a specific execution, chrono
    await queryRunner.createIndex(
      "intervention_records",
      new TableIndex({
        name: "IDX_ir_executionId_createdAt",
        columnNames: ["executionId", "createdAt"],
      })
    );

    // Operator timeline: all interventions by a specific operator
    await queryRunner.createIndex(
      "intervention_records",
      new TableIndex({
        name: "IDX_ir_operatorId_createdAt",
        columnNames: ["operatorId", "createdAt"],
      })
    );

    // Filtering dashboard: by command type and status
    await queryRunner.createIndex(
      "intervention_records",
      new TableIndex({
        name: "IDX_ir_command_status",
        columnNames: ["command", "status"],
      })
    );

    // Approval linkage: look up interventions waiting for a workflow
    await queryRunner.createIndex(
      "intervention_records",
      new TableIndex({
        name: "IDX_ir_workflowInstanceId",
        columnNames: ["workflowInstanceId"],
      })
    );

    // Point lookups
    await queryRunner.createIndex(
      "intervention_records",
      new TableIndex({
        name: "IDX_ir_executionId",
        columnNames: ["executionId"],
      })
    );

    await queryRunner.createIndex(
      "intervention_records",
      new TableIndex({
        name: "IDX_ir_operatorId",
        columnNames: ["operatorId"],
      })
    );

    await queryRunner.createIndex(
      "intervention_records",
      new TableIndex({
        name: "IDX_ir_createdAt",
        columnNames: ["createdAt"],
      })
    );

    // ── Foreign key ───────────────────────────────────────────────────────────
    //
    // RESTRICT (not CASCADE) intentionally: deleting a DurableExecution must
    // not silently destroy the forensic intervention trail.  Operators must
    // explicitly clean up intervention records before an execution can be purged.

    await queryRunner.createForeignKey(
      "intervention_records",
      new TableForeignKey({
        name: "FK_ir_executionId",
        columnNames: ["executionId"],
        referencedTableName: "durable_execution",
        referencedColumnNames: ["id"],
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey(
      "intervention_records",
      "FK_ir_executionId"
    );
    await queryRunner.dropTable("intervention_records");
  }
}
