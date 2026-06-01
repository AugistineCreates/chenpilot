import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRoleToUser1772000000000 implements MigrationInterface {
  name = "AddRoleToUser1772000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" character varying NOT NULL DEFAULT 'user'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "role"`);
  }
}
