import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 1756540000000-DataLifecycle
 *
 * Creates three tables required by the data lifecycle management system:
 *   1. user_key_tombstone  — per-user DEK lifecycle tracking (cryptographic erasure)
 *   2. legal_hold_entry    — narrowly scoped compliance / legal holds
 *   3. erasure_receipt     — cryptographic proof-of-erasure receipts
 */
export class DataLifecycle1756540000000 implements MigrationInterface {
  name = "DataLifecycle1756540000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. user_key_tombstone ──────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_key_tombstone" (
        "id"                UUID        NOT NULL DEFAULT gen_random_uuid(),
        "userId"            VARCHAR     NOT NULL,
        "dekVersion"        INT         NOT NULL DEFAULT 1,
        "encryptedDek"      VARCHAR,
        "tombstonedAt"      TIMESTAMP,
        "tombstoneReason"   VARCHAR,
        "createdAt"         TIMESTAMP   NOT NULL DEFAULT now(),
        "updatedAt"         TIMESTAMP   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_key_tombstone" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_user_key_tombstone_userId" UNIQUE ("userId")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_key_tombstone_userId"
        ON "user_key_tombstone" ("userId")
    `);

    // ── 2. legal_hold_entry ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "legal_hold_entry" (
        "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
        "holdId"        VARCHAR     NOT NULL,
        "subjectType"   VARCHAR     NOT NULL,
        "subjectId"     VARCHAR     NOT NULL,
        "dataClasses"   TEXT        NOT NULL DEFAULT '',
        "reason"        TEXT        NOT NULL,
        "requestedBy"   VARCHAR     NOT NULL,
        "placedAt"      TIMESTAMP   NOT NULL,
        "liftedAt"      TIMESTAMP,
        "liftedBy"      VARCHAR,
        "expiresAt"     TIMESTAMP,
        "createdAt"     TIMESTAMP   NOT NULL DEFAULT now(),
        "updatedAt"     TIMESTAMP   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_legal_hold_entry" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lhe_hold_id"
        ON "legal_hold_entry" ("holdId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lhe_subject_id"
        ON "legal_hold_entry" ("subjectId")
    `);

    // ── 3. erasure_receipt ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "erasure_receipt" (
        "id"              UUID        NOT NULL,
        "subjectIdHash"   VARCHAR     NOT NULL,
        "receiptJson"     JSONB       NOT NULL,
        "receiptHash"     VARCHAR     NOT NULL,
        "createdAt"       TIMESTAMP   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_erasure_receipt" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_er_subject_hash"
        ON "erasure_receipt" ("subjectIdHash")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_er_created_at"
        ON "erasure_receipt" ("createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "erasure_receipt"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "legal_hold_entry"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_key_tombstone"`);
  }
}
