import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";

export const REQUEST_ID_HEADER = "x-request-id";
export const CORRELATION_ID_HEADER = "x-correlation-id";
export const EXECUTION_ID_HEADER = "x-execution-id";
export const ROOT_EXECUTION_ID_HEADER = "x-root-execution-id";
export const PARENT_EXECUTION_ID_HEADER = "x-parent-execution-id";

export type Transport = "http" | "websocket" | "queue" | "bot";

export interface ExecutionContext {
  requestId: string;
  executionId: string;
  rootExecutionId: string;
  parentExecutionId?: string;
  userId?: string;
  roles?: string[];
  transport: Transport;
  path?: string;
  method?: string;
  ip?: string;
  userAgent?: string;
  queueName?: string;
  jobId?: string;
  messageId?: string;
  chatId?: string;
  operationName?: string;
  component?: string;
  metadata?: Record<string, unknown>;
  /**
   * Workload identity fields — populated by the workload identity middleware
   * for internal service-to-service calls.  These are propagated into audit
   * log actor.serviceId so that every event records which internal service
   * initiated the request.
   */
  /** ServiceId of the authenticated internal service caller */
  workloadServiceId?: string;
  /** Deployment environment asserted by the workload token */
  workloadEnvironment?: string;
  /** Unique jti of the workload token (for correlation across service boundaries) */
  workloadJti?: string;
}

export type ObservabilityContext = ExecutionContext;

type HeaderValue = string | string[] | undefined;

const storage = new AsyncLocalStorage<ExecutionContext>();

function firstHeaderValue(value: HeaderValue): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function getExecutionContext(): ExecutionContext | undefined {
  return storage.getStore();
}

export function createExecutionContext(
  partial: Partial<ExecutionContext> = {}
): ExecutionContext {
  const requestId = partial.requestId || randomUUID();
  const executionId = partial.executionId || randomUUID();
  const rootExecutionId =
    partial.rootExecutionId || partial.parentExecutionId || executionId;

  return {
    requestId,
    executionId,
    rootExecutionId,
    parentExecutionId: partial.parentExecutionId,
    userId: partial.userId,
    roles: partial.roles,
    transport: partial.transport || "http",
    path: partial.path,
    method: partial.method,
    ip: partial.ip,
    userAgent: partial.userAgent,
    queueName: partial.queueName,
    jobId: partial.jobId,
    messageId: partial.messageId,
    chatId: partial.chatId,
    operationName: partial.operationName,
    component: partial.component,
    metadata: partial.metadata,
  };
}

export function runWithExecutionContext<T>(
  context: Partial<ExecutionContext>,
  callback: () => T
): T {
  const current = getExecutionContext();
  const nextContext = createExecutionContext({
    ...current,
    ...context,
    requestId: context.requestId || current?.requestId,
    rootExecutionId: context.rootExecutionId || current?.rootExecutionId,
    parentExecutionId: context.parentExecutionId || current?.parentExecutionId,
  });

  return storage.run(nextContext, callback);
}

export function withChildExecution<T>(
  context: Partial<ExecutionContext>,
  callback: () => T
): T {
  const current = getExecutionContext();
  const requestId = context.requestId || current?.requestId || randomUUID();
  const parentExecutionId =
    context.parentExecutionId || current?.executionId || undefined;
  const rootExecutionId =
    context.rootExecutionId ||
    current?.rootExecutionId ||
    parentExecutionId ||
    randomUUID();

  return runWithExecutionContext(
    {
      ...current,
      ...context,
      requestId,
      executionId: context.executionId || randomUUID(),
      rootExecutionId,
      parentExecutionId,
    },
    callback
  );
}

export function updateExecutionContext(
  updates: Partial<ExecutionContext>
): void {
  const current = getExecutionContext();
  if (!current) {
    return;
  }

  Object.assign(current, updates);
}

export function extractContextFromHeaders(headers: {
  [key: string]: HeaderValue;
}): Partial<ExecutionContext> {
  const requestId =
    firstHeaderValue(headers[REQUEST_ID_HEADER]) ||
    firstHeaderValue(headers[CORRELATION_ID_HEADER]);
  const executionId = firstHeaderValue(headers[EXECUTION_ID_HEADER]);
  const rootExecutionId = firstHeaderValue(headers[ROOT_EXECUTION_ID_HEADER]);
  const parentExecutionId = firstHeaderValue(
    headers[PARENT_EXECUTION_ID_HEADER]
  );

  return {
    requestId,
    executionId,
    rootExecutionId,
    parentExecutionId,
  };
}

export function buildCorrelationHeaders(
  context: Partial<ExecutionContext> = getExecutionContext() || {}
): Record<string, string> {
  const resolved = createExecutionContext(context);

  return {
    [REQUEST_ID_HEADER]: resolved.requestId,
    [CORRELATION_ID_HEADER]: resolved.requestId,
    [EXECUTION_ID_HEADER]: resolved.executionId,
    [ROOT_EXECUTION_ID_HEADER]: resolved.rootExecutionId,
    ...(resolved.parentExecutionId
      ? { [PARENT_EXECUTION_ID_HEADER]: resolved.parentExecutionId }
      : {}),
    ...(resolved.workloadServiceId
      ? { "x-workload-service": resolved.workloadServiceId }
      : {}),
  };
}

export function getLogFields(): Record<string, string> {
  const context = getExecutionContext();
  if (!context) {
    return {};
  }

  const fields: Record<string, string> = {
    requestId: context.requestId,
    executionId: context.executionId,
    rootExecutionId: context.rootExecutionId,
    transport: context.transport,
  };

  if (context.parentExecutionId) {
    fields.parentExecutionId = context.parentExecutionId;
  }
  if (context.userId) {
    fields.userId = context.userId;
  }
  if (context.roles && context.roles.length > 0) {
    fields.roles = context.roles.join(",");
  }
  if (context.operationName) {
    fields.operationName = context.operationName;
  }
  if (context.component) {
    fields.component = context.component;
  }
  if (context.queueName) {
    fields.queueName = context.queueName;
  }
  if (context.jobId) {
    fields.jobId = context.jobId;
  }
  if (context.messageId) {
    fields.messageId = context.messageId;
  }
  if (context.chatId) {
    fields.chatId = context.chatId;
  }
  if (context.path) {
    fields.path = context.path;
  }
  if (context.method) {
    fields.method = context.method;
  }
  if (context.ip) {
    fields.ip = context.ip;
  }
  if (context.workloadServiceId) {
    fields.workloadServiceId = context.workloadServiceId;
  }
  if (context.workloadEnvironment) {
    fields.workloadEnvironment = context.workloadEnvironment;
  }
  if (context.workloadJti) {
    fields.workloadJti = context.workloadJti;
  }

  return fields;
}

export const getObservabilityContext = getExecutionContext;
export const createObservabilityContext = createExecutionContext;
export const runWithObservabilityContext = runWithExecutionContext;
export const updateObservabilityContext = updateExecutionContext;
export const extractObservabilityContextFromHeaders = extractContextFromHeaders;
export const getObservabilityLogFields = getLogFields;
