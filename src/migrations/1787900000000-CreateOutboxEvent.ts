import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class CreateOutboxEvent1787900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the enum type
    await queryRunner.query(`
      CREATE TYPE "outbox_event_status_enum" AS ENUM ('pending', 'dispatched', 'failed')
    `);

    await queryRunner.createTable(
      new Table({
        name: "outbox_event",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "eventId",
            type: "varchar",
            length: "255",
            isNullable: false,
          },
          {
            name: "eventType",
            type: "varchar",
            length: "128",
            isNullable: false,
          },
          {
            name: "aggregateType",
            type: "varchar",
            length: "64",
            isNullable: false,
          },
          {
            name: "aggregateId",
            type: "varchar",
            length: "255",
            isNullable: true,
          },
          {
            name: "sequence",
            type: "bigint",
            default: 0,
          },
          {
            name: "payload",
            type: "jsonb",
            isNullable: false,
          },
          {
            name: "metadata",
            type: "jsonb",
            isNullable: true,
          },
          {
            name: "status",
            type: "outbox_event_status_enum",
            default: "'pending'",
          },
          {
            name: "retryCount",
            type: "integer",
            default: 0,
          },
          {
            name: "maxRetries",
            type: "integer",
            default: 5,
          },
          {
            name: "nextRetryAt",
            type: "timestamp",
            isNullable: true,
          },
          {
            name: "dispatchedAt",
            type: "timestamp",
            isNullable: true,
          },
          {
            name: "errorMessage",
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

    // Unique index on eventId for idempotent consumer deduplication
    await queryRunner.createIndex(
      "outbox_event",
      new TableIndex({
        name: "IDX_outbox_eventId",
        columnNames: ["eventId"],
        isUnique: true,
      })
    );

    // Composite index for aggregate ordering
    await queryRunner.createIndex(
      "outbox_event",
      new TableIndex({
        name: "IDX_outbox_aggregate_sequence",
        columnNames: ["aggregateType", "aggregateId", "sequence"],
      })
    );

    // Index for dispatcher polling
    await queryRunner.createIndex(
      "outbox_event",
      new TableIndex({
        name: "IDX_outbox_status_retryAt",
        columnNames: ["status", "nextRetryAt"],
      })
    );

    // Index for retention cleanup
    await queryRunner.createIndex(
      "outbox_event",
      new TableIndex({
        name: "IDX_outbox_createdAt",
        columnNames: ["createdAt"],
      })
    );

    // Index on eventType for handler lookup
    await queryRunner.createIndex(
      "outbox_event",
      new TableIndex({
        name: "IDX_outbox_eventType",
        columnNames: ["eventType"],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("outbox_event");
    await queryRunner.query(`DROP TYPE "outbox_event_status_enum"`);
  }
}
