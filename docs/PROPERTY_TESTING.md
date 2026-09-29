# Property-Based and Invariant Testing for Soroban Contracts

This document describes the property-based/invariant testing approach introduced for high-value Soroban contracts.

## Goals

- Move beyond example-driven unit tests to deeper invariant/fuzz-style coverage.
- Codify accounting, authorization, timing, liquidation, and state-transition invariants.
- Protect against adversarial inputs, stale oracle data, sequencing attacks, and edge conditions.

## Framework

- Uses standard `#[cfg(test)]` Rust tests in each contract crate.
- Helper functions generate deterministic sequences for property checks.
- Tests assert universal properties rather than single examples.

## Invariants Enforced

### Flash Loan Guard (`contracts/flash_loan_guard/src/test_invariants.rs`)

- **Price positivity**: After `record_snapshot`, `snapshot.price > 0`.
- **Circuit breaker reset**: After `circuit_breaker_window_seconds` passes, `triggered` is `false`.
- **Stale oracle rejection**: Oracle data older than `max_oracle_staleness_seconds` is rejected.

### Liquidity Vault (`contracts/liquidity_vault/src/test_property.rs`)

- **Monotonic deviation**: Deviation in basis points increases monotonically as market price moves away from intent.
- **Valid params on approval**: Approved swaps have `amount_in > 0`, `intent_price > 0`.
- **Deadline enforcement**: Execution after `deadline_ledger` is rejected with `deadline_exceeded`.
- **Decimal normalization**: Values normalized across decimals preserve the represented value within rounding error.
- **Non-positive rejection**: `amount_in <= 0` or `intent_price <= 0` triggers `invalid_params`.

## Running the Tests

From repo root:
```bash
cd contracts/flash_loan_guard
cargo test --lib

cd ../liquidity_vault
cargo test --lib
```

## Adding New Properties

1. Identify the invariant or property you want to enforce.
2. Add a new `#[test]` function in `test_property.rs` or `test_invariants.rs`.
3. Use helper generators (e.g. `price_sequence`) to sweep inputs.
4. Use `assert!`, `assert_eq!`, and `#[should_panic(expected = "...")]` to encode expected behavior.

## Coverage Expectations

All high-value contracts should have:
- At least one property-based test module (`test_property.rs` or `test_invariants.rs`).
- Invariants for input validation, deadline/timing, and state transitions.
- Panic messages asserted to avoid regressions on error paths.

## Future Work

- Integrate cargo-fuzz for randomized mutation testing.
- Automate property generation via proptest-style frameworks.
- Extend invariants to multi-contract integration scenarios (e.g., flash loan + vault).