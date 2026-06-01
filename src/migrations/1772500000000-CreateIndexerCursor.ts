import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
} from "typeorm";

/**
 * Creates the indexer_cursor table used by the Stellar/Soroban event
 * indexing pipeline to durably track the last processed ledger per stream.
 */
export class CreateIndexerCursor1772500000000 implements MigrationInterface {
  name = "CreateIndexerCursor1772500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "indexer_cursor",
        columns: [
          {
            name: "streamId",
            type: "varchar",
            length: "255",
            isPrimary: true,
          },
          {
            name: "lastLedger",
            type: "bigint",
            isNullable: false,
          },
          {
            name: "lastEventId",
            type: "varchar",
            length: "255",
            isNullable: true,
          },
          {
            name: "lastLedgerClosedAt",
            type: "varchar",
            length: "64",
            isNullable: true,
          },
          {
            name: "meta",
            type: "jsonb",
            isNullable: true,
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

    await queryRunner.createIndex(
      "indexer_cursor",
      new TableIndex({
        name: "IDX_indexer_cursor_lastLedger",
        columnNames: ["lastLedger"],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      "indexer_cursor",
      "IDX_indexer_cursor_lastLedger"
    );
    await queryRunner.dropTable("indexer_cursor");
  }
}
