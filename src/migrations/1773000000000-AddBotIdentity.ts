import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from "typeorm";

export class AddBotIdentity1773000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "bot_identity",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "userId",
            type: "uuid",
          },
          {
            name: "platform",
            type: "enum",
            enum: ["telegram", "discord"],
          },
          {
            name: "platformUserId",
            type: "varchar",
            isUnique: true,
          },
          {
            name: "platformUsername",
            type: "varchar",
            isNullable: true,
          },
          {
            name: "metadata",
            type: "jsonb",
            isNullable: true,
          },
          {
            name: "isActive",
            type: "boolean",
            default: true,
          },
          {
            name: "lastLinkedAt",
            type: "timestamp",
            isNullable: true,
          },
          {
            name: "lastUsedAt",
            type: "timestamp",
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

    // Create indexes
    await queryRunner.createIndex(
      "bot_identity",
      new TableIndex({
        name: "IDX_bot_identity_userId",
        columnNames: ["userId"],
      })
    );

    await queryRunner.createIndex(
      "bot_identity",
      new TableIndex({
        name: "IDX_bot_identity_platform",
        columnNames: ["platform"],
      })
    );

    await queryRunner.createIndex(
      "bot_identity",
      new TableIndex({
        name: "IDX_bot_identity_platformUserId",
        columnNames: ["platformUserId"],
        isUnique: true,
      })
    );

    await queryRunner.createIndex(
      "bot_identity",
      new TableIndex({
        name: "IDX_bot_identity_userId_platform",
        columnNames: ["userId", "platform"],
      })
    );

    await queryRunner.createIndex(
      "bot_identity",
      new TableIndex({
        name: "IDX_bot_identity_platform_platformUserId",
        columnNames: ["platform", "platformUserId"],
        isUnique: true,
      })
    );

    await queryRunner.createIndex(
      "bot_identity",
      new TableIndex({
        name: "IDX_bot_identity_createdAt",
        columnNames: ["createdAt"],
      })
    );

    await queryRunner.createIndex(
      "bot_identity",
      new TableIndex({
        name: "IDX_bot_identity_updatedAt",
        columnNames: ["updatedAt"],
      })
    );

    // Create foreign key to user table
    await queryRunner.createForeignKey(
      "bot_identity",
      new TableForeignKey({
        columnNames: ["userId"],
        referencedColumnNames: ["id"],
        referencedTableName: "user",
        onDelete: "CASCADE",
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("bot_identity");
  }
}
