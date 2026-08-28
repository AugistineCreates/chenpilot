import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class CreateAssetRevocation1772700000000 implements MigrationInterface {
  name = "CreateAssetRevocation1772700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "asset_revocation",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "type",
            type: "varchar",
            isNullable: false,
          },
          {
            name: "code",
            type: "varchar",
            length: "128",
            isNullable: false,
          },
          {
            name: "reason",
            type: "varchar",
            isNullable: false,
          },
          {
            name: "scope",
            type: "varchar",
            default: "'global'",
          },
          {
            name: "userId",
            type: "varchar",
            isNullable: true,
          },
          {
            name: "description",
            type: "text",
            isNullable: true,
          },
          {
            name: "expiresAt",
            type: "timestamp",
            isNullable: true,
          },
          {
            name: "isActive",
            type: "boolean",
            default: true,
          },
          {
            name: "addedBy",
            type: "varchar",
            isNullable: true,
          },
          {
            name: "signature",
            type: "text",
            isNullable: true,
          },
          {
            name: "signatureAlgorithm",
            type: "varchar",
            length: "64",
            isNullable: true,
          },
          {
            name: "metadata",
            type: "simple-json",
            isNullable: true,
          },
          {
            name: "createdAt",
            type: "timestamp",
            default: "now()",
          },
          {
            name: "updatedAt",
            type: "timestamp",
            default: "now()",
          },
        ],
      }),
      true
    );

    await queryRunner.createIndex(
      "asset_revocation",
      new TableIndex({
        name: "IDX_asset_revocation_type_code_active",
        columnNames: ["type", "code", "isActive"],
      })
    );

    await queryRunner.createIndex(
      "asset_revocation",
      new TableIndex({
        name: "IDX_asset_revocation_active_expires",
        columnNames: ["isActive", "expiresAt"],
      })
    );

    await queryRunner.createIndex(
      "asset_revocation",
      new TableIndex({
        name: "IDX_asset_revocation_type_code",
        columnNames: ["type", "code"],
      })
    );

    await queryRunner.createIndex(
      "asset_revocation",
      new TableIndex({
        name: "IDX_asset_revocation_code",
        columnNames: ["code"],
      })
    );

    await queryRunner.createIndex(
      "asset_revocation",
      new TableIndex({
        name: "IDX_asset_revocation_isActive",
        columnNames: ["isActive"],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("asset_revocation");
  }
}
