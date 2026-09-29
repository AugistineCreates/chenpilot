# Vault Accounting Invariants: core_vault State Consistency

## Current Accounting State

### Storage Keys

- `Deposit(Address)` - User balance in persistent storage
- `ForceExit(Address)` - Pending force-exit request
- `BackendOnline` - Backend operational status
- `PendingUpgrade` - Upgrade state
- `Admin` - Admin address
- `VaultToken` - Token address

### Accounting Flows

#### Deposit Flow

1. User calls `deposit(user, amount)`
2. Check: `BackendOnline == true`
3. Transfer: `user -> contract`
4. Update: `Deposit[user] += amount`
5. Extend TTL on deposit record

#### Withdrawal Flow

1. User calls `withdrawal(user, amount)`
2. Check: `BackendOnline == true`
3. Check: `Deposit[user] >= amount`
4. Update: `Deposit[user] -= amount`
5. Transfer: `contract -> user`
6. Remove deposit if balance == 0

#### Force Exit Flow

1. User calls `force_exit_request(user)`
2. Check: `BackendOnline == false`
3. Check: `Deposit[user] > 0`
4. Check: No existing `ForceExit[user]`
5. Create: `ForceExit[user] = {amount, eligible_at}`
6. Set TTL on force-exit record

#### Force Exit Completion

1. User calls `force_exit_complete(user)`
2. Check: `ForceExit[user]` exists
3. Check: `timestamp >= eligible_at`
4. Remove: `ForceExit[user]`
5. Remove: `Deposit[user]`
6. Transfer: `contract -> user`

## Identified Invariant Violations

### Issue #1: Deposit/ForceExit Race Condition

**Problem**: User can have both `Deposit` and `ForceExit` simultaneously during force_exit_request

**Current State**:

- `force_exit_request` creates `ForceExit` but does NOT remove `Deposit`
- `Deposit` is only removed during `force_exit_complete`
- This creates a window where both exist

**Invariant Violation**:

```
NOT (ForceExit[user] exists AND Deposit[user] exists)
```

### Issue #2: Backend Status Toggle Inconsistency

**Problem**: No invariant ensuring backend status changes are safe

**Current State**:

- Admin can toggle `BackendOnline` at any time
- No check for pending operations
- No protection against toggling during active deposits/withdrawals

**Invariant Violation**:

```
IF BackendOnline changes THEN no pending operations should be in flight
```

### Issue #3: Upgrade Window State Safety

**Problem**: No invariant protecting state during upgrade window

**Current State**:

- `propose_upgrade` starts timelock
- During timelock, normal operations continue
- No state freeze during upgrade window

**Invariant Violation**:

```
IF PendingUpgrade exists THEN critical state changes should be restricted
```

### Issue #4: Recovery Function State Consistency

**Problem**: `recovery` removes `ForceExit` but doesn't validate state consistency

**Current State**:

- Admin can cancel any force-exit
- No check if cancellation is safe
- No validation of deposit state after cancellation

**Invariant Violation**:

```
IF recovery(user) THEN Deposit[user] should be in consistent state
```

### Issue #5: TTL Expiry State Cleanup

**Problem**: TTL expiry can leave inconsistent state

**Current State**:

- `ForceExit` has TTL of ~50 hours
- `Deposit` has TTL of ~7 days
- If `ForceExit` expires but `Deposit` remains, user is stuck

**Invariant Violation**:

```
IF ForceExit TTL expires THEN user should have recovery path
```

## Formal Invariant Definitions

### Invariant 1: Mutual Exclusivity of User States

```
For all users u:
  - Exactly one of: Deposit[u] exists, ForceExit[u] exists, or neither
  - NOT (Deposit[u] exists AND ForceExit[u] exists)
```

### Invariant 2: Backend Status Safety

```
When BackendOnline transitions from true to false:
  - No pending deposits should be in progress
  - No pending withdrawals should be in progress
  - All users should have clear path to force_exit

When BackendOnline transitions from false to true:
  - No pending force_exit requests should exist
  - System should be in stable state
```

### Invariant 3: Upgrade Window State Freeze

```
When PendingUpgrade exists:
  - New deposits should be blocked OR clearly marked
  - Backend status changes should be restricted
  - Emergency recovery should remain available
```

### Invariant 4: Balance Non-Negativity

```
For all users u:
  - Deposit[u] >= 0 (always)
  - ForceExit[u].amount >= 0 (always)
  - Total contract balance >= sum(Deposit[u]) + sum(ForceExit[u].amount)
```

### Invariant 5: Recovery State Consistency

```
When recovery(user) is called:
  - Deposit[user] should equal ForceExit[user].amount
  - After recovery, ForceExit[user] should not exist
  - Deposit[user] should remain unchanged
```

### Invariant 6: TTL Expiry Safety

```
When ForceExit[u] expires:
  - User should be able to request new force_exit
  - Deposit[u] should remain intact
  - System should provide clear recovery path
```

## Proposed Implementation

### 1. State Machine for User Accounts

```
States: IDLE, DEPOSITED, FORCE_EXIT_PENDING, FORCE_EXIT_READY

Transitions:
  IDLE -> DEPOSITED: deposit()
  DEPOSITED -> IDLE: withdrawal()
  DEPOSITED -> FORCE_EXIT_PENDING: force_exit_request()
  FORCE_EXIT_PENDING -> FORCE_EXIT_READY: time passes
  FORCE_EXIT_READY -> IDLE: force_exit_complete()
  FORCE_EXIT_PENDING -> DEPOSITED: recovery()
```

### 2. Backend Status Transition Guards

```rust
pub fn set_backend_status(env: Env, online: bool) {
    let admin = Self::get_admin(&env);
    admin.require_auth();

    if !online {
        // Transition to offline: ensure no pending operations
        Self::assert_no_pending_operations(&env);
    } else {
        // Transition to online: ensure no stuck force exits
        Self::assert_no_pending_force_exits(&env);
    }

    env.storage().instance().set(&DataKey::BackendOnline, &online);
}
```

### 3. Upgrade Window Restrictions

```rust
pub fn propose_upgrade(env: Env, new_wasm_hash: BytesN<32>) {
    let admin = Self::get_admin(&env);
    admin.require_auth();

    // Freeze critical state changes during upgrade window
    env.storage().instance().set(&DataKey::UpgradeMode, &true);

    let unlock_ledger = env.ledger().sequence() + TIMELOCK_LEDGERS;
    let pending = PendingUpgrade { new_wasm_hash, unlock_ledger };
    env.storage().instance().set(&DataKey::PendingUpgrade, &pending);
}
```

### 4. Invariant Testing Framework

```rust
#[cfg(test)]
mod invariant_tests {
    use super::*;

    #[test]
    fn test_mutual_exclusivity_invariant() {
        // Test that Deposit and ForceExit cannot coexist
    }

    #[test]
    fn test_balance_non_negativity() {
        // Test that balances never go negative
    }

    #[test]
    fn test_backend_transition_safety() {
        // Test safe backend status transitions
    }

    #[test]
    fn test_upgrade_window_state_freeze() {
        // Test state restrictions during upgrade
    }
}
```

## Testing Strategy

### Property-Based Tests

1. **State Machine Properties**: Verify all valid state transitions
2. **Balance Conservation**: Total balance invariant under all operations
3. **TTL Safety**: State remains consistent after TTL expiry
4. **Recovery Safety**: Recovery operations maintain invariants

### Integration Tests

1. **Backend Toggle Scenarios**: Test various backend status change sequences
2. **Upgrade Window Tests**: Verify upgrade mode restrictions
3. **Emergency Recovery Tests**: Test admin recovery under various states
4. **Concurrent Operation Tests**: Test race conditions between operations
