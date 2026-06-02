import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity()
export class Contact {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: true, type: "varchar" })
  @Index()
  name!: string;

  @Column({ type: "varchar" })
  @Index()
  address!: string;

  @Column({ type: "varchar", default: "STRK" })
  tokenType!: string;

  @Column("uuid", { nullable: true })
  @Index()
  userId?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
