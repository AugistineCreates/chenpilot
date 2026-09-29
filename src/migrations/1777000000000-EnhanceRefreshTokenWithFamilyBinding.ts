import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from "typeorm";

export class EnhanceRefreshTokenWithFamilyBinding1777000000000
  implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable("refresh_token");
    if (!table) {
      throw new Error("refresh_token table not found");
    }

    // Add token family binding columns
    await queryRunner.addColumn(
      "refresh_token",
      new TableColumn({
        name: "familyId",
        type: "uuid",
        isNullable: false,
        default: "uuid_generate_v4()",
      })
    );

    await queryRunner.addColumn(
      "refresh_token",
      new TableColumn({
        name: "rootTokenId",
        type: "uuid",
        isNullable: true,
      })
    );

    await queryRunner.addColumn(
      "refresh_token",
      new TableColumn({
        name: "parentTokenId",
        type: "uuid",
        isNullable: true,
      })
    );

    // Add device binding columns
    await queryRunner.addColumn(
      "refresh_token",
      new TableColumn({
        name: "deviceId",
        type: "varchar",
        isNullable: true,
      })
    );

    await queryRunner.addColumn(
      "refresh_token",
      new TableColumn({
        name: "deviceName",
        type: "varchar",
        isNullable: true,
      })
    );

    await queryRunner.addColumn(
      "refresh_token",
      new TableColumn({
        name: "ipAddressHash",
        type: "varchar",
        isNullable: true,
      })
    );

    // Add risk signal columns
    await queryRunner.addColumn(
      "refresh_token",
      new TableColumn({
        name: "riskSignal",
        type: "enum",
        enum: ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"],
        default: "'NONE'",
      })
    );

    await queryRunner.addColumn(
      "refresh_token",
      new TableColumn({
        name: "riskReason",
        type: "text",
        isNullable: true,
      })
    );

    // Add tracking columns
    await queryRunner.addColumn(
      "refresh_token",
      new TableColumn({
        name: "lastUsedAt",
        type: "timestamp",
        isNullable: true,
      })
    );

    await queryRunner.addColumn(
      "refresh_token",
      new TableColumn({
        name: "rotationReason",
        type: "enum",
        enum: [
          "NORMAL",
          "RISK_DETECTED",
          "MANUAL_LOGOUT",
          "SECURITY_INCIDENT",
          "DEVICE_CHANGE",
        ],
        default: "'NORMAL'",
      })
    );

    await queryRunner.addColumn(
      "refresh_token",
      new TableColumn({
        name: "reuseDetected",
        type: "boolean",
        default: false,
      })
    );

    await queryRunner.addColumn(
      "refresh_token",
      new TableColumn({
        name: "sessionId",
        type: "uuid",
        isNullable: true,
      })
    );

    // Add updatedAt column if missing
    const updatedAtColumn = table.columns.find((col) => col.name === "updatedAt");
    if (!updatedAtColumn) {
      await queryRunner.addColumn(
        "refresh_token",
        new TableColumn({
          name: "updatedAt",
          type: "timestamp",
          default: "CURRENT_TIMESTAMP",
          onUpdate: "CURRENT_TIMESTAMP",
        })
      );
    }

    // Add indexes for new columns
    await queryRunner.createIndex(
      "refresh_token",
      new TableIndex({
        name: "idx_refresh_token_familyId",
        columnNames: ["familyId"],
      })
    );

    await queryRunner.createIndex(
      "refresh_token",
      new TableIndex({
        name: "idx_refresh_token_deviceId",
        columnNames: ["deviceId"],
      })
    );

    await queryRunner.createIndex(
      "refresh_token",
      new TableIndex({
        name: "idx_refresh_token_reuseDetected",
        columnNames: ["reuseDetected"],
      })
    );

    await queryRunner.createIndex(
      "refresh_token",
      new TableIndex({
        name: "idx_refresh_token_sessionId",
        columnNames: ["sessionId"],
      })
    );

    // Composite index for efficient family lookups
    await queryRunner.createIndex(
      "refresh_token",
      new TableIndex({
        name: "idx_refresh_token_family_revoke",
        columnNames: ["familyId", "userId", "isRevoked"],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.dropIndex(
      "refresh_token",
      "idx_refresh_token_family_revoke"
    );
    await queryRunner.dropIndex("refresh_token", "idx_refresh_token_sessionId");
    await queryRunner.dropIndex(
      "refresh_token",
      "idx_refresh_token_reuseDetected"
    );
    await queryRunner.dropIndex("refresh_token", "idx_refresh_token_deviceId");
    await queryRunner.dropIndex("refresh_token", "idx_refresh_token_familyId");

    // Drop columns
    const table = await queryRunner.getTable("refresh_token");
    if (table) {
      await queryRunner.dropColumn("refresh_token", "sessionId");
      await queryRunner.dropColumn("refresh_token", "reuseDetected");
      await queryRunner.dropColumn("refresh_token", "rotationReason");
      await queryRunner.dropColumn("refresh_token", "lastUsedAt");
      await queryRunner.dropColumn("refresh_token", "riskReason");
      await queryRunner.dropColumn("refresh_token", "riskSignal");
      await queryRunner.dropColumn("refresh_token", "ipAddressHash");
      await queryRunner.dropColumn("refresh_token", "deviceName");
      await queryRunner.dropColumn("refresh_token", "deviceId");
      await queryRunner.dropColumn("refresh_token", "parentTokenId");
      await queryRunner.dropColumn("refresh_token", "rootTokenId");
      await queryRunner.dropColumn("refresh_token", "familyId");

      const updatedAtColumn = table.columns.find((col) => col.name === "updatedAt");
      if (updatedAtColumn) {
        await queryRunner.dropColumn("refresh_token", "updatedAt");
      }
    }
  }
}
