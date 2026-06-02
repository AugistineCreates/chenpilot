export { auditLogService, AuditLogService } from "./auditLog.service";
export type { CreateAuditLogParams, AuditLogQuery } from "./auditLog.service";

export { AuditLog, AuditAction, AuditSeverity } from "./auditLog.entity";

export { auditLogMiddleware, logFailedAuth } from "./auditLog.middleware";

export { default as auditLogRoutes } from "./auditLog.routes";

export {
  // Taxonomy enums
  EventCategory,
  AuthAction,
  AdminAction,
  ExecutionAction,
  PolicyAction,
  IntegrationAction,
  AuditEventSeverity,
} from "./auditEvent.types";
export type {
  AuditEvent,
  AuditActor,
  AuditResource,
  AuditEventAction,
  CreateAuditEventParams,
  AuditEventQuery,
} from "./auditEvent.types";

export {
  // Redaction utilities
  redactPayload,
  scrubString,
  shannonEntropy,
  generateCorrelationId,
  extractCorrelationId,
  // Express middleware
  correlationIdMiddleware,
  piiRedactionMiddleware,
  REDACTED_SENTINEL,
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
} from "./auditLog.redaction";
