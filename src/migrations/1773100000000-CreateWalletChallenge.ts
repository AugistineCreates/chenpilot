import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
} from "typeorm";

/**
 * Creates the `wallet_challenge` table that stores short-lived
 * cryptographic ownership challenges used to prove control of a
 * wallet before a bot identity is linked / unlinked.
 *
 * Key security properties baked into the schema:
 * - `nonce` is UNIQUE — prevents two challenges with the same nonce.
 * - `usedAt` starts NULL; set atomically when the challenge is consumed.
 *   An UPDATE WHERE usedAt IS NULL provides the single-use gate.
 * - `expiresAt` is stored so expiry can be enforced even after the row
 *   has been read but before it has been consumed.
 */
export class CreateWalletChallenge1773100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "wallet_challenge",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "userId",
            type: "uuid",
          },
          {
            name: "walletAddress",
            type: "varchar",
          },
          {
            name: "network",
            type: "enum",
            enum: ["stellar", "bitcoin"],
          },
          {
            name: "platform",
            type: "varchar",
          },
          {
            name: "platformUserId",
            type: "varchar",
          },
          {
            name: "nonce",
            type: "varchar",
            length: "64",
            isUnique: true,
          },
          {
            name: "domain",
            type: "varchar",
          },
          {
            name: "issuedAt",
            type: "timestamp",
            default: "now()",
          },
          {
            name: "expiresAt",
            type: "timestamp",
          },
          {
            name: "usedAt",
            type: "timestamp",
            isNullable: true,
            default: null,
          },
        ],
      }),
      true // ifNotExists
    );

    // Index for looking up challenges by user + platform (e.g. "has this user
    // recently been issued a challenge for this platform?").
    await queryRunner.createIndex(
      "wallet_challenge",
      new TableIndex({
        name: "IDX_wallet_challenge_userId_platform",
        columnNames: ["userId", "platform"],
      })
    );

    // Index for walletAddress lookups.
    await queryRunner.createIndex(
      "wallet_challenge",
      new TableIndex({
        name: "IDX_wallet_challenge_walletAddress",
        columnNames: ["walletAddress"],
      })
    );

    // Index for nonce lookups (also unique).
    await queryRunner.createIndex(
      "wallet_challenge",
      new TableIndex({
        name: "IDX_wallet_challenge_nonce",
        columnNames: ["nonce"],
        isUnique: true,
      })
    );

    // Index for usedAt so retention / cleanup queries are fast.
    await queryRunner.createIndex(
      "wallet_challenge",
      new TableIndex({
        name: "IDX_wallet_challenge_usedAt",
        columnNames: ["usedAt"],
      })
    );

    // Index for expiresAt so cleanup jobs can efficiently delete expired rows.
    await queryRunner.createIndex(
      "wallet_challenge",
      new TableIndex({
        name: "IDX_wallet_challenge_expiresAt",
        columnNames: ["expiresAt"],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("wallet_challenge", true);
  }
}
