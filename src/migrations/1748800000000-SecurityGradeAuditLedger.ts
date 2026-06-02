/**
 * Migration: SecurityGradeAuditLedger1748800000000
 *
 * Adds columns and SecOps-optimised indexes for Issue #344.
 *
 * New columns:
 *   correlation_id     VARCHAR  — distributed trace identifier
 *   actor_id           VARCHAR  — canonical actor (user or service)
 *   actor_service_id   VARCHAR  — service/bot identifier
 *   actor_roles        TEXT     — comma-separated roles (simple-array)
 *   category           VARCHAR  — taxonomy bucket (Auth|Admin|Execution|Policy|Integration)
 *   event_hash         VARCHAR(64) — SHA-256 of immutable fields
 *   previous_hash      VARCHAR(64) — SHA-256 of preceding event (hash chain)
 *
 * New indexes (all composite with createdAt for time-range efficiency):
 *   idx_audit_category_time
 *   idx_audit_correlation_time
 *   idx_audit_actor_time
 *   idx_audit_action_time
 *   idx_audit_severity_time
 *   idx_audit_user_time
 *   idx_audit_correlation_id  (standalone)
 *   idx_audit_actor_id        (standalone)
 *   idx_audit_user_id         (standalone)
 *   idx_audit_created_at      (standalone)
 */

import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from "typeorm";

export class SecurityGradeAuditLedger1748800000000 implements MigrationInterface {
  name = "SecurityGradeAuditLedger1748800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── New columns ─────────────────────────────────────────────────────────

    await queryRunner.addColumns("audit_log", [
      new TableColumn({
        name: "correlation_id",
        type: "varchar",
        isNullable: true,
      }),
      new TableColumn({
        name: "actor_id",
        type: "varchar",
        isNullable: true,
      }),
      new TableColumn({
        name: "actor_service_id",
        type: "varchar",
        isNullable: true,
      }),
      new TableColumn({
        name: "actor_roles",
        type: "text",
        isNullable: true,
        comment: "Comma-separated role list (TypeORM simple-array)",
      }),
      new TableColumn({
        name: "category",
        type: "varchar",
        isNullable: true,
        default: null,
        comment: "Event taxonomy bucket: Auth|Admin|Execution|Policy|Integration",
      }),
      new TableColumn({
        name: "event_hash",
        type: "varchar",
        length: "64",
        isNullable: true,
        comment: "SHA-256 of canonical immutable event fields",
      }),
      new TableColumn({
        name: "previous_hash",
        type: "varchar",
        length: "64",
        isNullable: true,
        comment: "SHA-256 of the immediately preceding event (chain link)",
      }),
    ]);

    // ── SecOps composite indexes ────────────────────────────────────────────

    await queryRunner.createIndices("audit_log", [
      new TableIndex({
        name: "idx_audit_category_time",
        columnNames: ["category", "created_at"],
      }),
      new TableIndex({
        name: "idx_audit_correlation_time",
        columnNames: ["correlation_id", "created_at"],
      }),
      new TableIndex({
        name: "idx_audit_actor_time",
        columnNames: ["actor_id", "created_at"],
      }),
      new TableIndex({
        name: "idx_audit_action_time",
        columnNames: ["action", "created_at"],
      }),
      new TableIndex({
        name: "idx_audit_severity_time",
        columnNames: ["severity", "created_at"],
      }),
      new TableIndex({
        name: "idx_audit_user_time",
        columnNames: ["user_id", "created_at"],
      }),
      // Standalone point-lookup indexes
      new TableIndex({
        name: "idx_audit_correlation_id",
        columnNames: ["correlation_id"],
      }),
      new TableIndex({
        name: "idx_audit_actor_id",
        columnNames: ["actor_id"],
      }),
      new TableIndex({
        name: "idx_audit_user_id",
        columnNames: ["user_id"],
      }),
      new TableIndex({
        name: "idx_audit_created_at",
        columnNames: ["created_at"],
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    const indexes = [
      "idx_audit_category_time",
      "idx_audit_correlation_time",
      "idx_audit_actor_time",
      "idx_audit_action_time",
      "idx_audit_severity_time",
      "idx_audit_user_time",
      "idx_audit_correlation_id",
      "idx_audit_actor_id",
      "idx_audit_user_id",
      "idx_audit_created_at",
    ];

    for (const indexName of indexes) {
      await queryRunner.dropIndex("audit_log", indexName);
    }

    // Drop columns
    const columns = [
      "correlation_id",
      "actor_id",
      "actor_service_id",
      "actor_roles",
      "category",
      "event_hash",
      "previous_hash",
    ];

    for (const colName of columns) {
      await queryRunner.dropColumn("audit_log", colName);
    }
  }
}
