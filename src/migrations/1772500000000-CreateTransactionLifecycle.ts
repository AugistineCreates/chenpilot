import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class CreateTransactionLifecycle1772500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "transaction_lifecycle",
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
            name: "operationType",
            type: "varchar",
            isNullable: false,
          },
          {
            name: "state",
            type: "varchar",
            default: "'intent'",
          },
          {
            name: "correlationId",
            type: "varchar",
            isNullable: true,
          },
          {
            name: "payload",
            type: "jsonb",
            isNullable: true,
          },
          {
            name: "metadata",
            type: "jsonb",
            isNullable: true,
          },
          {
            name: "lastTransitionReason",
            type: "text",
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
      "transaction_lifecycle",
      new TableIndex({ name: "IDX_txlc_userId_createdAt", columnNames: ["userId", "createdAt"] })
    );
    await queryRunner.createIndex(
      "transaction_lifecycle",
      new TableIndex({ name: "IDX_txlc_operationType_state", columnNames: ["operationType", "state"] })
    );
    await queryRunner.createIndex(
      "transaction_lifecycle",
      new TableIndex({ name: "IDX_txlc_correlationId", columnNames: ["correlationId"] })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("transaction_lifecycle");
  }
}
