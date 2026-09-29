# Backend Observability & Reliability Platform

Unified backend platform for traceable execution, audit-grade event logging, durable idempotency, and signed event ingestion.

## Architecture

### 1. Observability Context (`src/observability/`)

- `context.ts` — AsyncLocalStorage-based correlation context
  - Headers: `x-request-id`, `x-correlation-id`, `x-execution-id`, `x-root-execution-id`, `x-parent-execution-id`
  - Helpers: `runWithObservabilityContext`, `withChildExecution`, `getObservabilityLogFields`
- `trace.ts` — Span/trace model for end-to-end diagnosability
  - `startSpan(kind, name)`, `endSpan(span, error)`, `getTrace(traceId)`, `buildOutboundHeaders()`
- `http.ts` — Express middleware + `withTrace()` wrapper

### 2. Security-Grade Audit Logging (`src/AuditLog/`)

- Event taxonomy: Auth, Admin, Execution, Policy, Integration
- Typed actions: `AuthAction`, `AdminAction`, `ExecutionAction`, `PolicyAction`, `IntegrationAction`
- Tamper-evident hash chain (SHA-256 over canonical fields)
- PII redaction via regex + Shannon entropy analysis
- SecOps query API: `getByCorrelationId`, `getByCategory`, `verifyChainIntegrity`

### 3. Idempotency Framework (`src/Reliability/IdempotencyService.ts`)

- Unified replacement for webhook-specific + durable operation idempotency
- Webhook/ingestion path: `isDuplicate`, `markProcessed`, `ingestSignedEvent`
- Async workflow path: `execute`, `schedule`, `replay`, `recoverInterruptedExecutions`
- Durable execution with exponential backoff and background processor
- Operator-assisted replay and recovery

### 4. Signed-Event Ingestion Platform (`src/Gateway/signedEventIngestion.service.ts`)

- Generalised webhook/event ingestion across providers
- Provider configs: Stellar (HMAC), Telegram, Discord; extensible
- Signature verification, replay-window protection, durable deduplication
- Audit logging per ingestion event
- Pluggable event handlers

## Integration Points

- HTTP: `src/Gateway/api.ts` + `src/Gateway/routes.ts`
- Logger: `src/config/logger.ts` auto-injects observability fields
- Server bootstrap: `src/index.ts` starts `idempotencyService` background processor

## Usage Examples

### Trace a tool call

```ts
import { withTrace } from "../observability";

const result = await withTrace({ kind: "tool", name: "swap" }, async () => {
  return swapTool.execute(payload);
});
```

### Ingest a signed webhook

```ts
import { signedEventIngestionService } from "../Gateway/signedEventIngestion.service";

const envelope = await signedEventIngestionService.ingest({
  source: "stellar",
  eventId: payload.id,
  req,
  payload,
  signature: req.headers["x-stellar-signature"],
  timestampHeaderValue: req.headers["x-stellar-timestamp"],
  handlerKey: "stellar.funding",
});
```

### Execute idempotent async workflow

```ts
import { idempotencyService } from "../Reliability/IdempotencyService";

const result = await idempotencyService.execute({
  category: "deployment",
  idempotentKey: `deploy:${userId}`,
  payload: { userId },
});
```

## Migration Notes

- `src/Gateway/webhook.service.ts` — legacy Stellar webhook handler
- `src/Gateway/webhookIdempotency.service.ts` — legacy webhook dedup
- `src/Reliability/DurableOperationService.ts` — legacy durable operations
- Prefer `SignedEventIngestionService` + `IdempotencyService` for new code.

## User-Journey SLOs

Transaction reliability is measured across the complete
`simulate -> approve -> submit -> confirm` journey, rather than from HTTP
status codes alone. The required event fields, correctness and latency
objectives, dependency/failure-class budgets, burn-rate alerts, diagnostic
queries, and safe mitigations are defined in
[`docs/TRANSACTION_JOURNEY_SLO.md`](../docs/TRANSACTION_JOURNEY_SLO.md).
