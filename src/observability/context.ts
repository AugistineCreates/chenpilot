import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";

export const REQUEST_ID_HEADER = "x-request-id";
export const CORRELATION_ID_HEADER = "x-correlation-id";
export const EXECUTION_ID_HEADER = "x-execution-id";
export const ROOT_EXECUTION_ID_HEADER = "x-root-execution-id";
export const PARENT_EXECUTION_ID_HEADER = "x-parent-execution-id";

export interface ObservabilityContext {
  requestId: string;
  executionId: string;
  rootExecutionId: string;
  parentExecutionId?: string;
  userId?: string;
  operationName?: string;
  component?: string;
  queueName?: string;
  jobId?: string;
}

type HeaderValue = string | string[] | undefined;

const storage = new AsyncLocalStorage<ObservabilityContext>();

function firstHeaderValue(value: HeaderValue): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function getObservabilityContext():
  | ObservabilityContext
  | undefined {
  return storage.getStore();
}

export function createObservabilityContext(
  partial: Partial<ObservabilityContext> = {}
): ObservabilityContext {
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
    operationName: partial.operationName,
    component: partial.component,
    queueName: partial.queueName,
    jobId: partial.jobId,
  };
}

export function runWithObservabilityContext<T>(
  context: Partial<ObservabilityContext>,
  callback: () => T
): T {
  const current = getObservabilityContext();
  const nextContext = createObservabilityContext({
    ...current,
    ...context,
    requestId: context.requestId || current?.requestId,
    rootExecutionId: context.rootExecutionId || current?.rootExecutionId,
    parentExecutionId: context.parentExecutionId || current?.parentExecutionId,
  });

  return storage.run(nextContext, callback);
}

export function withChildExecution<T>(
  context: Partial<ObservabilityContext>,
  callback: () => T
): T {
  const current = getObservabilityContext();
  const requestId = context.requestId || current?.requestId || randomUUID();
  const parentExecutionId =
    context.parentExecutionId || current?.executionId || undefined;
  const rootExecutionId =
    context.rootExecutionId ||
    current?.rootExecutionId ||
    parentExecutionId ||
    randomUUID();

  return runWithObservabilityContext(
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

export function updateObservabilityContext(
  updates: Partial<ObservabilityContext>
): void {
  const current = getObservabilityContext();
  if (!current) {
    return;
  }

  Object.assign(current, updates);
}

export function extractObservabilityContextFromHeaders(headers: {
  [key: string]: HeaderValue;
}): Partial<ObservabilityContext> {
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
  context: Partial<ObservabilityContext> = getObservabilityContext() || {}
): Record<string, string> {
  const resolved = createObservabilityContext(context);

  return {
    [REQUEST_ID_HEADER]: resolved.requestId,
    [CORRELATION_ID_HEADER]: resolved.requestId,
    [EXECUTION_ID_HEADER]: resolved.executionId,
    [ROOT_EXECUTION_ID_HEADER]: resolved.rootExecutionId,
    ...(resolved.parentExecutionId
      ? { [PARENT_EXECUTION_ID_HEADER]: resolved.parentExecutionId }
      : {}),
  };
}

export function getObservabilityLogFields(): Record<string, string> {
  const context = getObservabilityContext();
  if (!context) {
    return {};
  }

  const fields: Record<string, string> = {
    requestId: context.requestId,
    executionId: context.executionId,
    rootExecutionId: context.rootExecutionId,
  };

  if (context.parentExecutionId) {
    fields.parentExecutionId = context.parentExecutionId;
  }

  if (context.userId) {
    fields.userId = context.userId;
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

  return fields;
}
