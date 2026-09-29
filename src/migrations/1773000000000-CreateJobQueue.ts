import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateJobQueue1773000000000 implements MigrationInterface {
  name = "CreateJobQueue1773000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "job_queue" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "queue" character varying(100) NOT NULL,
        "jobType" character varying(150) NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'pending',
        "userId" uuid,
        "correlationId" character varying(255),
        "payload" jsonb NOT NULL,
        "result" jsonb,
        "metadata" jsonb,
        "availableAt" TIMESTAMP NOT NULL DEFAULT now(),
        "leaseExpiresAt" TIMESTAMP,
        "leasedBy" character varying(120),
        "attempts" integer NOT NULL DEFAULT 0,
        "maxAttempts" integer NOT NULL DEFAULT 5,
        "lastError" text,
        "completedAt" TIMESTAMP,
        "deadLetteredAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_job_queue_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_job_queue_queue_status_available_at" ON "job_queue" ("queue", "status", "availableAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_job_queue_job_type_status_available_at" ON "job_queue" ("jobType", "status", "availableAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_job_queue_status_lease_expires_at" ON "job_queue" ("status", "leaseExpiresAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_job_queue_user_status" ON "job_queue" ("userId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_job_queue_correlation_id" ON "job_queue" ("correlationId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_job_queue_correlation_id"`);
    await queryRunner.query(`DROP INDEX "IDX_job_queue_user_status"`);
    await queryRunner.query(`DROP INDEX "IDX_job_queue_status_lease_expires_at"`);
    await queryRunner.query(`DROP INDEX "IDX_job_queue_job_type_status_available_at"`);
    await queryRunner.query(`DROP INDEX "IDX_job_queue_queue_status_available_at"`);
    await queryRunner.query(`DROP TABLE "job_queue"`);
  }
}
