import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./user.entity";

export enum BotPlatform {
  TELEGRAM = "telegram",
  DISCORD = "discord",
}

@Entity()
@Index(["userId", "platform"])
@Index(["platform", "platformUserId"], { unique: true })
export class BotIdentity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  userId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ type: "enum", enum: BotPlatform })
  platform!: BotPlatform;

  @Column({ type: "varchar", unique: true })
  @Index()
  platformUserId!: string;

  @Column({ type: "varchar", nullable: true })
  platformUsername?: string;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown>;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  @Column({ type: "timestamp", nullable: true })
  lastLinkedAt?: Date;

  @Column({ type: "timestamp", nullable: true })
  lastUsedAt?: Date;

  @CreateDateColumn()
  @Index()
  createdAt!: Date;

  @UpdateDateColumn()
  @Index()
  updatedAt!: Date;
}
