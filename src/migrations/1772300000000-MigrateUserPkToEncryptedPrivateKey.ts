import { MigrationInterface, QueryRunner } from "typeorm";
import { decrypt, encrypt } from "../utils/encryption";

export class MigrateUserPkToEncryptedPrivateKey1772300000000 implements MigrationInterface {
  name = "MigrateUserPkToEncryptedPrivateKey1772300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const users: Array<{
      id: string;
      pk: string | null;
      encryptedPrivateKey: string | null;
    }> = await queryRunner.query(
      `SELECT id, pk, "encryptedPrivateKey" FROM "user" WHERE pk IS NOT NULL AND pk <> ''`
    );

    for (const user of users) {
      if (!user.pk) {
        continue;
      }

      const hasEncryptedKey =
        user.encryptedPrivateKey && user.encryptedPrivateKey !== "STRK";
      if (!hasEncryptedKey) {
        const encryptedValue = encrypt(user.pk);
        await queryRunner.query(
          `UPDATE "user" SET "encryptedPrivateKey" = $1 WHERE id = $2`,
          [encryptedValue, user.id]
        );
      }
    }

    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "pk"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN "pk" character varying`
    );

    const users: Array<{ id: string; encryptedPrivateKey: string | null }> =
      await queryRunner.query(
        `SELECT id, "encryptedPrivateKey" FROM "user" WHERE "encryptedPrivateKey" IS NOT NULL AND "encryptedPrivateKey" <> ''`
      );

    for (const user of users) {
      if (!user.encryptedPrivateKey) continue;
      const decryptedValue = decrypt(user.encryptedPrivateKey);
      await queryRunner.query(`UPDATE "user" SET pk = $1 WHERE id = $2`, [
        decryptedValue,
        user.id,
      ]);
    }
  }
}
