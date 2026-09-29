import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class CreateShadowComparisonRecords1774000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'
    );
    await queryRunner.createTable(
      new Table({
        name: "shadow_comparison_records",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          { name: "candidateId", type: "varchar", length: "64", isNullable: false },
          { name: "subject", type: "varchar", length: "32", isNullable: false },
          { name: "version", type: "varchar", length: "32", isNullable: false },
          { name: "runId", type: "varchar", length: "128", isNullable: false },
          { name: "diverged", type: "boolean", default: "false", isNullable: false },
          { name: "classes", type: "jsonb", isNullable: false, default: "'[]'" },
          { name: "metadata", type: "jsonb", isNullable: false, default: "'{}'" },
          { name: "reviewedException", type: "boolean", default: "false", isNullable: false },
          { name: "evaluatedAt", type: "timestamptz", default: "now()", isNullable: false },
        ],
      }),
      true
    );

    await queryRunner.createIndex(
      "shadow_comparison_records",
      new TableIndex({
        name: "IDX_shadow_candidateId",
        columnNames: ["candidateId"],
      })
    );
    await queryRunner.createIndex(
      "shadow_comparison_records",
      new TableIndex({ name: "IDX_shadow_subject", columnNames: ["subject"] })
    );
    await queryRunner.createIndex(
      "shadow_comparison_records",
      new TableIndex({ name: "IDX_shadow_runId", columnNames: ["runId"] })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("shadow_comparison_records");
  }
}
