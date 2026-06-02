import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity()
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: true, type: "varchar" })
  @Index()
  name!: string;

  @Column({ type: "varchar", nullable: true, unique: true })
  @Index()
  email?: string;

  @Column({ type: "varchar", nullable: true })
  password?: string;

  @Column({ type: "varchar" })
  @Index()
  address!: string;

  @Column({ type: "boolean", default: false })
  isDeployed!: boolean;

  @Column({ type: "boolean", default: false })
  isFunded!: boolean;

  @Column({ type: "boolean", default: false })
  isEmailVerified!: boolean;

  @Column({ type: "varchar", select: false })
  encryptedPrivateKey!: string;

  @Column({ type: "varchar", default: "XLM" })
  tokenType!: string;

  @Column({ type: "varchar", default: "user" })
  @Index()
  role!: string;

  @Column({ type: "varchar", nullable: true })
  resetTokenHash?: string;

  @Column({ type: "timestamp", nullable: true })
  resetTokenExpiry?: Date;

  @CreateDateColumn()
  @Index()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
