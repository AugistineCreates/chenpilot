import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class CreateTransactionSubmission1788100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "transaction_submission",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "idempotencyKey",
            type: "varchar",
            isNullable: false,
            isUnique: true,
          },
          { name: "userId", type: "varchar", isNullable: false },
          { name: "operationType", type: "varchar", isNullable: false },
          {
            name: "state",
            type: "varchar",
            isNullable: false,
            default: "'built'",
          },
          {
            name: "transactionHash",
            type: "varchar",
            isNullable: false,
            isUnique: true,
          },
          { name: "envelopeXdr", type: "text", isNullable: false },
          { name: "sourceAccount", type: "varchar", isNullable: false },
          { name: "sequenceNumber", type: "varchar", isNullable: false },
          { name: "maxTime", type: "varchar", isNullable: true },
          {
            name: "submitAttempts",
            type: "integer",
            isNullable: false,
            default: 0,
          },
          {
            name: "resolutionAttempts",
            type: "integer",
            isNullable: false,
            default: 0,
          },
          { name: "nextResolutionAt", type: "timestamp", isNullable: true },
          { name: "ledger", type: "integer", isNullable: true },
          { name: "resultXdr", type: "text", isNullable: true },
          { name: "lastReason", type: "text", isNullable: true },
          { name: "submittedAt", type: "timestamp", isNullable: true },
          { name: "resolvedAt", type: "timestamp", isNullable: true },
          { name: "lifecycleId", type: "varchar", isNullable: true },
          { name: "metadata", type: "jsonb", isNullable: true },
          {
            name: "createdAt",
            type: "timestamp",
            isNullable: false,
            default: "now()",
          },
          {
            name: "updatedAt",
            type: "timestamp",
            isNullable: false,
            default: "now()",
          },
        ],
      }),
      true
    );

    await queryRunner.createIndices("transaction_submission", [
      new TableIndex({
        name: "IDX_transaction_submission_state_next_resolution",
        columnNames: ["state", "nextResolutionAt"],
      }),
      new TableIndex({
        name: "IDX_transaction_submission_account_sequence",
        columnNames: ["sourceAccount", "sequenceNumber"],
      }),
      new TableIndex({
        name: "IDX_transaction_submission_user_created",
        columnNames: ["userId", "createdAt"],
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      "transaction_submission",
      "IDX_transaction_submission_user_created"
    );
    await queryRunner.dropIndex(
      "transaction_submission",
      "IDX_transaction_submission_account_sequence"
    );
    await queryRunner.dropIndex(
      "transaction_submission",
      "IDX_transaction_submission_state_next_resolution"
    );
    await queryRunner.dropTable("transaction_submission");
  }
}
