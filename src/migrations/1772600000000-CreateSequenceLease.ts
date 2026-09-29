import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class CreateSequenceLease1772600000000 implements MigrationInterface {
  name = "CreateSequenceLease1772600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum type if it doesn't exist
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "sequence_lease_status_enum" AS ENUM ('reserved', 'consumed', 'expired', 'reclaimed');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.createTable(
      new Table({
        name: "sequence_lease",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "accountPublicKey",
            type: "varchar",
            length: "64",
            isNullable: false,
          },
          {
            name: "leasedSequence",
            type: "bigint",
            isNullable: false,
          },
          {
            name: "fencingToken",
            type: "bigint",
            isNullable: false,
          },
          {
            name: "ownerId",
            type: "varchar",
            length: "128",
            isNullable: false,
          },
          {
            name: "status",
            type: "enum",
            enum: ["reserved", "consumed", "expired", "reclaimed"],
            default: "'reserved'",
          },
          {
            name: "reservedAt",
            type: "timestamp",
            isNullable: false,
          },
          {
            name: "expiresAt",
            type: "timestamp",
            isNullable: false,
          },
          {
            name: "consumedAt",
            type: "timestamp",
            isNullable: true,
          },
          {
            name: "txHash",
            type: "varchar",
            length: "128",
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

    // Indexes
    await queryRunner.createIndex(
      "sequence_lease",
      new TableIndex({
        name: "IDX_sequence_lease_account_status",
        columnNames: ["accountPublicKey", "status"],
      })
    );

    await queryRunner.createIndex(
      "sequence_lease",
      new TableIndex({
        name: "IDX_sequence_lease_account_sequence",
        columnNames: ["accountPublicKey", "leasedSequence"],
        isUnique: true,
      })
    );

    await queryRunner.createIndex(
      "sequence_lease",
      new TableIndex({
        name: "IDX_sequence_lease_status_expires",
        columnNames: ["status", "expiresAt"],
      })
    );

    await queryRunner.createIndex(
      "sequence_lease",
      new TableIndex({
        name: "IDX_sequence_lease_account_fencing",
        columnNames: ["accountPublicKey", "fencingToken"],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("sequence_lease");
    await queryRunner.query(`DROP TYPE IF EXISTS "sequence_lease_status_enum"`);
  }
}
