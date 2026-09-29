import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Change-control evidence for executable prompt/policy configuration
 * (Issue #665).
 *
 * Adds the immutable authorship + approval columns that every active revision
 * must carry. The accompanying CHECK is added `NOT VALID` so pre-existing rows
 * are not retro-failed, while every new or updated row is enforced by Postgres
 * in addition to the application-level gate in `PromptChangeControl`.
 */
export class AddPromptChangeControl1788200000000 implements MigrationInterface {
  name = "AddPromptChangeControl1788200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "prompt_version"
        ADD COLUMN IF NOT EXISTS "author" character varying,
        ADD COLUMN IF NOT EXISTS "authorSignature" character varying,
        ADD COLUMN IF NOT EXISTS "revisionDigest" character varying,
        ADD COLUMN IF NOT EXISTS "approvals" jsonb,
        ADD COLUMN IF NOT EXISTS "changeTicket" character varying,
        ADD COLUMN IF NOT EXISTS "emergencyExpiresAt" TIMESTAMP
    `);

    await queryRunner.query(`
      ALTER TABLE "prompt_version"
        ADD CONSTRAINT "chk_prompt_version_active_has_change_control"
        CHECK (
          "isActive" = false OR (
            "author" IS NOT NULL
            AND "authorSignature" IS NOT NULL
            AND "revisionDigest" IS NOT NULL
            AND "approvals" IS NOT NULL
          )
        ) NOT VALID
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_prompt_version_revision_digest"
        ON "prompt_version" ("revisionDigest")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_prompt_version_revision_digest"`
    );

    await queryRunner.query(`
      ALTER TABLE "prompt_version"
        DROP CONSTRAINT IF EXISTS "chk_prompt_version_active_has_change_control"
    `);

    await queryRunner.query(`
      ALTER TABLE "prompt_version"
        DROP COLUMN IF EXISTS "emergencyExpiresAt",
        DROP COLUMN IF EXISTS "changeTicket",
        DROP COLUMN IF EXISTS "approvals",
        DROP COLUMN IF EXISTS "revisionDigest",
        DROP COLUMN IF EXISTS "authorSignature",
        DROP COLUMN IF EXISTS "author"
    `);
  }
}
