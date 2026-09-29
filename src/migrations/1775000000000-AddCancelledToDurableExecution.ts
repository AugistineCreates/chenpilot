import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * AddCancelledToDurableExecution
 *
 * Adds `cancelled` as a valid value in the `durable_execution_status_enum`
 * Postgres enum type, and appends three auditable cancellation columns:
 *
 *   - `cancelledAt`          TIMESTAMP WITHOUT TIME ZONE – when the execution
 *                            entered the CANCELLED state.
 *   - `cancelledBy`          UUID – the userId (or operator ID) that requested
 *                            cancellation.
 *   - `cancellationReason`   TEXT – optional human-readable reason.
 *
 * All three columns are nullable so that no existing rows need to be back-filled.
 *
 * ### Rollback safety
 * The `down()` migration:
 *   1. Drops the three columns.
 *   2. Re-creates the enum *without* `cancelled` using the safe Postgres idiom
 *      (add a temporary column, drop the original, rename, update the entity
 *      column type).
 *   NOTE: Rollback will fail with a constraint error if any row currently
 *   holds status = 'cancelled'.  Callers must back-fill or delete those rows
 *   before running `down()`.
 */
export class AddCancelledToDurableExecution1775000000000
  implements MigrationInterface
{
  name = "AddCancelledToDurableExecution1775000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Extend the existing enum type.
    //    ALTER TYPE … ADD VALUE is transactional in Postgres 12+, but cannot
    //    be run inside an explicit transaction block that also touches the
    //    column.  We commit first, then add the columns.
    await queryRunner.query(
      `ALTER TYPE "durable_execution_status_enum" ADD VALUE IF NOT EXISTS 'cancelled'`
    );

    // 2. Add the three audit columns (all nullable).
    await queryRunner.query(
      `ALTER TABLE "durable_execution"
         ADD COLUMN IF NOT EXISTS "cancelledAt"           TIMESTAMP WITHOUT TIME ZONE,
         ADD COLUMN IF NOT EXISTS "cancelledBy"           UUID,
         ADD COLUMN IF NOT EXISTS "cancellationReason"    TEXT`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Remove the audit columns first.
    await queryRunner.query(
      `ALTER TABLE "durable_execution"
         DROP COLUMN IF EXISTS "cancelledAt",
         DROP COLUMN IF EXISTS "cancelledBy",
         DROP COLUMN IF EXISTS "cancellationReason"`
    );

    // 2. Rebuild the enum without 'cancelled'.
    //    Postgres does not support DROP VALUE from an enum, so we must
    //    recreate it via a rename-and-swap idiom.

    // 2a. Create a replacement enum with the original values only.
    await queryRunner.query(
      `CREATE TYPE "durable_execution_status_enum_old"
         AS ENUM ('pending', 'running', 'completed', 'failed', 'paused', 'awaiting_approval')`
    );

    // 2b. Migrate the column to use the new (old) type.
    //     Any row with status='cancelled' will cause a cast failure here —
    //     those rows must be cleaned up before running the rollback.
    await queryRunner.query(
      `ALTER TABLE "durable_execution"
         ALTER COLUMN "status" TYPE "durable_execution_status_enum_old"
           USING "status"::text::"durable_execution_status_enum_old"`
    );

    // 2c. Drop the current (extended) enum and rename the replacement.
    await queryRunner.query(`DROP TYPE "durable_execution_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "durable_execution_status_enum_old"
         RENAME TO "durable_execution_status_enum"`
    );
  }
}
