import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from "typeorm";

export class AddUserOwnershipToContacts1772500000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      "contact",
      new TableColumn({
        name: "userId",
        type: "uuid",
        isNullable: true,
      })
    );

    await queryRunner.createIndex(
      "contact",
      new TableIndex({
        name: "IDX_contact_userId",
        columnNames: ["userId"],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex("contact", "IDX_contact_userId");
    await queryRunner.dropColumn("contact", "userId");
  }
}
