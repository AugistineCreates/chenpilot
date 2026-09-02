import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class CreateEncryptionKeyRotation1773100000000 implements MigrationInterface {
  name = "CreateEncryptionKeyRotation1773100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "encryption_key_rotation",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          { name: "sourceKeyId", type: "varchar", length: "64" },
          { name: "targetKeyId", type: "varchar", length: "64" },
          { name: "cursor", type: "uuid", isNullable: true },
          {
            name: "status",
            type: "varchar",
            length: "16",
            default: "'running'",
          },
          { name: "processedCount", type: "integer", default: 0 },
          { name: "rotatedCount", type: "integer", default: 0 },
          { name: "skippedCount", type: "integer", default: 0 },
          { name: "remainingReferences", type: "integer", isNullable: true },
          { name: "lastError", type: "varchar", isNullable: true },
          { name: "createdAt", type: "timestamp", default: "now()" },
          { name: "updatedAt", type: "timestamp", default: "now()" },
          { name: "completedAt", type: "timestamp", isNullable: true },
        ],
      })
    );
    await queryRunner.createIndex(
      "encryption_key_rotation",
      new TableIndex({
        name: "IDX_encryption_key_rotation_keys",
        columnNames: ["sourceKeyId", "targetKeyId"],
        isUnique: true,
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("encryption_key_rotation");
  }
}
