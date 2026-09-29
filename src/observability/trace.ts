import { getExecutionContext, ExecutionContext } from "./context";

/**
 * trace.ts — execution correlation helpers for end-to-end diagnosability
 *
 * Provides typed helpers to:
 *   - snapshot the current AsyncLocalStorage observability context
 *   - attach a "component" hint (http / tool / queue / llm / blockchain)
 *   - register spans/events in an in-memory trace map
 *   - build headers for outbound HTTP calls that preserve trace correlation
 */

type SpanKind = "http" | "tool" | "queue" | "llm" | "blockchain" | "custom";

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  kind: SpanKind;
  name: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: "ok" | "error";
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

const activeTraces = new Map<string, TraceSpan[]>();
const COUNTER = { value: 0 };

function nextId(): string {
  COUNTER.value += 1;
  return `${Date.now().toString(36)}-${COUNTER.value.toString(36)}`;
}

export function getTraceId(context?: ExecutionContext): string {
  return context?.rootExecutionId || getExecutionContext()?.rootExecutionId || nextId();
}

export function startSpan(options: {
  kind: SpanKind;
  name: string;
  parentSpanId?: string;
  metadata?: Record<string, unknown>;
}): TraceSpan {
  const context = getExecutionContext();
  const span: TraceSpan = {
    traceId: getTraceId(context),
    spanId: nextId(),
    parentSpanId: options.parentSpanId,
    kind: options.kind,
    name: options.name,
    startTime: Date.now(),
    status: "ok",
    metadata: options.metadata,
  };

  const list = activeTraces.get(span.traceId) || [];
  list.push(span);
  activeTraces.set(span.traceId, list);

  return span;
}

export function endSpan(span: TraceSpan, error?: unknown): void {
  span.endTime = Date.now();
  span.durationMs = span.endTime - span.startTime;
  span.status = error ? "error" : "ok";
  span.errorMessage = error instanceof Error ? error.message : error ? String(error) : undefined;
}

export function getTrace(traceId: string): TraceSpan[] {
  return activeTraces.get(traceId) || [];
}

export function buildOutboundHeaders(context?: ExecutionContext): Record<string, string> {
  const resolved = context || getExecutionContext();
  if (!resolved) {
    return {};
  }

  return {
    "x-request-id": resolved.requestId,
    "x-correlation-id": resolved.requestId,
    "x-execution-id": resolved.executionId,
    "x-root-execution-id": resolved.rootExecutionId,
    ...(resolved.parentExecutionId
      ? { "x-parent-execution-id": resolved.parentExecutionId }
      : {}),
  };
}