/**
 * Security-grade AuditEvent taxonomy and interfaces (Issue #344)
 *
 * Structured event taxonomy aligned with SecOps best practices:
 *   Auth        → authentication / session lifecycle
 *   Admin       → privileged user-management operations
 *   Execution   → trade / transaction execution events
 *   Policy      → access-control / permission decisions
 *   Integration → outbound third-party / cross-service calls
 */

// ─── Event Categories ────────────────────────────────────────────────────────

export enum EventCategory {
  AUTH = "Auth",
  ADMIN = "Admin",
  EXECUTION = "Execution",
  POLICY = "Policy",
  INTEGRATION = "Integration",
}

// ─── Extended Action Taxonomy ────────────────────────────────────────────────

/** Auth category actions */
export enum AuthAction {
  LOGIN_SUCCESS = "auth.login.success",
  LOGIN_FAILED = "auth.login.failed",
  LOGOUT = "auth.logout",
  TOKEN_REFRESH = "auth.token.refresh",
  TOKEN_REVOKED = "auth.token.revoked",
  PASSWORD_RESET_REQUEST = "auth.password.reset_request",
  PASSWORD_RESET_SUCCESS = "auth.password.reset_success",
  PASSWORD_RESET_FAILED = "auth.password.reset_failed",
  EMAIL_VERIFICATION_SENT = "auth.email.verification_sent",
  EMAIL_VERIFICATION_SUCCESS = "auth.email.verification_success",
  MFA_CHALLENGED = "auth.mfa.challenged",
  MFA_SUCCESS = "auth.mfa.success",
  MFA_FAILED = "auth.mfa.failed",
  SESSION_EXPIRED = "auth.session.expired",
}

/** Admin category actions */
export enum AdminAction {
  USER_CREATED = "admin.user.created",
  USER_UPDATED = "admin.user.updated",
  USER_DELETED = "admin.user.deleted",
  USER_SUSPENDED = "admin.user.suspended",
  USER_RESTORED = "admin.user.restored",
  ROLE_ASSIGNED = "admin.role.assigned",
  ROLE_REVOKED = "admin.role.revoked",
  SETTINGS_CHANGED = "admin.settings.changed",
  AUDIT_EXPORTED = "admin.audit.exported",
  AUDIT_PURGED = "admin.audit.purged",
  BOT_COMMAND_START = "admin.bot.command_start",
  BOT_COMMAND_HELP = "admin.bot.command_help",
  BOT_COMMAND_THREAD = "admin.bot.command_thread",
  BOT_COMMAND_SPONSOR = "admin.bot.command_sponsor",
  BOT_COMMAND_TRUSTLINE = "admin.bot.command_trustline",
  BOT_COMMAND_DASHBOARD = "admin.bot.command_dashboard",
  BOT_COMMAND_VALIDATE = "admin.bot.command_validate",
  BOT_COMMAND_BALANCE = "admin.bot.command_balance",
  BOT_COMMAND_SWAP = "admin.bot.command_swap",
}

/** Execution category actions */
export enum ExecutionAction {
  TRADE_INITIATED = "execution.trade.initiated",
  TRADE_CONFIRMED = "execution.trade.confirmed",
  TRADE_FAILED = "execution.trade.failed",
  SWAP_EXECUTED = "execution.swap.executed",
  SWAP_FAILED = "execution.swap.failed",
  TRANSFER_INITIATED = "execution.transfer.initiated",
  TRANSFER_COMPLETED = "execution.transfer.completed",
  TRANSFER_FAILED = "execution.transfer.failed",
  WALLET_FUNDED = "execution.wallet.funded",
  WALLET_DEPLOYED = "execution.wallet.deployed",
  CONTRACT_INVOKED = "execution.contract.invoked",
  CONTRACT_FAILED = "execution.contract.failed",
}

/** Policy category actions */
export enum PolicyAction {
  UNAUTHORIZED_ACCESS = "policy.access.unauthorized",
  PERMISSION_DENIED = "policy.access.permission_denied",
  SUSPICIOUS_ACTIVITY = "policy.threat.suspicious_activity",
  RATE_LIMIT_EXCEEDED = "policy.ratelimit.exceeded",
  IP_BLOCKED = "policy.ip.blocked",
  DATA_EXPORT = "policy.data.export",
  SENSITIVE_DATA_ACCESS = "policy.data.sensitive_access",
  KYC_INITIATED = "policy.kyc.initiated",
  KYC_PASSED = "policy.kyc.passed",
  KYC_FAILED = "policy.kyc.failed",
}

/** Integration category actions */
export enum IntegrationAction {
  WEBHOOK_SENT = "integration.webhook.sent",
  WEBHOOK_FAILED = "integration.webhook.failed",
  WEBHOOK_RECEIVED = "integration.webhook.received",
  HORIZON_CALL = "integration.horizon.call",
  SOROBAN_CALL = "integration.soroban.call",
  EXTERNAL_API_CALL = "integration.external_api.call",
  EXTERNAL_API_FAILED = "integration.external_api.failed",
}

/** Union of all typed action enums */
export type AuditEventAction =
  | AuthAction
  | AdminAction
  | ExecutionAction
  | PolicyAction
  | IntegrationAction;

// ─── Core AuditEvent Interface ───────────────────────────────────────────────

/**
 * Canonical structure for every security-grade audit event.
 *
 * Event = {CorrelationID, Actor, Action, Resource, Status, Metadata}
 */
export interface AuditEvent {
  /** Unique, opaque event identifier (UUID v4) */
  id: string;

  /** Distributed trace identifier that ties one logical request across services */
  correlationId: string;

  /** Canonical action name drawn from the typed taxonomy */
  action: AuditEventAction;

  /** High-level category bucket for the event */
  category: EventCategory;

  /** Severity level of this event */
  severity: AuditEventSeverity;

  /** Authenticated actor performing the action */
  actor: AuditActor;

  /** Resource targeted by the action, if applicable */
  resource?: AuditResource;

  /** Whether the action succeeded */
  success: boolean;

  /** Human-readable description of any failure */
  errorMessage?: string;

  /** Arbitrary key-value bag — will be PII-scrubbed before persistence */
  metadata?: Record<string, unknown>;

  /** ISO-8601 wall-clock timestamp */
  timestamp: string;

  /** SHA-256 hash of previous event — forms tamper-evident chain */
  previousHash?: string;

  /** SHA-256 hash of this event's canonical fields */
  eventHash: string;
}

// ─── Supporting Sub-Types ────────────────────────────────────────────────────

export enum AuditEventSeverity {
  INFO = "info",
  WARNING = "warning",
  ERROR = "error",
  CRITICAL = "critical",
}

/** Who performed the action */
export interface AuditActor {
  /** Authenticated user ID, if known */
  userId?: string;
  /** Service or bot identifier for non-human actors */
  serviceId?: string;
  /** IP address (may be anonymised) */
  ipAddress?: string;
  /** User-Agent string */
  userAgent?: string;
  /** Roles held by the actor at the time of the event */
  roles?: string[];
}

/** What was acted upon */
export interface AuditResource {
  /** HTTP method + path, e.g. "POST /api/trade" */
  endpoint?: string;
  /** Entity type, e.g. "User", "Trade" */
  type?: string;
  /** Entity ID */
  id?: string;
}

// ─── Create-Event Params ─────────────────────────────────────────────────────

export interface CreateAuditEventParams {
  correlationId?: string; // generated if omitted
  action: AuditEventAction;
  category?: EventCategory; // inferred from action prefix if omitted
  severity?: AuditEventSeverity;
  actor?: Partial<AuditActor>;
  resource?: AuditResource;
  success?: boolean;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  previousHash?: string;
}

// ─── Query Params ────────────────────────────────────────────────────────────

export interface AuditEventQuery {
  correlationId?: string;
  userId?: string;
  action?: AuditEventAction;
  category?: EventCategory;
  severity?: AuditEventSeverity;
  success?: boolean;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}
