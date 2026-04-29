import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

export enum AuditAction {
  // Authentication actions
  LOGIN_SUCCESS = "login_success",
  LOGIN_FAILED = "login_failed",
  LOGOUT = "logout",
  TOKEN_REFRESH = "token_refresh",
  PASSWORD_RESET_REQUEST = "password_reset_request",
  PASSWORD_RESET_SUCCESS = "password_reset_success",
  PASSWORD_RESET_FAILED = "password_reset_failed",
  EMAIL_VERIFICATION_SENT = "email_verification_sent",
  EMAIL_VERIFICATION_SUCCESS = "email_verification_success",

  // User management
  USER_CREATED = "user_created",
  USER_UPDATED = "user_updated",
  USER_DELETED = "user_deleted",

  // Trading/Transaction actions
  TRADE_INITIATED = "trade_initiated",
  TRADE_CONFIRMED = "trade_confirmed",
  TRADE_FAILED = "trade_failed",
  SWAP_EXECUTED = "swap_executed",
  TRANSFER_INITIATED = "transfer_initiated",
  TRANSFER_COMPLETED = "transfer_completed",

  // Wallet actions
  WALLET_FUNDED = "wallet_funded",
  WALLET_DEPLOYED = "wallet_deployed",

  // Security events
  UNAUTHORIZED_ACCESS = "unauthorized_access",
  PERMISSION_DENIED = "permission_denied",
  SUSPICIOUS_ACTIVITY = "suspicious_activity",

  // Data access
  DATA_EXPORT = "data_export",
  SENSITIVE_DATA_ACCESS = "sensitive_data_access",

  // Bot commands
  BOT_COMMAND_START = "bot_command_start",
  BOT_COMMAND_HELP = "bot_command_help",
  BOT_COMMAND_THREAD = "bot_command_thread",
  BOT_COMMAND_SPONSOR = "bot_command_sponsor",
  BOT_COMMAND_TRUSTLINE = "bot_command_trustline",
  BOT_COMMAND_DASHBOARD = "bot_command_dashboard",
  BOT_COMMAND_VALIDATE = "bot_command_validate",
  BOT_COMMAND_BALANCE = "bot_command_balance",
  BOT_COMMAND_SWAP = "bot_command_swap",
}

export enum AuditSeverity {
  INFO = "info",
  WARNING = "warning",
  ERROR = "error",
  CRITICAL = "critical",
}

@Entity()
@Index(["userId", "createdAt"])
@Index(["action", "createdAt"])
@Index(["severity", "createdAt"])
export class AuditLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", nullable: true })
  @Index()
  userId?: string;

  @Column({ type: "varchar" })
  action!: AuditAction;

  @Column({ type: "varchar", default: AuditSeverity.INFO })
  severity!: AuditSeverity;

  @Column({ type: "varchar", nullable: true })
  ipAddress?: string;

  @Column({ type: "varchar", nullable: true })
  userAgent?: string;

  @Column({ type: "varchar", nullable: true })
  resource?: string;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown>;

  @Column({ type: "text", nullable: true })
  errorMessage?: string;

  @Column({ type: "boolean", default: true })
  success!: boolean;

  @CreateDateColumn()
  @Index()
  createdAt!: Date;
}
