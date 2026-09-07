# Contract Invariants - Soroban Contract Suite

This document defines the invariants (safety properties) that must hold for each contract in the Chen Pilot Soroban suite.

## Table of Contents
- [Common Invariants](#common-invariants)
- [Multi-Region Failover Invariants](#multi-region-failover-invariants)
- [Cross-Contract Authorization Invariants](#cross-contract-authorization-invariants)
- [BTC Relay Invariants](#btc-relay-invariants)
- [RBAC Invariants](#rbac-invariants)
- [Multi-Hop Swap Invariants](#multi-hop-swap-invariants)
- [Flash Loan Guard Invariants](#flash-loan-guard-invariants)
- [Core Vault Invariants](#core-vault-invariants)
- [Fee Distribution Invariants](#fee-distribution-invariants)
- [HTLC Invariants](#htlc-invariants)
- [Intent Market Validator Invariants](#intent-market-validator-invariants)
- [Lending Liquidation Invariants](#lending-liquidation-invariants)
- [Liquidity Vault Invariants](#liquidity-vault-invariants)
- [Oracle Aggregator Invariants](#oracle-aggregator-invariants)
- [PoR Validator Invariants](#por-validator-invariants)
- [Relayer Slashing Invariants](#relayer-slashing-invariants)
- [Strategy Registry Invariants](#strategy-registry-invariants)

---

## Common Invariants

### I1: Initialization State
**Invariant**: Contract can only be initialized once.

**Formal**: `initialized == true ⇒ cannot initialize again`

**Enforcement**: Instance storage flag checked on initialization.

### I2: Auth Requirement
**Invariant**: All state-changing functions require caller authentication.

**Formal**: `∀ f ∈ state_changing_functions: require_auth() is called`

**Enforcement**: Soroban SDK's `require_auth()` on privileged operations.

### I3: Storage Consistency
**Invariant**: Storage keys are unique and data is properly typed.

**Formal**: `∀ k ∈ storage_keys: type(value_at(k)) == expected_type(k)`

**Enforcement**: Rust type system and Soroban storage typing.

### I4: Event Emission
**Invariant**: All state changes emit corresponding events.

**Formal**: `∀ state_change: ∃ event_emission`

**Enforcement**: Event publishing after each state modification.

---

## Multi-Region Failover Invariants

These invariants preserve single-writer safety for durable operations and financial side effects across regional control planes. The goal is to make split-brain execution (two regions executing the same durable operation or allocating conflicting sequence numbers) impossible, not merely unlikely.

### Definitions
- **Epoch**: A strictly monotonic integer identifying the current ownership generation. Each promotion increments the epoch. Persisted in a linearizable, quorum-backed store (the fence store).
- **Owner**: The single region whose epoch equals the current fence epoch. Only the owner may execute durable operations.
- **Fence token**: The epoch value stamped on every durable side effect and sequence allocation.
- **Durable operation**: Any operation with an external, non-idempotent financial side effect or that allocates a global sequence number.

### MRF1: Epoch Fence Required for Execution
**Invariant**: No region may execute a durable operation without holding a valid epoch fence equal to the current fence-store epoch.

**Formal**: `execute(op) ⇒ region.epoch == fence_store.current_epoch()`

**Enforcement**: The fence epoch is read (or leased with a bounded TTL) and re-validated against the linearizable fence store at the point of execution; any mismatch aborts the operation before side effects. Satisfies acceptance criterion: no region can execute without a valid epoch fence.

### MRF2: Epoch Monotonicity
**Invariant**: The fence epoch strictly increases and never repeats or decreases.

**Formal**: `epoch(t+1) > epoch(t)`

**Enforcement**: Compare-and-swap increment on the fence store during promotion; a promotion that cannot advance the epoch is rejected.

### MRF3: Single Owner
**Invariant**: At most one region holds the current epoch at any time.

**Formal**: `|{r | r.epoch == fence_store.current_epoch()}| <= 1`

**Enforcement**: Ownership is a quorum-linearizable lease keyed by epoch; acquiring epoch N atomically invalidates all leases for epochs < N.

### MRF4: Fenced Sequence Allocation
**Invariant**: Every allocated sequence number is stamped with the allocating epoch, and allocations from a stale epoch are rejected.

**Formal**: `alloc(seq) ⇒ seq.epoch == fence_store.current_epoch() ∧ (epoch, seq) unique`

**Enforcement**: Sequence allocator conditions each allocation on the current fence epoch (CAS); writes tagged with a superseded epoch are rejected by the durable store. Prevents conflicting sequence numbers across regions.

### MRF5: Stale-Writer Rejection
**Invariant**: A demoted or partitioned former owner cannot commit side effects after a higher epoch exists.

**Formal**: `write.epoch < fence_store.current_epoch() ⇒ write rejected`

**Enforcement**: Durable stores and external effect gateways enforce a monotonic epoch guard on every write, rejecting any write carrying an epoch lower than the highest observed. This is the mechanism that network-partition tests exercise to prove split-brain rejection.

### MRF6: Promotion Requires Verified Data and Chain-State Freshness
**Invariant**: A region may be promoted to owner only after its replicated data and chain state are verified fresh and consistent up to the last committed operation of the prior epoch.

**Formal**: `promote(region) ⇒ region.replication_lag == 0 ∧ region.chain_head_verified ∧ region.last_applied_seq >= prior_epoch.max_committed_seq`

**Enforcement**: Promotion procedure blocks epoch increment until replication catch-up, integrity verification, and chain-state freshness checks pass; otherwise promotion is denied. Satisfies acceptance criterion: promotion requires verified data and chain-state freshness.

### MRF7: Data Replication Durability Before Ack
**Invariant**: A durable operation is acknowledged only after its effect and fence stamp are replicated to a quorum sufficient to survive the target failure domain.

**Formal**: `ack(op) ⇒ replicated(op, quorum)`

**Enforcement**: Synchronous quorum replication of the effect log and fence metadata prior to returning success, ensuring a promoted region can reconstruct authoritative state.

### MRF8: Split-Brain Rejection Under Partition
**Invariant**: During a network partition, a region that cannot confirm ownership against a quorum must not execute durable operations.

**Formal**: `partitioned(region) ∧ ¬quorum_confirms(region.epoch) ⇒ ¬execute(durable_op)`

**Enforcement**: Ownership leases require quorum confirmation with bounded TTL; on lease expiry or loss of quorum contact the region fences itself off (stops durable execution) before the prior lease can be reissued elsewhere. Verified by network-partition tests that assert the minority side rejects all durable operations.

### MRF9: Documented Recovery Objectives and Override Risk
**Invariant**: Recovery objectives and the risk profile of any manual override are explicitly documented and gated.

**Formal**: `manual_override ⇒ documented ∧ authorized ∧ audited`

**Enforcement**:
- **RPO (Recovery Point Objective)**: 0 for financial side effects — no acknowledged durable operation may be lost, guaranteed by MRF7 quorum durability. Best-effort for non-durable telemetry.
- **RTO (Recovery Time Objective)**: Bounded by lease TTL plus promotion verification time (MRF6); target documented per deployment.
- **Manual override**: Forcing promotion without passing MRF6 verification, or manually advancing the epoch, can cause data loss or execution of operations against stale chain state. Overrides are therefore:
  1. Restricted to break-glass credentials with multi-party authorization.
  2. Required to explicitly acknowledge the RPO/consistency risk being accepted.
  3. Fully audited via event emission (see I4) with the operator identity and justification.
  Overriding MRF1–MRF5 (the fencing chain) is prohibited even under break-glass, because it directly reintroduces split-brain risk.

---

## Cross-Contract Authorization Invariants

### CCA1: Trust Boundary Documentation

**Invariant**: Every privileged cross-contract call must document its trust assumptions and trusted caller.

**Formal**: `∀ call ∈ privileged_cross_contract_calls: trust_documented(call) == true`

**Enforcement**: Contract interfaces and design notes identify the trusted caller, entry point, and authorization scope.

### CCA2: Exact Authorization Binding

**Invariant**: Authorization binds the exact contract, function, arguments, and nonce where applicable.

**Formal**: `authorized(ctx) ⇒ ctx == (contract_id, function, args_hash, nonce)`

**Enforcement**: `require_auth` validates the full invocation payload; partial, forwarded, or replayed auth contexts are rejected.

### CCA3: Nested Invocation Preservation

**Invariant**: Authorization invariants hold for any nested invocation depth within protocol limits; an intermediary cannot confuse the deputy.

**Formal**: `∀ depth ≤ max_invocation_depth: auth_context(depth) == auth_context(0)`

**Enforcement**: Nested cross-contract calls preserve the originating authorized invocation path and never re-authorize with caller authority for unintended arguments.

### CCA4: Adversarial Intermediary Coverage

**Invariant**: The test suite includes adversarial intermediary contracts that attempt authorization replay and confused-deputy attacks.

**Formal**: `∀ adversarial_intermediary ∈ tests: security_invariants_hold`

**Enforcement**: Integration tests deploy malicious intermediaries that re-enter, forward, and reuse auth contexts; invariant violations panic or revert.

---

## BTC Relay Invariants

### BR1: Configuration Immutability
**Invariant**: Once initialized, config can only be changed by admin.

**Formal**: `config.admin == caller ⇒ can_update_config(config)`

**Enforcement**: `current.admin.require_auth()` on `update_config`.

### BR2: Claimed Transaction Uniqueness
**Invariant**: A Bitcoin transaction ID can only be claimed once.

**Formal**: `claimed(tx_id) == true ⇒ cannot_claim_again(tx_id)`

**Enforcement**: Persistent storage check before processing claim.

### BR3: Minimum Confirmations
**Invariant**: Merkle proof depth must meet minimum confirmations.

**Formal**: `merkle_proof.len() >= config.min_confirmations`

**Enforcement**: Depth check in `verify_and_claim`.

### BR4: Block Header Validity
**Invariant**: Block header must be exactly 80 bytes.

**Formal**: `block_header.len() == 80`

**Enforcement**: Length validation in `verify_and_claim`.

### BR5: Proof of Work
**Invariant**: Block header hash must meet target difficulty.

**Formal**: `hash(header) <= target(header)`

**Enforcement**: Delegated to btc_relay_crypto contract.

### BR6: Merkle Inclusion
**Invariant**: Transaction must be included in block via Merkle proof.

**Formal**: `merkle_root(header) == compute_merkle_root(tx_id, proof, index)`

**Enforcement**: Delegated to btc_relay_crypto contract.

### BR7: Claimed TTL
**Invariant**: Claimed records expire after TTL (~30 days).

**Formal**: `claimed(tx_id).expires_at <= current_ledger + CLAIMED_TX_TTL_LEDGERS`

**Enforcement**: `set_with_ttl` on claimed records.

---

## RBAC Invariants

### RB1: Super Admin Uniqueness
**Invariant**: Only one super admin exists at any time.

**Formal**: `|{a | is_super_admin(a)}| == 1`

**Enforcement**: Single instance storage slot for super admin.

### RB2: Role Grant Authorization
**Invariant**: Only super admin can grant roles.

**Formal**: `grant_role(to, role) ⇒ caller == super_admin`

**Enforcement**: `super_admin.require_auth()` on `grant_role`.

### RB3: Role Revoke Authorization
**Invariant**: Only super admin can revoke roles.

**Formal**: `revoke_role(from, role) ⇒ caller == super_admin`

**Enforcement**: `super_admin.require_auth()` on `revoke_role`.

### RB4: Role Consistency
**Invariant**: Role assignment is boolean (either has or doesn't have).

**Formal**: `has_role(addr, role) ∈ {true, false}`

**Enforcement**: Boolean storage type for role assignments.

### RB5: Admin Transfer Authorization
**Invariant**: Only current super admin can transfer admin.

**Formal**: `transfer_admin(new_admin) ⇒ caller == current_super_admin`

**Enforcement**: `old_admin.require_auth()` on `transfer_admin`.

### RB6: Role Check Correctness
**Invariant**: Role check returns accurate storage value.

**Formal**: `has_role(addr, role) == storage.get(HasRole(addr, role))`

**Enforcement**: Direct storage lookup in `has_role`.

---

## Multi-Hop Swap Invariants

### MHS1: Non-Empty Hops
**Invariant**: Swap must have at least one hop.

**Formal**: `hops.len() >= 1`

**Enforcement**: Empty check at start of `swap`.

### MHS2: Caller Authentication
**Invariant**: Only authenticated caller can initiate swap.

**Formal**: `swap(caller, hops) ⇒ caller.require_auth()`

**Enforcement**: `caller.require_auth()` at function start.

### MHS3: Slippage Protection
**Invariant**: Each hop output must meet minimum amount.

**Formal**: `∀ hop ∈ hops: amount_out >= hop.min_amount_out`

**Enforcement**: Slippage check after each swap.

### MHS4: Token Flow Conservation
**Invariant**: Tokens flow from caller → contract → pool → contract → caller.

**Formal**: `token_in(caller) → token_in(contract) → token_in(pool) → token_out(contract) → token_out(caller)`

**Enforcement**: Sequential transfer operations in swap loop.

### MHS5: Hop Sequence Integrity
**Invariant**: Hop output becomes next hop input.

**Formal**: `hop[i].amount_out == hop[i+1].amount_in`

**Enforcement**: Variable `current_amount` carries output to next hop.

### MHS6: Final Transfer
**Invariant**: Final output transferred to caller.

**Formal**: `last_hop.token_out.transfer(contract, caller, final_amount)`

**Enforcement**: Final transfer after loop completion.

---

## Flash Loan Guard Invariants

### FLG1: Configuration Immutability
**Invariant**: Config can only be changed by admin.

**Formal**: `update_config(config) ⇒ caller == current_admin`

**Enforcement**: `current.admin.require_auth()` on `update_config`.

### FLG2: Oracle Freshness
**Invariant**: Oracle data must not exceed staleness threshold.

**Formal**: `current_time <= oracle_timestamp + max_oracle_staleness_seconds`

**Enforcement**: Freshness check in `record_snapshot` and `assert_price_safe`.

### FLG3: Oracle Sequence Monotonicity
**Invariant**: Oracle sequence must strictly increase.

**Formal**: `new_oracle_sequence > last_oracle_sequence`

**Enforcement**: Sequence comparison in `record_snapshot`.

### FLG4: Minimum Ledger Gap
**Invariant**: Snapshots must respect minimum ledger gap.

**Formal**: `current_ledger >= last_snapshot_ledger + min_ledger_gap`

**Enforcement**: Ledger gap check in `record_snapshot`.

### FLG5: Price Deviation Limit
**Invariant**: Price deviation must stay within threshold.

**Formal**: `|current_price - snapshot_price| / snapshot_price <= max_intra_ledger_deviation_bps / 10000`

**Enforcement**: Deviation calculation and check in `assert_price_safe`.

### FLG6: Consecutive Price Change Limit
**Invariant**: Consecutive price changes must stay within threshold.

**Formal**: `|new_price - old_price| / old_price <= max_consecutive_price_change_bps / 10000`

**Enforcement**: Consecutive change check in `record_snapshot`.

### FLG7: Circuit Breaker Trigger
**Invariant**: Circuit breaker triggers after consecutive violations.

**Formal**: `consecutive_violations >= 3 ⇒ circuit_breaker.triggered == true`

**Enforcement**: Violation counting and trigger logic in `record_snapshot`.

### FLG8: Circuit Breaker Expiration
**Invariant**: Circuit breaker auto-releases after time window.

**Formal**: `current_time > trigger_timestamp + circuit_breaker_window_seconds ⇒ circuit_breaker.triggered == false`

**Enforcement**: Time-based release in `update_circuit_breaker`.

### FLG9: Snapshot TTL
**Invariant**: Price snapshot expires after TTL (~1 day).

**Formal**: `snapshot.expires_at <= current_ledger + PRICE_SNAPSHOT_TTL_LEDGERS`

**Enforcement**: `set_with_ttl` on snapshot storage.

### FLG10: Same-Ledger Rejection
**Invariant**: Cannot assert price safety in same ledger as snapshot.

**Formal**: `assert_price_safe() ⇒ current_ledger != snapshot.ledger`

**Enforcement**: Ledger comparison in `assert_price_safe`.

---

## Core Vault Invariants

### CV1: Withdrawal Authorization
**Invariant**: Withdrawals require proper authorization.

**Formal**: `withdraw(amount, recipient) ⇒ caller.has_role(Withdrawer) || caller == recipient`

**Enforcement**: RBAC check or ownership check.

### CV2: Collateral Sufficiency
**Invariant**: Borrow amount must not exceed collateral limit.

**Formal**: `borrow_amount <= collateral_value * collateral_factor`

**Enforcement**: Collateral ratio check before borrow.

### CV3: Solvency
**Invariant**: Total assets >= total liabilities.

**Formal**: `total_assets >= total_borrows + total_interest`

**Enforcement**: Balance checks on operations.

### CV4: Interest Accrual
**Invariant**: Interest accrues on outstanding borrows.

**Formal**: `borrow_balance(t) = borrow_balance(t-1) * (1 + interest_rate)`

**Enforcement**: Interest calculation on each ledger.

---

## Fee Distribution Invariants

### FD1: Distribution Authorization
**Invariant**: Fee distribution requires admin authorization.

**Formal**: `distribute_fees() ⇒ caller == admin`

**Enforcement**: Admin auth check on distribution.

### FD2: Fee Pool Non-Negativity
**Invariant**: Fee pool balance cannot go negative.

**Formal**: `fee_pool_balance >= 0`

**Enforcement**: Balance check before distribution.

### FD3: Recipient Validation
**Invariant**: Fee recipients must be whitelisted or admin-approved.

**Formal**: `is_valid_recipient(recipient) == true ⇒ can_distribute_to(recipient)`

**Enforcement**: Recipient whitelist check.

---

## HTLC Invariants

### HTLC1: Hash Lock Security
**Invariant**: Funds can only be claimed with valid preimage.

**Formal**: `claim(preimage) ⇒ hash(preimage) == lock_hash`

**Enforcement**: Hash verification on claim.

### HTLC2: Time Lock Expiration
**Invariant**: Funds can be refunded after time lock expires.

**Formal**: `current_time >= time_lock_expiry ⇒ can_refund()`

**Enforcement**: Time comparison on refund.

### HTLC3: Claim Uniqueness
**Invariant**: Each contract instance can only be claimed once.

**Formal**: `claimed == true ⇒ cannot_claim_again()`

**Enforcement**: Claimed flag in storage.

### HTLC4: Refund Uniqueness
**Invariant**: Each contract instance can only be refunded once.

**Formal**: `refunded == true ⇒ cannot_refund_again()`

**Enforcement**: Refunded flag in storage.

---

## Intent Market Validator Invariants

### IMV1: Intent Signature Validity
**Invariant**: Intent must have valid signature.

**Formal**: `verify_signature(intent, signature) == true ⇒ can_validate(intent)`

**Enforcement**: Signature verification before validation.

### IMV2: Intent Nonce Uniqueness
**Invariant**: Each intent nonce can only be used once.

**Formal**: `used_nonce(nonce) == true ⇒ cannot_use_again(nonce)`

**Enforcement**: Nonce tracking in storage.

### IMV3: Intent Expiration
**Invariant**: Intents expire after timeout.

**Formal**: `current_time > intent.expiry ⇒ cannot_validate(intent)`

**Enforcement**: Timestamp check on validation.

---

## Lending Liquidation Invariants

### LL1: Liquidation Threshold
**Invariant**: Position can only be liquidated if collateral ratio below threshold.

**Formal**: `collateral_ratio < liquidation_threshold ⇒ can_liquidate(position)`

**Enforcement**: Ratio check before liquidation.

### LL2: Liquidation Coverage
**Invariant**: Liquidation must cover debt plus penalty.

**Formal**: `liquidation_amount >= debt + liquidation_penalty`

**Enforcement**: Amount calculation on liquidation.

### LL3: Liquidator Reward
**Invariant**: Liquidator receives reward for successful liquidation.

**Formal**: `liquidator_reward = liquidation_amount * liquidation_incentive`

**Enforcement**: Reward calculation on liquidation.

---

## Liquidity Vault Invariants

### LV1: Constant Product Formula
**Invariant**: Token reserves maintain constant product (x * y = k).

**Formal**: `reserve_a * reserve_b == k (constant)`

**Enforcement**: Formula validation on swap.

### LV2: LP Token Supply
**Invariant**: LP token supply matches total liquidity.

**Formal**: `total_lp_tokens == total_liquidity / initial_share_price`

**Enforcement**: Supply calculation on mint/burn.

### LV3: Reserve Balance
**Invariant**: Contract reserves match actual token balances.

**Formal**: `reserve_a == token_a.balance(contract)`

**Enforcement**: Balance verification on operations.

### LV4: Slippage Protection
**Invariant**: Swap output must meet minimum amount.

**Formal**: `amount_out >= min_amount_out`

**Enforcement**: Slippage check on swap.

---

## Oracle Aggregator Invariants

### OA1: Governance-Only Source Management
**Invariant**: Sources can only be added, updated, or removed by admin.

**Formal**: `add_source(...) | update_source(...) | remove_source(...) ⇒ caller == config.admin`

**Enforcement**: `config.admin.require_auth()` on all three functions.

### OA2: Weight Bounds
**Invariant**: Every registered source has a weight in (0, 10000] bps.

**Formal**: `0 < source.weight_bps <= 10000`

**Enforcement**: Range check in `add_source` / `update_source`.

### OA3: Source Count Bound
**Invariant**: The registered source set never exceeds `MAX_SOURCES`.

**Formal**: `source_list.len() <= MAX_SOURCES`

**Enforcement**: Length check in `add_source` before registration.

### OA4: Staleness Exclusion
**Invariant**: A reading older than the staleness bound is never counted toward quorum or the median.

**Formal**: `current_time > reading.timestamp + max_staleness_seconds ⇒ reading excluded`

**Enforcement**: Freshness filter in `compute_aggregate`.

### OA5: Quorum Before Median (Pass 1)
**Invariant**: A median is only computed over a set that already meets both quorum thresholds.

**Formal**: `fresh.count >= min_quorum_sources ∧ fresh.weight_bps >= min_quorum_weight_bps` before `weighted_median(fresh)` is called.

**Enforcement**: `require(...)` checks in `compute_aggregate` precede the first `weighted_median` call.

### OA6: Bounded Disagreement
**Invariant**: Every source contributing to the final price is within `max_deviation_bps` of the preliminary median.

**Formal**: `∀ r ∈ in_band: |r.price - prelim_median| / prelim_median <= max_deviation_bps / 10000`

**Enforcement**: Deviation filter (pass 2) in `compute_aggregate`.

### OA7: Quorum After Filtering (Pass 2)
**Invariant**: If deviation filtering breaks quorum, the call fails instead of returning a price.

**Formal**: `in_band.count < min_quorum_sources ∨ in_band.weight_bps < min_quorum_weight_bps ⇒ panic(ExcessiveSourceDisagreement)`

**Enforcement**: `require(...)` checks in `compute_aggregate` after the deviation filter.

### OA8: Fault-Isolated Source Reads
**Invariant**: A single reverting/unreachable source cannot abort aggregation for the others.

**Formal**: `source.get_price() panics ⇒ source excluded (sources_rejected_unavailable += 1), aggregation continues`

**Enforcement**: `try_get_price()` (fallible cross-contract call) instead of `get_price()` in `compute_aggregate`.

### OA9: Overflow-Safe Normalization
**Invariant**: Decimal normalization never wraps or silently overflows.

**Formal**: `normalize_checked(price, from, to)` uses `checked_mul` / `checked_div` / `checked_pow` throughout; any overflow panics with `ArithmeticError`.

**Enforcement**: Checked arithmetic in `normalize_checked` / `checked_pow10`.

### OA10: Degraded-Read Safety
**Invariant**: A cached aggregate is only ever served if it is still within the staleness bound.

**Formal**: `get_latest() ⇒ current_time <= last_aggregate.timestamp + max_staleness_seconds`, else panic.

**Enforcement**: Freshness check in `get_latest`.

---

## PoR Validator Invariants

### PoR1: Proof Signature Validity
**Invariant**: Proof of reserve must have valid signature.

**Formal**: `verify_signature(por, signature) == true ⇒ can_validate(por)`

**Enforcement**: Signature verification on validation.

### PoR2: Reserve Balance Accuracy
**Invariant**: Reported reserve balance must match actual on-chain balance.

**Formal**: `reported_balance == on_chain_balance`

**Enforcement**: Balance verification on validation.

### PoR3: Proof Freshness
**Invariant**: Proof of reserve must be recent.

**Formal**: `current_time - proof_timestamp <= max_staleness`

**Enforcement**: Timestamp check on validation.

---

## Relayer Slashing Invariants

### RS1: Slashing Condition
**Invariant**: Relayer can only be slashed for valid violations.

**Formal**: `slash(relayer) ⇒ violation_detected(relayer) == true`

**Enforcement**: Violation check before slashing.

### RS2: Slashing Amount
**Invariant**: Slashing amount must not exceed bonded stake.

**Formal**: `slash_amount <= relayer.bonded_stake`

**Enforcement**: Amount check on slashing.

### RS3: Slashing Uniqueness
**Invariant**: Each violation can only result in one slash.

**Formal**: `slashed_for(violation_id) == true ⇒ cannot_slash_again(violation_id)`

**Enforcement**: Violation tracking in storage.

---

## Strategy Registry Invariants

### SR1: Strategy Approval
**Invariant**: Strategy must be approved before use.

**Formal**: `is_approved(strategy) == true ⇒ can_use(strategy)`

**Enforcement**: Approval check before strategy execution.

### SR2: Strategy Uniqueness
**Invariant**: Each strategy ID is unique.

**Formal**: `strategy_id1 == strategy_id2 ⇒ strategy1 == strategy2`

**Enforcement**: Unique ID assignment on registration.

### SR3: Strategy Performance
**Invariant**: Strategy performance metrics are accurately tracked.

**Formal**: `strategy.performance == actual_returns / expected_returns`

**Enforcement**: Performance calculation on each execution.

---

## Invariant Testing

### Property-Based Testing
Several contracts include property-based tests to verify invariants:

- **Flash Loan Guard**: `test_invariants.rs` - Tests price deviation, circuit breaker, and freshness invariants
- **Liquidity Vault**: `test_property.rs` - Tests constant product formula and reserve balance invariants

### Unit Test Coverage
All contracts include unit tests in `test.rs` that verify:
- Initialization invariants
- Access control invariants
- State transition invariants
- Boundary condition invariants

### Fuzzing Recommendations
For comprehensive invariant verification, consider:
- Fuzzing public entry points with random inputs
- Fuzzing cross-contract call sequences
- Fuzzing storage state transitions
- Fuzzing timestamp/ledger sequence manipulation

---

## Conclusion

These invariants define the safety properties that must hold for the Soroban contract suite. Auditors should verify that:

1. Each invariant is properly enforced in the code
2. Invariant violations are impossible or result in panic
3. Invariant violations emit appropriate events
4. Invariant testing covers edge cases
5. Cross-contract interactions preserve invariants

Any violation of these invariants represents a potential security vulnerability and should be addressed before deployment.