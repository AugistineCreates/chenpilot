import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * AddCancelledToDurableStep
 *
 * Adds `cancelled` as a valid value in the `durable_step_status_enum`
 * Postgres enum type, and appends one audit column:
 *
 *   - `cancelledAt`   TIMESTAMP WITHOUT TIME ZONE – recorded when the step
 *                     transitions to CANCELLED (either because the parent
 *                     execution was cancelled, or because it is a downstream
 *                     dependent of a failed step).
 *
 * The column is nullable so that no existing rows need to be back-filled.
 *
 * ### Rollback safety
 * See the sibling migration (AddCancelledToDurableExecution) for the general
 * rollback caveat: rows with status = 'cancelled' must be cleaned up before
 * running `down()`.
 */
export class AddCancelledToDurableStep1775000000001
  implements MigrationInterface
{
  name = "AddCancelledToDurableStep1775000000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Extend the existing step enum type.
    await queryRunner.query(
      `ALTER TYPE "durable_step_status_enum" ADD VALUE IF NOT EXISTS 'cancelled'`
    );

    // 2. Add the audit column (nullable).
    await queryRunner.query(
      `ALTER TABLE "durable_step"
         ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP WITHOUT TIME ZONE`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Remove the audit column.
    await queryRunner.query(
      `ALTER TABLE "durable_step"
         DROP COLUMN IF EXISTS "cancelledAt"`
    );

    // 2. Rebuild the enum without 'cancelled'.
    await queryRunner.query(
      `CREATE TYPE "durable_step_status_enum_old"
         AS ENUM ('pending', 'running', 'completed', 'failed', 'awaiting_approval')`
    );

    await queryRunner.query(
      `ALTER TABLE "durable_step"
         ALTER COLUMN "status" TYPE "durable_step_status_enum_old"
           USING "status"::text::"durable_step_status_enum_old"`
    );

    await queryRunner.query(`DROP TYPE "durable_step_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "durable_step_status_enum_old"
         RENAME TO "durable_step_status_enum"`
    );
  }
}
