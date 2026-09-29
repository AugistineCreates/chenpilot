# Transaction user-journey SLIs, SLOs, and runbook

## Scope

HTTP availability is a component signal, not a user outcome. The production
SLO for a transaction is measured from the first accepted request through a
confirmed result:

`simulate -> approve -> submit -> confirm`

Each journey has a `journey_id` and a stable `execution_id`/`root_execution_id`
from the observability context. Emit one terminal
`transaction_journey_complete` event for every accepted journey, even when the
result is a failure or is unknown. The event must include:

```text
journey_id, execution_id, operation, network, dependency, failure_class,
outcome, duration_ms, retry_count, idempotency_key, tx_hash, confirmation_age_ms
```

Do not put account identifiers, private keys, or transaction payloads in metric
labels. Use logs and audit records for high-cardinality investigation.

## SLIs and error budgets

The denominator is journeys accepted by the application, not health checks.
Cancelled journeys are excluded only when cancellation is explicit before
submission. A timeout, missing terminal event, contradictory provider response,
or a submitted transaction whose final state cannot be established is a failed
journey. Retrying a submission without proving that the prior request was not
accepted is an **unsafe retry** and is a failure even if a later attempt
succeeds.

| SLI                               | Good event                                                                                                                                                        | Target / monthly error budget | Latency objective                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `transaction_journey_correctness` | The final confirmed state matches the approved simulation (operation, assets, amounts, slippage, authorization, and network) and has exactly one terminal outcome |                  99.5% / 0.5% | N/A                                                                                                                                          |
| `transaction_journey_completion`  | A journey reaches a user-visible confirmed success or an explicit, actionable rejection; no ambiguous outcome                                                     |                  99.0% / 1.0% | N/A                                                                                                                                          |
| `transaction_journey_latency`     | A correct, non-ambiguous journey reaches confirmation within the class objective                                                                                  |                  99.0% / 1.0% | `simulate` p95 <= 2 s; `approve` p95 <= 30 s after the approval request; `submit` p95 <= 5 s; `confirm` p95 <= 90 s; end-to-end p95 <= 120 s |

Compute the correctness and completion ratios separately for each
`operation`, `network`, `dependency`, and `failure_class`. A journey is good
for the latency SLI only if it is correct and unambiguous; do not hide slow
failures by measuring successful HTTP responses only.

### Dependency and failure-class partitions

The following partitions are required on dashboards and error-budget alerts:

| Partition     | Values                                                                                                                                                | Failure examples                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Dependency    | `gateway`, `simulation_rpc`, `wallet_or_approver`, `database`, `idempotency_store`, `submission_rpc`, `indexer_or_horizon`, `chain`                   | timeout, unavailable, malformed response, stale data                                     |
| Failure class | `validation`, `authorization`, `simulation`, `approval`, `submission`, `confirmation`, `consistency`, `ambiguous_outcome`, `unsafe_retry`, `internal` | rejected policy, missing auth, simulation mismatch, provider disagreement, lost callback |
| Outcome       | `confirmed_success`, `explicit_rejection`, `confirmed_failure`, `ambiguous`, `timeout`                                                                | `ambiguous` and `timeout` always consume budget                                          |

Keep a separate error budget for each dependency and failure class. A healthy
aggregate must not mask a broken confirmation path or a concentration of
ambiguous outcomes. `ambiguous_outcome` and `unsafe_retry` are always bad
events, regardless of the HTTP status code.

## Instrumentation contract

Export these low-cardinality metrics from the journey instrumentation:

```text
tx_journey_total{operation,network,stage,dependency,failure_class,outcome}
tx_journey_duration_seconds_bucket{operation,network,stage,outcome}
tx_journey_ambiguous_total{operation,network,dependency,reason}
tx_journey_unsafe_retry_total{operation,network,dependency,reason}
tx_journey_in_flight{operation,network,stage}
```

Start the timer at the first accepted journey request and stop it only when
confirmation is verified or an explicit rejection is recorded. Carry the same
journey and execution IDs through `src/observability/context.ts`,
`src/observability/trace.ts`, audit events, idempotency records, RPC calls, and
the confirmation poller. A missing terminal event is detected by a sweeper
after the stage deadline and recorded as `ambiguous_outcome`; it must not be
silently dropped.

Correctness checks must compare the submitted transaction and confirmation
against the immutable approved intent and simulation snapshot. A provider
response that cannot be reconciled by transaction hash and network is
`ambiguous_outcome`, not success and not a permission to retry.

## Burn-rate alerts

Use the same SLO recording rules for each required partition. Let
`bad_ratio` be bad journey events divided by all accepted journey events.
Alert on multi-window burn rates, not a single status-code threshold:

```promql
# Fast burn: 14.4x budget in 5m and 1h (page)
(
  sum(rate(tx_journey_bad_total[5m])) /
  sum(rate(tx_journey_total[5m]))
) > (14.4 * 0.01)
and
(
  sum(rate(tx_journey_bad_total[1h])) /
  sum(rate(tx_journey_total[1h]))
) > (14.4 * 0.01)

# Slow burn: 3x budget in 30m and 6h (ticket / daytime page)
(
  sum(rate(tx_journey_bad_total[30m])) /
  sum(rate(tx_journey_total[30m]))
) > (3 * 0.01)
and
(
  sum(rate(tx_journey_bad_total[6h])) /
  sum(rate(tx_journey_total[6h]))
) > (3 * 0.01)
```

`tx_journey_bad_total` is a recording rule that includes incorrect,
incomplete, late, ambiguous, and unsafe-retry journeys. Apply
`operation`, `network`, `dependency`, and `failure_class` matchers to create
partition alerts. Suppress a partition alert only when its denominator is
below the agreed minimum sample volume; continue alerting on
`tx_journey_ambiguous_total` and `tx_journey_unsafe_retry_total` when traffic
is low. Add a distinct confirmation-latency alert using the 5m/1h and 30m/6h
windows against the stage latency objectives.

## Runbook

### 1. Triage and classify

Use `journey_id`, `execution_id`, `idempotency_key`, and (when known) `tx_hash`
to correlate the trace, application JSON logs, audit record, durable
operation, RPC response, and chain/indexer record. Never ask the user to retry
until the submission state is established.

Diagnostic queries (adapt field names to the log backend):

```text
{service="chenpilot"} | json | journey_id="<id>"
{service="chenpilot"} | json | execution_id="<id>" | line_format "{{.stage}} {{.outcome}} {{.error}}"
{service="chenpilot"} | json | tx_hash="<hash>" | line_format "{{.dependency}} {{.provider_status}} {{.ledger}}"
```

For the application database, the equivalent read-only checks are:

```sql
SELECT id, category, idempotentKey, status, retries, errorMessage, updatedAt
FROM durable_operation
WHERE idempotentKey = :idempotency_key
ORDER BY updatedAt DESC;

SELECT action, severity, correlationId, metadata, createdAt
FROM audit_log
WHERE correlationId = :execution_id
ORDER BY createdAt;
```

### 2. Safe mitigations by failure class

| Alert classification                  | Safe first action                                                                                                                             | Do not do                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `simulation` / `validation`           | Stop the journey, preserve the simulation and approved intent, and inspect RPC health and schema/fee changes                                  | Bypass simulation or reuse a stale transaction                                   |
| `authorization` / `approval`          | Re-present the exact approval checkpoint; invalidate it if the simulation or intent changed                                                   | Reuse an old signature or silently alter the approved operation                  |
| `submission` / `idempotency_store`    | Quiesce retries, verify the idempotency record and query the submission provider by hash/key, then replay only through the idempotent service | Submit the same intent with a new key or manually delete an idempotency record   |
| `confirmation` / `indexer_or_horizon` | Poll the authoritative chain/RPC by transaction hash, compare network and ledger, and extend observation within the confirmation deadline     | Retry a possibly accepted submission or declare failure from an indexer timeout  |
| `ambiguous_outcome` / `unsafe_retry`  | Freeze automatic retries, mark the journey unknown, reconcile provider and chain evidence, and escalate to the on-call owner                  | Tell the user to retry, release a transaction lock, or count HTTP 200 as success |
| `chain` / `database` / `internal`     | Reduce traffic or pause affected operations, preserve traces and audit data, and fail closed for state-changing requests                      | Fail open, discard the approved intent, or claim confirmation without evidence   |

When a dependency-specific budget is exhausted, route remediation to that
dependency owner while protecting the end-to-end budget. Resuming traffic
requires evidence that new journeys produce a single terminal outcome and that
the ambiguous/unsafe-retry counters have returned to baseline.

Related operational guidance: [`docs/RUNBOOK_LOCKS.md`](./RUNBOOK_LOCKS.md)
for safe trade-lock inspection and release, and
[`src/OBSERVABILITY_PLATFORM.md`](../src/OBSERVABILITY_PLATFORM.md) for trace,
audit, and idempotency integration points.
