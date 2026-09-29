import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class AddReorgAwarenessToTransactions1785700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add finality tracking columns to transaction_lifecycle
    await queryRunner.query(`
      ALTER TABLE "transaction_lifecycle"
      ADD COLUMN "ledger_sequence" BIGINT,
      ADD COLUMN "ledger_hash" VARCHAR(64),
      ADD COLUMN "confirmation_depth" INTEGER DEFAULT 0,
      ADD COLUMN "observed_at_provider" VARCHAR(128),
      ADD COLUMN "finality_status" VARCHAR(32) DEFAULT 'PENDING',
      ADD COLUMN "finality_declared_at" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN "orphaned_at" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN "orphaned_ledger_hash" VARCHAR(64),
      ADD COLUMN "reconciled_at" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN "reconcile_provider" VARCHAR(128),
      ADD COLUMN "reorg_depth" INTEGER;
    `);

    // Create ledger_observations audit table
    await queryRunner.createTable(
      new Table({
        name: "ledger_observations",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "transaction_id",
            type: "uuid",
            isNullable: false,
          },
          {
            name: "provider",
            type: "varchar",
            length: "128",
            isNullable: false,
          },
          {
            name: "ledger_sequence",
            type: "bigint",
            isNullable: false,
          },
          {
            name: "ledger_hash",
            type: "varchar",
            length: "64",
            isNullable: false,
          },
          {
            name: "parent_ledger_hash",
            type: "varchar",
            length: "64",
            isNullable: true,
          },
          {
            name: "tx_result",
            type: "varchar",
            length: "32",
            isNullable: false,
            comment: "SUCCESS | FAILED | NOT_FOUND",
          },
          {
            name: "observed_at",
            type: "timestamp with time zone",
            default: "now()",
            isNullable: false,
          },
        ],
      }),
      true
    );

    // Create indexes on ledger_observations
    await queryRunner.createIndex(
      "ledger_observations",
      new TableIndex({
        name: "IDX_ledger_obs_transaction_id",
        columnNames: ["transaction_id"],
      })
    );

    await queryRunner.createIndex(
      "ledger_observations",
      new TableIndex({
        name: "IDX_ledger_obs_provider_sequence",
        columnNames: ["provider", "ledger_sequence"],
      })
    );

    await queryRunner.createIndex(
      "ledger_observations",
      new TableIndex({
        name: "IDX_ledger_obs_observed_at",
        columnNames: ["observed_at"],
      })
    );

    // Add foreign key constraint
    await queryRunner.query(`
      ALTER TABLE "ledger_observations"
      ADD CONSTRAINT "FK_ledger_obs_transaction_id"
      FOREIGN KEY ("transaction_id")
      REFERENCES "transaction_lifecycle"("id")
      ON DELETE CASCADE;
    `);

    // Add indexes on transaction_lifecycle for finality status tracking
    await queryRunner.createIndex(
      "transaction_lifecycle",
      new TableIndex({
        name: "IDX_txlc_finality_status",
        columnNames: ["finality_status"],
      })
    );

    await queryRunner.createIndex(
      "transaction_lifecycle",
      new TableIndex({
        name: "IDX_txlc_ledger_sequence",
        columnNames: ["ledger_sequence"],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop ledger_observations table
    await queryRunner.dropTable("ledger_observations");

    // Remove columns from transaction_lifecycle
    await queryRunner.query(`
      ALTER TABLE "transaction_lifecycle"
      DROP COLUMN "reorg_depth",
      DROP COLUMN "reconcile_provider",
      DROP COLUMN "reconciled_at",
      DROP COLUMN "orphaned_ledger_hash",
      DROP COLUMN "orphaned_at",
      DROP COLUMN "finality_declared_at",
      DROP COLUMN "finality_status",
      DROP COLUMN "observed_at_provider",
      DROP COLUMN "confirmation_depth",
      DROP COLUMN "ledger_hash",
      DROP COLUMN "ledger_sequence";
    `);
  }
}
