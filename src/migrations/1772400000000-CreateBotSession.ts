import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableForeignKey,
} from "typeorm";

export class CreateBotSession1772400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "bot_session",
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
            type: "varchar",
            isNullable: false,
          },
          {
            name: "platform",
            type: "enum",
            enum: ["discord", "telegram"],
            isNullable: false,
          },
          {
            name: "sessionType",
            type: "enum",
            enum: ["multisig_wizard", "swap_wizard", "custom_flow"],
            isNullable: false,
          },
          {
            name: "step",
            type: "int",
            isNullable: false,
          },
          {
            name: "sessionData",
            type: "jsonb",
            isNullable: false,
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
            isNullable: false,
          },
          {
            name: "createdAt",
            type: "timestamp",
            default: "now()",
            isNullable: false,
          },
          {
            name: "updatedAt",
            type: "timestamp",
            default: "now()",
            isNullable: false,
          },
        ],
      }),
      true
    );

    // Create indexes
    await queryRunner.createIndex(
      "bot_session",
      new TableIndex({
        name: "IDX_bot_session_userId",
        columnNames: ["userId"],
      })
    );

    await queryRunner.createIndex(
      "bot_session",
      new TableIndex({
        name: "IDX_bot_session_userId_createdAt",
        columnNames: ["userId", "createdAt"],
      })
    );

    await queryRunner.createIndex(
      "bot_session",
      new TableIndex({
        name: "IDX_bot_session_sessionType_createdAt",
        columnNames: ["sessionType", "createdAt"],
      })
    );

    await queryRunner.createIndex(
      "bot_session",
      new TableIndex({
        name: "IDX_bot_session_platform_userId_expiresAt",
        columnNames: ["platform", "userId", "expiresAt"],
      })
    );

    await queryRunner.createIndex(
      "bot_session",
      new TableIndex({
        name: "IDX_bot_session_createdAt",
        columnNames: ["createdAt"],
      })
    );

    await queryRunner.createIndex(
      "bot_session",
      new TableIndex({
        name: "IDX_bot_session_updatedAt",
        columnNames: ["updatedAt"],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.dropIndex("bot_session", "IDX_bot_session_userId");
    await queryRunner.dropIndex(
      "bot_session",
      "IDX_bot_session_userId_createdAt"
    );
    await queryRunner.dropIndex(
      "bot_session",
      "IDX_bot_session_sessionType_createdAt"
    );
    await queryRunner.dropIndex(
      "bot_session",
      "IDX_bot_session_platform_userId_expiresAt"
    );
    await queryRunner.dropIndex("bot_session", "IDX_bot_session_createdAt");
    await queryRunner.dropIndex("bot_session", "IDX_bot_session_updatedAt");

    // Drop table
    await queryRunner.dropTable("bot_session");
  }
}
