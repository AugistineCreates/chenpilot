# Production Runbook: Stuck or Failed Trade Locks

## Purpose

Use this runbook when a user cannot trade because the application reports:

> An active trade execution is already in progress

The trade lock resource is `trade:{userId}`. Redis stores the lock under the key `lock:trade:{userId}`.

This procedure is for production operators and incident responders. It is intentionally separate from developer-facing lock documentation.

## Safety requirements

- Only an authorized operator may inspect or release a production lock.
- A lock must not be released solely because a user reports that no trade is running.
- Do not release a lock until the execution state has been checked across all relevant application logs, workers, and trade records.
- A live trade may still be waiting on a blockchain transaction, exchange/provider response, database operation, or retry. Treat an unknown state as **in progress**.
- Prefer waiting for the lock TTL to expire when the trade state cannot be established safely.
- Never use `DEL` directly from an interactive Redis shell as a first response. The application service provides the intended operational methods and logging.
- If workers are still processing trades, quiesce or pause trade execution before a forced release. This prevents a running worker from continuing after its lock has been removed.

## 1. Confirm the incident

1. Record the following in the incident ticket:
   - User ID
   - Time of the failed trade attempt, including timezone
   - Exact error message
   - Environment and region
   - Incident/request ID, if available
2. Confirm that the affected user ID is valid and normalized exactly as used by the trade service. Do not guess, trim, or substitute an account identifier.
3. Check whether the user has an active trade in the application’s trade records and whether a recent trade has an unresolved status.
4. Check application and worker logs for the user ID and the resource `trade:{userId}`. Look for acquisition, renewal, release, timeout, provider, transaction, and crash events.
5. Check the relevant blockchain/provider status before taking any recovery action. A submitted transaction with an unknown result must be treated as potentially active.

If an execution is active or its final outcome is unknown, stop here and escalate to the on-call engineer. Do not release the lock.

## 2. Quiesce trade execution before intervention

Before a forced release:

1. Notify the incident channel and identify the operator performing the action.
2. Pause or drain the trade worker(s) that can process the affected user, using the approved deployment or operations procedure for the environment.
3. Verify that no trade execution is currently running for the user and that no queued retry is about to start.
4. Keep the user’s new trade requests blocked until the lock has been verified and the worker state is stable.

If execution cannot be quiesced, do not use `forceReleaseLock`. Wait for the TTL or escalate.

## 3. Inspect the lock with `getLockInfo`

Use an approved application maintenance shell or operational diagnostic environment connected to the production Redis instance. Do not print Redis credentials or copy them into the incident ticket.

The lock service API takes the resource key without the `lock:` prefix:

```ts
const resourceKey = `trade:${userId}`;
const lockInfo = await lockService.getLockInfo(resourceKey);
```

`getLockInfo(resourceKey)` returns either `null` or lock metadata containing:

- `key`: the Redis key, expected to be `lock:trade:{userId}`
- `value`: the lock value
- `ownerId`: the lock owner identifier
- `ttl`: remaining lifetime in seconds
- `createdAt`: the recorded creation timestamp

Record the inspection time, resource key, owner ID, TTL, and whether the lock was present. Avoid posting the complete lock value in broadly accessible channels.

Interpret the result as follows:

- **`null`**: no lock exists. Recheck application state and retry the user’s operation only after confirming that no stale worker or queued execution remains.
- **Lock present with positive TTL**: continue with the guardrails below. A positive TTL does not prove that the trade is stale.
- **TTL near expiration**: normally wait for expiry and recheck rather than forcing release.
- **Unexpected resource key or owner ID**: stop and escalate. Do not release it based on an assumption about ownership.
- **Inspection error or Redis connectivity problem**: stop. Do not perform a release using a different Redis endpoint or an unverified environment.

For an additional read-only check, an operator may confirm the key and remaining TTL with the approved Redis tooling:

```text
GET lock:trade:{userId}
TTL lock:trade:{userId}
```

The Redis result must correspond to the `getLockInfo` result and the production environment being investigated.

## 4. Guardrails before releasing

A forced release is allowed only when **all** of the following are true:

- The user’s trade records show no execution in progress and no unresolved submitted transaction.
- Logs show no active worker, renewal, retry, or provider operation for the user.
- The worker(s) capable of processing this user are paused or drained.
- The lock inspection was performed immediately before the release.
- The lock has a positive TTL and is confirmed to be the stale lock being investigated.
- The incident responder has approval from the production on-call owner.

Do not release the lock when any condition is false. In particular, do not release it when:

- A transaction hash exists but its outcome is not confirmed.
- A worker heartbeat, renewal, or retry is still being observed.
- The lock owner cannot be correlated with a failed or terminated execution.
- Another operator or automation is already recovering the same incident.
- Redis is degraded, failover is in progress, or the inspected instance may not be the active production instance.

## 5. Perform a controlled manual release

After all guardrails pass, use the application lock service’s `forceReleaseLock` method from the approved maintenance environment. Do not delete the Redis key directly.

Pass the same resource key used for inspection:

```ts
const resourceKey = `trade:${userId}`;
const result = await lockService.forceReleaseLock(resourceKey);
```

Before invoking the method, perform one final `getLockInfo(resourceKey)` check. If it returns `null`, the lock has already expired or been released; do not continue. If the owner, key, or TTL differs from the previously approved inspection, stop and revalidate the incident. This protects against releasing a newly acquired lock after the original stale lock expired.

The release must be executed once, by the named operator, and the result must be recorded in the incident ticket. Record the execution time, resource key, operator, approval, prior owner ID, prior TTL, and the method result. Do not record the complete lock value or production credentials.

If `forceReleaseLock` fails or reports that the lock changed, do not retry blindly. Reinspect the lock and escalate to the on-call engineer.

## 6. Verify recovery

1. Confirm with `getLockInfo(resourceKey)` that the lock is absent, or that a new lock belongs to the expected newly started execution.
2. Resume or unpause workers only through the approved operations procedure.
3. Keep monitoring logs, trade records, provider responses, and lock acquisition/release events for the affected user.
4. Do not ask the user to retry until workers are stable and the application state confirms that no previous trade remains unresolved.
5. If the lock reappears unexpectedly, a trade remains unresolved, or a worker begins processing an old request, stop retries and escalate.

Document the root cause, the evidence that the lock was stale, the release result, and any follow-up work needed to prevent recurrence.

## Escalation

Escalate immediately to the production on-call engineer when the execution state is unknown, a provider or blockchain transaction is unresolved, the lock owner cannot be identified, Redis is unhealthy, workers cannot be quiesced, or the lock changes during inspection. When in doubt, leave the lock in place and wait for its TTL to expire rather than risking concurrent trade execution.
