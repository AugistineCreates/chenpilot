# Reorg-Aware Transaction Submission Implementation (Issue #621)

## Overview

This implementation adds comprehensive reorg-aware finality tracking to transaction submission across Stellar ledger forks. Transactions are no longer considered confirmed upon first Horizon observation — instead, confirmation depth is tracked, ancestry is verified, and independent provider reconciliation ensures canonical chain placement before triggering balance updates and downstream events.

## Architecture

### Core Components

#### 1. FinalityPolicy (src/services/finality/FinalityPolicy.ts)
Configurable finality parameters loaded from environment variables:

**Environment Variables:**
- `FINALITY_CONFIRMATION_DEPTH` — Ledgers required on top of observed ledger before finality (default: 2 for testnet, 3 for mainnet)
- `FINALITY_POLL_INTERVAL_MS` — How often to poll for ledger advancement (default: 2000 for testnet, 5000 for mainnet)
- `FINALITY_CONFIRMATION_TIMEOUT_MS` — Max time to accumulate confirmation depth before marking STALE (default: 300000 for testnet)
- `FINALITY_ANCESTRY_CHECK_DEPTH` — How many ledgers back to verify ancestry (default: 5 for testnet)
- `FINALITY_PRIMARY_HORIZON_URL` — Primary Horizon endpoint (falls back to `STELLAR_HORIZON_URL`)
- `FINALITY_RECONCILIATION_HORIZON_URL` — Independent Horizon for reconciliation (must be genuinely independent)
- `FINALITY_MAX_RECONCILIATION_ATTEMPTS` — Circuit breaker: max retries (default: 3)
- `FINALITY_RECONCILIATION_RETRY_DELAY_MS` — Delay between reconciliation retries (default: 2000)

#### 2. TransactionLifecycle Entity (src/transactions/TransactionLifecycle.entity.ts)
New columns added:
- `ledgerSequence` (BIGINT) — Ledger where transaction was observed
- `ledgerHash` (VARCHAR 64) — Hash of that ledger
- `confirmationDepth` (INTEGER) — How many ledgers have closed on top
- `observedAtProvider` (VARCHAR 128) — Which Horizon endpoint observed this
- `finalityStatus` (VARCHAR 32, default: PENDING) — Reorg-aware state machine:
  - `PENDING` → not yet observed
  - `CONFIRMING` → observed, accumulating depth
  - `FINAL` → finality declared, side effects triggered ✓
  - `ORPHANED` → detected on fork (terminal ✗)
  - `RECONCILING` → querying independent provider
  - `CONFLICTED` → providers disagree (terminal ✗)
  - `STALE` → primary provider stopped (terminal ✗)
- `finalityDeclaredAt` (TIMESTAMP) — When finality was declared
- `orphanedAt` (TIMESTAMP) — When orphan detected
- `orphanedLedgerHash` (VARCHAR 64) — The orphaned hash (audit trail)
- `reconciledAt` (TIMESTAMP) — When reconciliation completed
- `reconcileProvider` (VARCHAR 128) — Which provider used for reconciliation
- `reorgDepth` (INTEGER) — How many ledgers rolled back during reorg

#### 3. LedgerObservation Entity (src/transactions/LedgerObservation.entity.ts)
Immutable audit trail of every confirmation poll:
- `id` (UUID PRIMARY KEY)
- `transactionId` (UUID, FK to transaction_lifecycle)
- `provider` (VARCHAR 128) — Which Horizon endpoint
- `ledgerSequence` (BIGINT)
- `ledgerHash` (VARCHAR 64)
- `parentLedgerHash` (VARCHAR 64) — For ancestry verification
- `txResult` (VARCHAR 32) — SUCCESS | FAILED | NOT_FOUND
- `observedAt` (TIMESTAMP DEFAULT NOW)

**Never deleted.** This table is the immutable record of all observations for audit, forensics, and debugging.

#### 4. AncestryVerifier (src/services/finality/AncestryVerifier.ts)
Verifies ledger canonicality by walking parent_ledger_hash chain backward.

**Key Methods:**
- `verifyAncestry(txLedgerSequence, txLedgerHash, currentSequence)` — Returns `{ canonical, reorgDepth, lastVerifiedSequence }`
  - Fetches ledger records from Horizon
  - Verifies observed ledger hash hasn't changed
  - Walks backward via parent_ledger_hash links
  - Detects forks by hash mismatches
  
- `recordTransactionObservation()` — Stores result in ledger_observations table

**Caching:** Ledger records cached for 60s to avoid re-fetching same sequences.

#### 5. ConfirmationDepthTracker (src/services/finality/ConfirmationDepthTracker.ts)
Main polling loop for confirmation depth accumulation.

**Flow:**
1. `startConfirmationTracking()` — Sets lifecycle to CONFIRMING, starts polling
2. `performConfirmationPoll()` — Every N milliseconds:
   - Get current ledger sequence from Horizon
   - Calculate `depth = currentSequence - txLedgerSequence`
   - Run ancestry check via AncestryVerifier
   - If not canonical → `markOrphaned()` → emit orphan_detected event
   - If timeout exceeded → `markStale()` → emit stale_horizon event
   - If depth >= required → `declareFinal()` → emit finality_declared event + side effects
   - Otherwise continue polling

**Emits:**
- `finality:declared` event (consumed by job handler to trigger balance updates)
- `orphan:detected` event (triggers reconciliation)
- `stale:detected` event (triggers reconciliation)
- `reorg:event` (structured operator notification)

#### 6. ReconciliationService (src/services/finality/ReconciliationService.ts)
Queries independent reconciliation Horizon endpoint after orphan or STALE.

**Flow:**
1. `reconcile(transactionId, txHash)` — Query reconciliation provider for transaction
2. Possible outcomes:
   - **tx_found_same_ledger** — Restart confirmation tracking (false alarm fork)
   - **tx_found_different_ledger** — Transaction re-included in different ledger after fork
   - **tx_not_found** — Call `handleReconciliationFailure()` if both providers return NOT_FOUND → ORPHANED terminal
   - **conflicting_results** — Providers disagree → CONFLICTED terminal (requires manual resolution)
   - **provider_unavailable** — After max attempts, circuit breaker fires

**Circuit Breaker:** After `maxReconciliationAttempts` failures, emits `reconciliation_provider_unavailable` event and marks as ORPHANED.

#### 7. FinalizationManager (src/services/finality/FinalizationManager.ts)
Orchestrator that wires up all services, manages event flow.

**Singleton Pattern:**
```typescript
const manager = getFinalizationManager(); // Global instance
const manager = initializeFinalizationManager(policy); // Create with custom policy
```

**Event Wiring:**
- Confirmation depth reaches → `finality:declared` → Stop tracking, emit to consumers
- Ancestry check fails → `orphan:detected` → Trigger reconciliation
- Timeout reached → `stale:detected` → Trigger reconciliation
- Reconciliation success → Restart confirmation tracking from new ledger
- Reconciliation retry → Schedule delayed retry

#### 8. ReorgEvent Interface (src/services/finality/ReorgEvent.ts)
Structured event for operator notifications:
```typescript
interface ReorgEvent {
  eventType: "finality_declared" | "orphan_detected" | "reconciliation_updated" | 
             "reconciliation_failed" | "conflicting_providers" | "stale_horizon" | 
             "reconciliation_provider_unavailable";
  transactionId: string;
  transactionHash: string;
  network: string;
  timestamp: string; // ISO 8601
  previousStatus: string;
  newStatus: string;
  details: { /* event-specific fields */ };
}
```

All events logged at WARN level as structured JSON for log aggregation.

## Integration Points

### TransactionLifecycleService (src/transactions/TransactionLifecycle.service.ts)

**Key Change:** Confirmation events now gated behind `finality_status = FINAL`

```typescript
// BEFORE: Immediate confirmation
await transactionLifecycleService.transition(lifecycleId, "confirmed");
// -> emitRealtimeEvent() calls notifyConfirmed() immediately

// AFTER: Deferred until finality
private emitRealtimeEvent(record: TransactionLifecycle): void {
  if (record.state === "confirmed" && record.finalityStatus === "FINAL") {
    TransactionUpdateHelper.notifyConfirmed(...);
  }
}

// New method to start tracking:
async markConfirmedInLedger(id, txHash, ledgerSequence, ledgerHash, provider) {
  record.state = "submitted";
  record.correlationId = txHash;
  // Start reorg-aware tracking - does NOT yet emit confirmation
  await finalizationManager.startTracking(...);
}
```

### DelayedTransactionJobHandler (src/jobs/jobHandlers.ts)

**Before:**
```typescript
const response = await this.server.submitTransaction(tx);
TransactionEventBridge.notifyTransactionConfirmed(jobId, response.hash, ...);
```

**After:**
```typescript
const response = await this.server.submitTransaction(tx);
const finalizationManager = getFinalizationManager();
await finalizationManager.startTracking(
  jobId, response.hash, response.ledger, response.ledger_attr?.hash, horizonUrl
);

// Wire up finality listener
finalizationManager.once("finality:declared", (data) => {
  if (data.transactionId === jobId) {
    // NOW trigger side effects
    TransactionEventBridge.notifyTransactionConfirmed(jobId, response.hash, ...);
  }
});
```

### SwapTool (src/Agents/tools/swap.ts)

**Before:**
```typescript
const result = await this.server.submitTransaction(transaction);
await transactionLifecycleService.transition(lifecycleId, "confirmed");
```

**After:**
```typescript
const result = await this.server.submitTransaction(transaction);
await transactionLifecycleService.transition(lifecycleId, "submitted");

const finalizationManager = getFinalizationManager();
await finalizationManager.startTracking(
  lifecycleId, result.hash, result.ledger, result.ledger_attr?.hash, horizonUrl
);
// Balance updates and events deferred until finality_status = FINAL
```

## State Transitions

### Transaction Lifecycle States (Unchanged)
```
intent → submitting → submitted → confirmed ✓ [or → failed ✗]
```

### Finality Status (New, Reorg-Aware)
```
PENDING 
  ↓ [tx observed in ledger]
CONFIRMING
  ├─ [depth >= required && ancestry ok] → FINAL ✓ [side effects triggered]
  ├─ [ancestry check fails] → ORPHANED + emit orphan_detected
  └─ [timeout] → STALE + emit stale_horizon
  
ORPHANED / STALE [orphan/stale detected]
  ↓ [start reconciliation]
RECONCILING
  ├─ [reconciliation finds tx] → CONFIRMING [restart tracking]
  ├─ [both providers NOT_FOUND] → ORPHANED ✗ [terminal]
  ├─ [providers conflict] → CONFLICTED ✗ [terminal]
  └─ [max attempts exceeded] → ORPHANED ✗ [terminal]
```

## Critical Implementation Rules

### Rule 1: No Finality Until Required Depth + Ancestry Check
```typescript
// WRONG - would re-introduce reorg vulnerability
if (confirmationDepth >= required) {
  declareFinal(); // MISSING: ancestry check!
}

// CORRECT
const ancestryResult = await ancestryVerifier.verifyAncestry(...);
if (!ancestryResult.canonical) {
  markOrphaned(); // Fork detected
  return;
}
if (confirmationDepth >= required) {
  declareFinal();
}
```

### Rule 2: Side Effects Only at finality_status = FINAL
```typescript
// WRONG - triggers before finality
TransactionEventBridge.notifyTransactionConfirmed(...);

// CORRECT - in ConfirmationDepthTracker.declareFinal()
lifecycle.finalityStatus = "FINAL";
await lifecycleRepo.save(lifecycle);
// Then consuming code listens to finality:declared event
finalizationManager.on("finality:declared", () => {
  TransactionEventBridge.notifyTransactionConfirmed(...);
});
```

### Rule 3: No Auto-Resubmission on Orphan
```typescript
// WRONG - auto-resubmit on orphan
if (orphanDetected) {
  await resubmitTransaction(txXdr); // DANGER: double-spend
}

// CORRECT - wait for reconciliation or operator decision
if (orphanDetected) {
  lifecycle.finalityStatus = "ORPHANED";
  await reconciliationService.reconcile(txHash);
  // Operator can manually trigger resubmit if needed
}
```

### Rule 4: Reconciliation Provider Must Be Independent
```typescript
// WRONG - same provider for primary and reconciliation
primaryHorizonUrl: "https://horizon.stellar.org"
reconciliationHorizonUrl: "https://horizon.stellar.org" // Same!

// CORRECT - genuinely different operators
primaryHorizonUrl: "https://horizon.stellar.org"        // SDF
reconciliationHorizonUrl: "https://horizon-testnet.stellar.org" // Or different operator
```

### Rule 5: Ledger Observations Table Never Deleted
```typescript
// WRONG - periodic cleanup of observations
DELETE FROM ledger_observations WHERE observed_at < NOW() - INTERVAL '30 days';

// CORRECT - keep forever for audit trail
// ledger_observations is immutable append-only log
```

## Testing Strategy

### Test Suite (tests/unit/finalization.test.ts)

All tests use:
- Mock Horizon servers with configurable responses
- EventEmitter-based event verification
- Deterministic timing via explicit waits instead of polling

**Test 1: Happy Path Confirmation**
- Observe tx in ledger N
- Poll shows ledger N still canonical
- Depth accumulates to required threshold
- Finality declared, side effects triggered once

**Test 2: Confirmation Depth Accumulation**
- Track depth progression from 0 → required
- Verify CONFIRMING state maintained until threshold
- Verify FINAL state only reached at threshold

**Test 3: Orphan Detection**
- Observe tx in ledger N with hash H1
- Next poll: ledger N returns hash H2 (fork)
- orphan_detected event emitted
- finality_status = ORPHANED or RECONCILING

**Test 4: Reconciliation Success**
- Orphan detected
- Reconciliation provider finds tx
- Status resets to CONFIRMING at new ledger
- Confirmation tracking restarted

**Test 5: Reconciliation Failure**
- Both providers return NOT_FOUND
- reconciliation_failed event emitted
- finality_status = ORPHANED (terminal)
- No auto-resubmit triggered

**Test 6: Conflicting Providers**
- Primary: SUCCESS, Reconciliation: FAILED
- conflicting_providers event emitted
- finality_status = CONFLICTED (terminal)
- Manual operator resolution required

**Test 7: STALE Horizon**
- Primary stops advancing ledger
- Timeout reached without sufficient depth
- stale_horizon event emitted
- finality_status = STALE
- Reconciliation triggered

**Test 8: Side Effects Gate**
- Verify balance updates NOT triggered at CONFIRMING
- Verify balance updates triggered EXACTLY ONCE at FINAL
- Spy on event listeners to count triggers

**Test 9: No Duplicate Submission**
- Orphan detected
- Reconciliation succeeds
- Finality eventually declared
- Transaction submitted exactly once across entire flow

**Test 10: Circuit Breaker**
- Reconciliation endpoint fails N times
- After max attempts, circuit breaker fires
- reconciliation_provider_unavailable event emitted
- Retries halt

## Database Migration

**Migration File:** `src/migrations/1785700000000-AddReorgAwarenessToTransactions.ts`

**Up:**
- Add columns to `transaction_lifecycle` table
- Create `ledger_observations` table
- Create indexes on finality_status, ledger_sequence, provider+sequence
- Add foreign key constraint to transaction_lifecycle

**Down:**
- Drop `ledger_observations` table
- Remove columns from `transaction_lifecycle`

## [VERIFY] Items — Operator & Infrastructure Decisions

The following require verification based on deployment context:

### 1. Confirmation Depth Requirement
**Current Defaults:**
- Testnet: 2 ledgers
- Mainnet: 3 ledgers
- Futurenet: 1 ledger

**Verify:** Does your risk tolerance match these? Stellar closes ~1 ledger per 5 seconds, so:
- Testnet: ~10 seconds finality
- Mainnet: ~15 seconds finality

If faster finality needed, reduce `FINALITY_CONFIRMATION_DEPTH`. If more paranoia, increase it.

### 2. Confirmation Timeout
**Current Defaults:**
- Testnet: 300s (5 min)
- Mainnet: 600s (10 min)

**Verify:** After this timeout with no confirmation, transaction marked STALE and reconciliation triggered. Is this timeout appropriate for your network conditions?

### 3. Reconciliation Provider Independence
**Current:** Both primary and reconciliation default to same URL in test environments.

**CRITICAL [VERIFY]:** For production, set `FINALITY_RECONCILIATION_HORIZON_URL` to a genuinely different Horizon operator (not just different instance of same operator). Examples:
- Primary: `https://horizon.stellar.org` (SDF)
- Reconciliation: Different RPC operator's Horizon endpoint

If both providers are controlled by same entity, reconciliation provides no additional guarantees against that entity's bugs or attacks.

### 4. Ancestry Check Depth
**Current Defaults:**
- Testnet: 5 ledgers
- Mainnet: 10 ledgers

**Verify:** Ancestry checks walk back via parent_ledger_hash links. Deeper checks = more confidence but more latency. Current defaults assume forks won't exceed these depths. If Stellar network exhibits deeper forks, increase `FINALITY_ANCESTRY_CHECK_DEPTH`.

### 5. P99 Ledger Close Time
**Assumption:** Stellar closes ledgers every ~5 seconds on average.

**Verify:** Check your network's actual p99 close time. If significantly slower:
- Increase `FINALITY_CONFIRMATION_TIMEOUT_MS` proportionally
- Adjust `FINALITY_POLL_INTERVAL_MS` to avoid wasted polls

### 6. Balance Update Side Effects
**Current Implementation:**
- Side effects trigger on `finality:declared` event from FinalizationManager
- Job handler and swap tool both listen to this event

**Verify:** All balance updates, webhooks, and downstream events that depend on confirmation are now subscribed to the `finality:declared` event, not directly to lifecycle transitions. Search codebase for any remaining direct calls to balance update functions after confirmation and gate them behind finality.

### 7. Operator Event Consumption
**Current:** ReorgEvents are logged at WARN level as structured JSON.

**Verify:** Your logging aggregation system (Datadog, Splunk, ELK, etc.) is consuming these events. Example queries:
```
json.eventType = "orphan_detected"
json.eventType = "reconciliation_failed"
json.network = "mainnet"
```

Ensure alerting is configured for critical events like `conflicted_providers` and `reconciliation_provider_unavailable`.

### 8. Ledger Observation Retention
**Current:** `ledger_observations` table grows indefinitely.

**Verify:** Your PostgreSQL instance has adequate storage. Sample growth rate:
- Each confirmation poll creates 1 observation
- Default poll interval: 2-5 seconds
- ~1000 observations per transaction per finality period (10-15 seconds of polling)
- If 1M transactions/day: ~1B rows after 1000 days

Consider archival policy:
- Keep hot observations (< 30 days)
- Archive older observations to separate storage
- Ensure audit trail is preserved even if archived

### 9. Test Network Validation
**Current:** Tests use mocked Horizon responses.

**Verify:** Before deploying to mainnet, run against testnet with real Horizon endpoints for at least one complete transaction cycle:
- Submit transaction
- Observe in ledger
- Accumulate confirmation depth
- Verify finality_declared event
- Verify side effects trigger exactly once

### 10. Operator Response Procedures
**Current:** CONFLICTED and ORPHANED terminal states require manual intervention.

**Verify:** Document procedures for operators:
- How to identify conflicted transactions
- When to manually resubmit orphaned transactions
- How to coordinate with reconciliation provider on disagreements

## Deployment Checklist

- [ ] Run migration: `npm run typeorm migration:run`
- [ ] Set environment variables for FinalityPolicy (or use defaults)
- [ ] Verify reconciliation Horizon URL is independent
- [ ] Test against testnet with real Horizon endpoints
- [ ] Configure operator event alerting
- [ ] Document operator runbooks for terminal states
- [ ] Verify existing balance update code listens to `finality:declared` event
- [ ] Monitor initial mainnet transactions for reorg/stale events
- [ ] Archive old `ledger_observations` records per retention policy

## Summary of Changes

| File | Change | Impact |
|------|--------|--------|
| `src/migrations/1785700000000-AddReorgAwarenessToTransactions.ts` | Add finality columns & ledger_observations table | DB schema extends transaction tracking |
| `src/transactions/TransactionLifecycle.entity.ts` | Add FinalityStatus type & reorg columns | Entity supports finality state machine |
| `src/transactions/LedgerObservation.entity.ts` | New entity for audit trail | Immutable record of observations |
| `src/services/finality/FinalityPolicy.ts` | Config interface & env loading | Configurable finality parameters |
| `src/services/finality/AncestryVerifier.ts` | Ledger ancestry verification | Detects forks via parent hash chain |
| `src/services/finality/ConfirmationDepthTracker.ts` | Main polling loop | Accumulates confirmation depth |
| `src/services/finality/ReconciliationService.ts` | Independent provider reconciliation | Resolves orphan/stale states |
| `src/services/finality/FinalizationManager.ts` | Orchestrator & singleton | Wires up all services |
| `src/services/finality/ReorgEvent.ts` | Event interface | Structured operator notifications |
| `src/transactions/TransactionLifecycle.service.ts` | Gate confirmation behind finality | No premature side effects |
| `src/jobs/jobHandlers.ts` | Use finalization manager | Deferred balance updates |
| `src/Agents/tools/swap.ts` | Use finalization manager | Reorg-aware swap submission |
| `src/config/Datasource.ts` | Add LedgerObservation entity | TypeORM registration |
| `tests/unit/finalization.test.ts` | 10 comprehensive tests | All scenarios covered |

## Key Architectural Decisions

1. **Event-Driven Finality:** Rather than polling lifecycle state, finalization manager emits `finality:declared` event. This decouples finality tracking from balance update logic.

2. **Immutable Observations Table:** `ledger_observations` is append-only. Never deleted. Enables forensics, audit trail, and debugging of reorg events.

3. **Circuit Breaker on Reconciliation:** After N failed reconciliation attempts, gives up and emits `reconciliation_provider_unavailable`. Prevents infinite retry loops on network outages.

4. **Independent Reconciliation Provider:** Critical requirement. Both providers being SDF Horizon instances doesn't help detect SDF bugs or attacks. Must be genuinely different operator.

5. **No Auto-Resubmission:** Orphaned transactions may still be in mempool and will re-include in canonical chain. Auto-resubmitting risks double-spend. Operator intervention required.

6. **Terminal States Require Resolution:** CONFLICTED, ORPHANED (after failed reconciliation), and STALE (after timeout) are terminal and need operator attention. Prevents silent loss of transactions.

---

**Status:** Implementation complete. All 14 tasks finished. 10 tests provided. Ready for deployment after [VERIFY] items reviewed and addressed.
