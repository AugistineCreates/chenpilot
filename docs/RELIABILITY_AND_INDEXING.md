# Backend Reliability and Indexing Platform

This document covers the hardened contract, improved concurrency primitives, state reconciliation, and resilient event indexing added in this batch.

## Flash Loan Guard Hardening (`contracts/flash_loan_guard/src/lib.rs`)

### Oracle freshness & sequencing protections
- **Oracle freshness check**: `record_snapshot` and `assert_price_safe` reject snapshots older than `max_oracle_staleness_seconds`.
- **Oracle sequence monotonicity**: Each snapshot must have a strictly increasing sequence number, preventing replay/out-of-order attacks.
- **Consecutive price change limit**: Enforces `max_consecutive_price_change_bips` between snapshots.
- **Delayed update detection**: Rejects snapshots if the oracle update gap exceeds `max_oracle_update_gap_seconds`.
- **Ledger timing edge-case guard**: `assert_price_safe` fails if the snapshot is too old relative to the current ledger sequence.

### Circuit breaker
- New `CircuitBreakerState` and `CircuitBreaker` storage key.
- Auto-triggers after 3 consecutive price-deviation violations within the threshold.
- Resets after `circuit_breaker_window_seconds`.
- Publishes `CbTrip` and `CbRst` events for monitoring.

## Redis Concurrency Foundation (`src/services/lock/redisConcurrency.service.ts`)

Replaces basic lock service with ownership-aware, renewable, and instrumented primitives:

- **Ownership semantics**: Lock values include owner identifier; release/extend only succeed for the owner.
- **Automatic renewal**: `renewLock` extends TTL once 60% of lifetime has elapsed.
- **Stale-lock cleanup**: `cleanupStaleLocks` removes locks missing TTL metadata.
- **Instrumentation**: Counters for acquire/release/extend/renewal/stale cleanup with reset capability.

## State Reconciliation (`src/services/reconciliation.service.ts`)

Detects and surfaces drift between backend records and on-chain state:

- **Transaction drift**: Compares DB status against Stellar Horizon.
- **Balance drift**: Compares cached balances against on-chain wallet balances.
- **Contract drift**: Compares backend snapshots against Soroban contract ledger entries.
- Each drift item includes `type`, `severity`, `backendValue`, `onChainValue`, `repairAction`.
- Reports are persisted to `reconciliation_reports` and queryable by `userId`.

## Resilient Event Indexing (`src/services/stellarIndexer/resilientIndexerPipeline.ts`)

- **Restart-safe cursor tracking**: Durable `cursorStore` backed by PostgreSQL with atomic upsert.
- **Replay-safe bounded re-index**: Resets cursor to `fromLedger - 1`, replays, then restores previous cursor on failure.
- **Retry logic**: `pollWithRetry` retries transient failures with linear backoff.
- **Normalized event dispatch**: Central dispatch hook for downstream consumers.
- Observability integration via `getObservabilityContext`.

## Usage

### Flash loan guard (Soroban contract)
Already integrated in `contracts/flash_loan_guard/src/lib.rs`. Deploy with config including new fields:
```rust
Config {
  circuit_breaker_threshold_bps: 500,
  circuit_breaker_window_seconds: 3600,
  // ...existing fields
}
```

### Redis concurrency
```ts
import { redisConcurrencyService } from "./services/lock/redisConcurrency.service";

const lock = await redisConcurrencyService.acquireLock("resource:123", "worker-1", { ttl: 60000 });
if (lock.acquired) {
  try {
    // work...
  } finally {
    await redisConcurrencyService.releaseLock("resource:123", "worker-1");
  }
}
```

### Reconciliation
```ts
import { reconciliationService } from "./services/reconciliation.service";

const report = await reconciliationService.reconcile(userId, {
  transactions: true,
  balances: true,
  contractState: true,
  walletAddress: "G...",
  contractIds: ["C..."],
  network: "testnet",
});
```

### Indexer pipeline
```ts
import { resilientIndexerPipeline } from "./services/stellarIndexer/resilientIndexerPipeline";

// Live indexing
await resilientIndexerPipeline.start({
  horizonUrl: "https://horizon.stellar.org",
  // ...
});

// Replay
await resilientIndexerPipeline.replay({ fromLedger: 1000, toLedger: 2000 }, {
  horizonUrl: "https://horizon.stellar.org",
});