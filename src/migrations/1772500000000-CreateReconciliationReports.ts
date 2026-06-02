import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class CreateReconciliationReports1772500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "reconciliation_reports",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
          },
          {
            name: "user_id",
            type: "uuid",
            isNullable: false,
          },
          {
            name: "scope",
            type: "jsonb",
            isNullable: false,
          },
          {
            name: "started_at",
            type: "timestamp",
            isNullable: false,
          },
          {
            name: "completed_at",
            type: "timestamp",
            isNullable: false,
          },
          {
            name: "drift_items",
            type: "jsonb",
            default: "'[]'",
          },
          {
            name: "summary",
            type: "jsonb",
            isNullable: false,
          },
          {
            name: "status",
            type: "varchar",
            length: "20",
            isNullable: false,
          },
          {
            name: "error_message",
            type: "text",
            isNullable: true,
          },
        ],
      }),
      true
    );

    await queryRunner.createIndex(
      "reconciliation_reports",
      new TableIndex({
        name: "IDX_RECONCILIATION_USER_STARTED",
        columnNames: ["user_id", "started_at"],
      })
    );

    await queryRunner.createIndex(
      "reconciliation_reports",
      new TableIndex({
        name: "IDX_RECONCILIATION_STATUS",
        columnNames: ["status"],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("reconciliation_reports");
  }
}
