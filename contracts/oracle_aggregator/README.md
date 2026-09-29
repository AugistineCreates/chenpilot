# Oracle Aggregator

Quorum-based aggregation across independent price sources for a single
guarded asset. Addresses issue #635: a single fresh oracle value can still
be wrong or manipulated, so price-sensitive contracts need explicit
agreement semantics across independent sources before they trust a number.

This contract does not replace the per-consumer safety layers already in
`flash_loan_guard` / `liquidity_vault` / `lending_liquidation` (staleness,
intra-ledger deviation, circuit breakers against a *single* oracle) — it
sits upstream of them, standing in for a single `PriceOracleTrait` source
with a value derived from several independent ones.

## Model

One deployed instance is scoped to one asset, following the same
single-asset-scoped convention as `por_validator` and `flash_loan_guard`.
Each registered **source** is itself a contract implementing:

```rust
#[contractclient(name = "OracleSourceClient")]
pub trait OracleSourceTrait {
    fn get_price(env: Env) -> SourceReading; // { price, decimals, timestamp }
}
```

## Governance-controlled source registry

`add_source` / `update_source` / `remove_source` are admin-gated
(`require_auth`) and control:

- **Identity** — which contract addresses are trusted sources at all.
- **Weight** (`weight_bps`, 1..=10_000) — how much that source counts
  toward both the weighted median and quorum-by-weight.
- **Enabled** — a source can be disabled (keeping its record) without a
  full `remove_source`, e.g. to bench a source under investigation.

Registration is capped at `MAX_SOURCES` (32) to keep the on-chain sort and
aggregation loop bounded and cheap, and to keep the governance-controlled
set small enough to audit by hand.

## Aggregation algorithm (`aggregate`)

1. **Read, fault-tolerantly.** Every enabled source is queried via
   `try_get_price`, not `get_price` — a panicking, unreachable, or
   malformed source is excluded and counted (`sources_rejected_unavailable`)
   rather than reverting the whole call. One broken or hostile source can
   never DoS the aggregation for everyone else.
2. **Sanity + staleness filter.** Non-positive prices
   (`sources_rejected_invalid`) and readings older than
   `max_staleness_seconds` (`sources_rejected_stale`) are dropped.
3. **Normalize.** Every surviving reading is rescaled from its own
   `decimals` to the aggregator's `output_decimals` with `checked_mul` /
   `checked_div` / `checked_pow` throughout — a pathological decimals
   config fails loudly (`ArithmeticError`) instead of overflowing or
   silently wrapping. Scaling up is exact; scaling down truncates toward
   zero, the same deterministic, bounded (<1 unit) rounding convention
   `liquidity_vault::normalize_price` already uses elsewhere in this repo.
4. **Quorum check #1.** The set of fresh, valid, normalized readings must
   meet both `min_quorum_sources` (count) and `min_quorum_weight_bps`
   (weight) — otherwise `InsufficientQuorum` / `InsufficientQuorumWeight`.
5. **Preliminary weighted median.** Computed over the full fresh set. A
   weighted median already tolerates just under half the weight being
   Byzantine, so this is a meaningful anchor even before step 6.
6. **Bounded disagreement.** Any reading whose deviation from the
   preliminary median exceeds `max_deviation_bps` is dropped
   (`sources_rejected_deviant`) — this is the actual disagreement bound the
   ticket asks for, and it is symmetric (a source can be "too high" or "too
   far below" equally).
7. **Quorum check #2.** Re-checked on the surviving in-band set. If
   filtering out the disagreeing sources breaks quorum,
   `ExcessiveSourceDisagreement` — the call fails rather than silently
   returning a number computed from too few / too skewed sources.
8. **Final weighted median** over the in-band set is the reported price.

Every failure path above is an explicit panic with a distinct
`FailureReason`, never a fallback value. That *is* the "safe degraded
behavior": a consumer either gets a price it can trust, or a clear revert
it can react to (e.g. pause deposits, widen its own circuit breaker).

## Reading the result

- `aggregate()` — state-changing, permissionless (a keeper/refresh action;
  it moves no funds and changes no governance state), recomputes from live
  sources, caches the result, and returns it.
- `get_latest()` — read-only, no cross-contract calls. Returns the cached
  result from the last successful `aggregate()`, but only if it is *still*
  within `max_staleness_seconds` — otherwise it fails
  (`OracleDataStale`/`NotFound`) rather than serving a stale cached value.
  This is the cheap path for consumer contracts that don't want to pay for
  re-querying every source on every read.

## Testing

- `src/test.rs` — governance flows (init, add/update/remove source,
  duplicate/invalid-weight rejection) and aggregation happy paths,
  including a source that always panics (`RevertingSource`) to demonstrate
  fault isolation.
- `src/test_property.rs` — property/invariant coverage per
  `docs/PROPERTY_TESTING.md`:
  - **Byzantine sources**: a minority Byzantine source (in weight) cannot
    move the aggregate price regardless of how far off it lies, and is
    always flagged as deviant; a majority-weight disagreement is required
    to fail the call outright, and it does, safely.
  - **Stale values**: inclusion/exclusion sweep across a range of ages
    relative to `max_staleness_seconds`, independent of price agreement.
  - **Boundary deviations**: a source exactly at `max_deviation_bps` is
    included; one basis point beyond it is excluded.
  - **Decimal normalization**: exactness when scaling up, bounded rounding
    when scaling down, a no-op fast path when unchanged, and an explicit
    panic (never a wrapped/overflowed value) on a decimals configuration
    that would overflow `i128`.

Run with:

```bash
cd contracts/oracle_aggregator
cargo test --lib
```

## Notes / follow-ups

- `admin` is a single `Address` with `require_auth`, matching the
  lightweight governance pattern already used by `por_validator`,
  `flash_loan_guard`, and `liquidity_vault` in this repo. Nothing here
  prevents that address from being a multisig or the `rbac` contract's
  `SuperAdmin` — swapping in stronger governance is an `update_config`
  admin-transfer away and doesn't require changing this contract.
- This does not (yet) implement the multi-asset `CanonicalOracleTrait`
  batch interface sketched in `CANONICAL_ORACLE_INTERFACE.md`; it is a
  single-asset aggregator meant to sit *behind* that interface (or behind
  the existing per-consumer oracle traits) as the trusted price source.
