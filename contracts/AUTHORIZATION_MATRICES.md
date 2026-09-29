# Authorization Matrices - Soroban Contract Suite

This document defines the access control and authorization matrices for each contract in the Chen Pilot Soroban suite.

## Table of Contents
- [Authorization Overview](#authorization-overview)
- [RBAC Authorization](#rbac-authorization)
- [BTC Relay Authorization](#btc-relay-authorization)
- [Multi-Hop Swap Authorization](#multi-hop-swap-authorization)
- [Flash Loan Guard Authorization](#flash-loan-guard-authorization)
- [Core Vault Authorization](#core-vault-authorization)
- [Fee Distribution Authorization](#fee-distribution-authorization)
- [HTLC Authorization](#htlc-authorization)
- [Intent Market Validator Authorization](#intent-market-validator-authorization)
- [Lending Liquidation Authorization](#lending-liquidation-authorization)
- [Liquidity Vault Authorization](#liquidity-vault-authorization)
- [PoR Validator Authorization](#por-validator-authorization)
- [Relayer Slashing Authorization](#relayer-slashing-authorization)
- [Strategy Registry Authorization](#strategy-registry-authorization)

---

## Authorization Overview

### RBAC System
The protocol uses a centralized RBAC contract for role-based access control:

**Roles**:
- `OracleProvider` - Can submit price feed updates
- `AgentOperator` - Can trigger agent tasks
- `EmergencyAdmin` - Can pause the system

**Super Admin**:
- Can grant/revoke any role
- Can transfer super admin privileges
- Has full control over RBAC system

### Authorization Patterns

#### Pattern 1: Admin-Only Functions
Functions that can only be called by the contract admin:
- Initialization
- Configuration updates
- Emergency functions

#### Pattern 2: Role-Based Functions
Functions that require specific roles:
- Price updates (OracleProvider)
- Agent operations (AgentOperator)
- Emergency pause (EmergencyAdmin)

#### Pattern 3: Public Functions
Functions that any authenticated user can call:
- Queries (read-only)
- User-initiated operations (swaps, deposits)
- Claims (with proper conditions)

#### Pattern 4: Owner-Only Functions
Functions that only the resource owner can call:
- Withdrawals
- Position management
- Strategy modifications

---

## RBAC Authorization

### Function Authorization Matrix

| Function | Caller Requirement | Auth Check | Description |
|----------|------------------|------------|-------------|
| `init` | Any (once) | None | Initialize contract |
| `grant_role` | Super Admin | `super_admin.require_auth()` | Grant role to address |
| `revoke_role` | Super Admin | `super_admin.require_auth()` | Revoke role from address |
| `has_role` | Public | None | Check if address has role |
| `transfer_admin` | Super Admin | `old_admin.require_auth()` | Transfer super admin |
| `submit_price` | OracleProvider | `caller.require_auth()` + role check | Submit price feed |
| `run_agent` | AgentOperator | `caller.require_auth()` + role check | Trigger agent task |
| `emergency_pause` | EmergencyAdmin | `caller.require_auth()` + role check | Pause system |

### Role Permissions Matrix

| Role | grant_role | revoke_role | transfer_admin | submit_price | run_agent | emergency_pause |
|------|------------|-------------|----------------|--------------|-----------|-----------------|
| Super Admin | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| OracleProvider | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| AgentOperator | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| EmergencyAdmin | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Public | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Cross-Contract Authorization

The RBAC contract is called by other contracts to verify roles:

```rust
// Example from other contracts
fn assert_role(env: &Env, addr: &Address, role: Role) {
    let rbac = RbacClient::new(&env, &RBAC_ADDRESS);
    if !rbac.has_role(addr, role) {
        panic!("unauthorized: missing role");
    }
}
```

### Security Considerations

1. **Super Admin Key Security**: Super admin private key must be securely managed (multi-sig recommended)
2. **Role Granting**: Only super admin can grant roles, preventing privilege escalation
3. **Role Revocation**: Only super admin can revoke roles, ensuring centralized control
4. **Admin Transfer**: Requires authentication of current admin, preventing unauthorized transfers
5. **Event Emission**: All role changes emit events for monitoring

---

## BTC Relay Authorization

### Function Authorization Matrix

| Function | Caller Requirement | Auth Check | Description |
|----------|------------------|------------|-------------|
| `initialize` | Any (once) | None | Initialize contract |
| `update_config` | Admin | `current.admin.require_auth()` | Update configuration |
| `verify_and_claim` | Public | None (with replay protection) | Verify SPV proof and claim |
| `is_claimed` | Public | None | Check if tx was claimed |
| `get_config` | Public | None | Get current config |

### Admin Permissions

| Action | Required Role | Description |
|--------|--------------|-------------|
| Initialize contract | None (one-time) | Sets initial config |
| Update admin | Admin | Can change admin address |
| Update wrapped_btc_token | Admin | Can change WBTC token |
| Update min_confirmations | Admin | Can change confirmation requirement |
| Update crypto_contract | Admin | Can change crypto contract address |

### Security Considerations

1. **Admin Key Compromise**: If admin key is compromised, attacker can:
   - Change config to lower confirmations
   - Redirect to malicious crypto contract
   - Change wrapped BTC token address
2. **Crypto Contract Immutability**: Crypto contract address should be carefully chosen as it handles all cryptographic verification
3. **Replay Protection**: Claimed transaction IDs prevent double-minting
4. **No Role-Based Access**: Uses direct admin control instead of RBAC (simpler model)

---

## Multi-Hop Swap Authorization

### Function Authorization Matrix

| Function | Caller Requirement | Auth Check | Description |
|----------|------------------|------------|-------------|
| `swap` | Public | `caller.require_auth()` | Execute multi-hop swap |
| `get_last_out` | Public | None | Get last swap output |

### Authorization Model

**Direct Authentication**: The contract uses direct caller authentication rather than role-based access:

```rust
pub fn swap(env: Env, caller: Address, hops: Vec<Hop>) -> Vec<HopResult> {
    caller.require_auth();  // Direct auth
    // ... swap logic
}
```

### Security Considerations

1. **No Admin Functions**: Contract is stateless (except for convenience storage)
2. **Pool Contract Trust**: Security depends on pool contracts being honest
3. **Slippage Protection**: User must set appropriate `min_amount_out`
4. **Token Flow**: Contract holds tokens only during swap execution
5. **No Persistent State**: Minimal attack surface due to statelessness

---

## Flash Loan Guard Authorization

### Function Authorization Matrix

| Function | Caller Requirement | Auth Check | Description |
|----------|------------------|------------|-------------|
| `initialize` | Public (once) | None | Initialize contract |
| `update_config` | Admin | `current.admin.require_auth()` | Update configuration |
| `record_snapshot` | Public | None (with circuit breaker) | Record price snapshot |
| `assert_price_safe` | Public | None (with validation) | Assert price is safe |
| `get_snapshot` | Public | None | Get current snapshot |
| `get_config` | Public | None | Get current config |
| `get_circuit_breaker` | Public | None | Get circuit breaker state |

### Admin Permissions

| Action | Required Role | Description |
|--------|--------------|-------------|
| Initialize contract | None (one-time) | Sets initial config |
| Update admin | Admin | Can change admin address |
| Update oracle | Admin | Can change price oracle |
| Update guarded_asset | Admin | Can change guarded asset |
| Update deviation thresholds | Admin | Can adjust protection parameters |
| Update timing parameters | Admin | Can adjust timing windows |
| Update circuit breaker | Admin | Can adjust circuit breaker settings |

### Circuit Breaker Authorization

The circuit breaker operates automatically based on price violations:

| Condition | Action | Authorization |
|-----------|--------|---------------|
| 3+ consecutive violations | Trigger CB | Automatic |
| Time window expired | Release CB | Automatic |
| CB active | Block snapshots | Automatic |
| CB active | Block price checks | Automatic |

### Security Considerations

1. **Admin Key Compromise**: If admin key is compromised, attacker can:
   - Disable protection by setting high thresholds
   - Change to malicious oracle
   - Adjust timing windows to allow manipulation
2. **Oracle Trust**: Security depends on oracle integrity
3. **Circuit Breaker**: Provides last line of defense even if admin is compromised
4. **No Role-Based Access**: Uses direct admin control
5. **Automatic Safeguards**: Circuit breaker operates independently of admin

---

## Core Vault Authorization

### Function Authorization Matrix

| Function | Caller Requirement | Auth Check | Description |
|----------|------------------|------------|-------------|
| `initialize` | Public (once) | None | Initialize vault |
| `update_config` | Admin | `admin.require_auth()` | Update configuration |
| `deposit` | Public | `caller.require_auth()` | Deposit collateral |
| `withdraw` | Owner | `owner.require_auth()` | Withdraw collateral |
| `borrow` | Public | `caller.require_auth()` + collateral check | Borrow against collateral |
| `repay` | Public | `caller.require_auth()` | Repay debt |
| `liquidate` | Public | `caller.require_auth()` + liquidation check | Liquidate position |
| `get_position` | Public | None | Get user position |
| `get_config` | Public | None | Get vault config |

### Admin Permissions

| Action | Required Role | Description |
|--------|--------------|-------------|
| Initialize vault | None (one-time) | Sets initial config |
| Update admin | Admin | Can change admin address |
| Update collateral_token | Admin | Can change collateral asset |
| Update debt_token | Admin | Can change debt asset |
| Update collateral_factor | Admin | Can adjust collateral requirements |
| Update liquidation_threshold | Admin | Can adjust liquidation trigger |
| Update interest_rate | Admin | Can adjust interest rate |

### User Permissions

| Action | Required Condition | Description |
|--------|-------------------|-------------|
| Deposit | Authenticated caller | Deposit collateral |
| Withdraw | Owner + sufficient collateral | Withdraw collateral |
| Borrow | Authenticated + sufficient collateral | Borrow against collateral |
| Repay | Authenticated + debt exists | Repay outstanding debt |
| Liquidate | Authenticated + position unhealthy | Liquidate unhealthy position |

### Security Considerations

1. **Admin Key Compromise**: If admin key is compromised, attacker can:
   - Change collateral factor to allow under-collateralized borrowing
   - Change liquidation threshold to prevent liquidations
   - Change interest rate to extreme values
2. **Collateral Security**: Withdrawals ensure sufficient collateral remains
3. **Liquidation Access**: Public liquidation ensures market can liquidate bad debt
4. **Interest Rate**: Should be governed or have limits to prevent predatory rates
5. **Oracle Integration**: Depends on accurate price oracles for collateral ratios

---

## Fee Distribution Authorization

### Function Authorization Matrix

| Function | Caller Requirement | Auth Check | Description |
|----------|------------------|------------|-------------|
| `initialize` | Public (once) | None | Initialize distribution |
| `update_config` | Admin | `admin.require_auth()` | Update configuration |
| `distribute` | Admin | `admin.require_auth()` | Distribute accumulated fees |
| `claim` | Recipient | `recipient.require_auth()` | Claim fee share |
| `add_recipient` | Admin | `admin.require_auth()` | Add fee recipient |
| `remove_recipient` | Admin | `admin.require_auth()` | Remove recipient |
| `get_pool_balance` | Public | None | Get fee pool balance |
| `get_config` | Public | None | Get distribution config |

### Admin Permissions

| Action | Required Role | Description |
|--------|--------------|-------------|
| Initialize distribution | None (one-time) | Sets initial config |
| Update admin | Admin | Can change admin address |
| Update fee_token | Admin | Can change fee token |
| Update distribution_interval | Admin | Can change distribution frequency |
| Add recipient | Admin | Add address to recipient list |
| Remove recipient | Admin | Remove address from recipient list |
| Distribute fees | Admin | Trigger fee distribution |

### Recipient Permissions

| Action | Required Condition | Description |
|--------|-------------------|-------------|
| Claim fees | Listed recipient | Claim accumulated fees |

### Security Considerations

1. **Admin Key Compromise**: If admin key is compromised, attacker can:
   - Add themselves as recipient
   - Remove legitimate recipients
   - Distribute fees to themselves
2. **Recipient Validation**: Should whitelist recipients or use governance
3. **Distribution Frequency**: Should have reasonable limits to prevent draining
4. **Claim Validation**: Only whitelisted recipients can claim
5. **Event Emission**: All distributions should emit events for transparency

---

## HTLC Authorization

### Function Authorization Matrix

| Function | Caller Requirement | Auth Check | Description |
|----------|------------------|------------|-------------|
| `initialize` | Public (once) | None | Initialize HTLC |
| `claim` | Receiver | `receiver.require_auth()` + hash check | Claim with preimage |
| `refund` | Sender | `sender.require_auth()` + time check | Refund after timeout |
| `get_state` | Public | None | Get contract state |

### Authorization Model

**Dual-Party Authorization**: HTLC uses a two-party model:

```rust
pub fn claim(env: Env, preimage: BytesN<32>) {
    // Only receiver can claim
    receiver.require_auth();
    // Must have valid preimage
    assert!(hash(preimage) == hash_lock);
}

pub fn refund(env: Env) {
    // Only sender can refund
    sender.require_auth();
    // Must be after time lock
    assert!(current_time >= time_lock);
}
```

### Security Considerations

1. **Preimage Security**: Preimage must be kept secret until claim
2. **Time Lock Expiration**: Refund only possible after time lock expires
3. **Hash Function**: SHA-256 should be used for hash lock
4. **No Admin Functions**: Contract is self-executing based on conditions
5. **Replay Protection**: Each contract instance is single-use

---

## Intent Market Validator Authorization

### Function Authorization Matrix

| Function | Caller Requirement | Auth Check | Description |
|----------|------------------|------------|-------------|
| `initialize` | Public (once) | None | Initialize validator |
| `update_config` | Admin | `admin.require_auth()` | Update configuration |
| `validate_intent` | Public | `caller.require_auth()` + signature check | Validate intent |
| `invalidate_intent` | Admin | `admin.require_auth()` | Invalidate intent |
| `get_intent_status` | Public | None | Get intent validation status |
| `get_config` | Public | None | Get validator config |

### Admin Permissions

| Action | Required Role | Description |
|--------|--------------|-------------|
| Initialize validator | None (one-time) | Sets initial config |
| Update admin | Admin | Can change admin address |
| Update max_intent_age | Admin | Can change intent age limit |
| Update allowed_intent_types | Admin | Can change allowed intent types |
| Invalidate intent | Admin | Manually invalidate intent |

### Security Considerations

1. **Admin Key Compromise**: If admin key is compromised, attacker can:
   - Invalidate legitimate intents
   - Change allowed intent types
   - Extend intent age limits
2. **Signature Verification**: Intents must have valid signatures
3. **Nonce Tracking**: Prevents replay attacks
4. **Intent Expiration**: Old intents cannot be validated
5. **Type Whitelist**: Only allowed intent types can be validated

---

## Lending Liquidation Authorization

### Function Authorization Matrix

| Function | Caller Requirement | Auth Check | Description |
|----------|------------------|------------|-------------|
| `initialize` | Public (once) | None | Initialize liquidator |
| `update_config` | Admin | `admin.require_auth()` | Update configuration |
| `liquidate` | Public | `caller.require_auth()` + health check | Liquidate position |
| `update_position` | Admin | `admin.require_auth()` | Update position state |
| `get_position` | Public | None | Get position state |
| `get_config` | Public | None | Get liquidator config |

### Admin Permissions

| Action | Required Role | Description |
|--------|--------------|-------------|
| Initialize liquidator | None (one-time) | Sets initial config |
| Update admin | Admin | Can change admin address |
| Update collateral_factor | Admin | Can adjust collateral requirements |
| Update liquidation_threshold | Admin | Can adjust liquidation trigger |
| Update liquidation_penalty | Admin | Can adjust penalty amount |
| Update liquidation_incentive | Admin | Can adjust liquidator reward |
| Update position | Admin | Manual position update (emergency) |

### Public Permissions

| Action | Required Condition | Description |
|--------|-------------------|-------------|
| Liquidate | Authenticated + unhealthy position | Liquidate under-collateralized position |

### Security Considerations

1. **Admin Key Compromise**: If admin key is compromised, attacker can:
   - Change liquidation threshold to prevent liquidations
   - Change liquidation penalty/incentive to manipulate economics
   - Manually update positions to unhealthy state
2. **Public Liquidation**: Anyone can liquidate unhealthy positions (MEV risk)
3. **Liquidation Incentive**: Must be sufficient to incentivize prompt liquidation
4. **Oracle Dependency**: Depends on accurate price oracles for health checks
5. **Emergency Update**: Manual position update should have governance oversight

---

## Liquidity Vault Authorization

### Function Authorization Matrix

| Function | Caller Requirement | Auth Check | Description |
|----------|------------------|------------|-------------|
| `initialize` | Public (once) | None | Initialize vault |
| `update_config` | Admin | `admin.require_auth()` | Update configuration |
| `add_liquidity` | Public | `caller.require_auth()` | Add liquidity to pool |
| `remove_liquidity` | LP | `lp.require_auth()` | Remove liquidity from pool |
| `swap` | Public | `caller.require_auth()` | Swap tokens in pool |
| `get_pool_state` | Public | None | Get pool reserves |
| `get_user_liquidity` | Public | None | Get user LP balance |
| `get_config` | Public | None | Get vault config |

### Admin Permissions

| Action | Required Role | Description |
|--------|--------------|-------------|
| Initialize vault | None (one-time) | Sets initial config |
| Update admin | Admin | Can change admin address |
| Update fee_bps | Admin | Can change swap fee |
| Add new pool | Admin | Can create new pool |
| Remove pool | Admin | Can remove pool |

### User Permissions

| Action | Required Condition | Description |
|--------|-------------------|-------------|
| Add liquidity | Authenticated + token approval | Deposit tokens to pool |
| Remove liquidity | LP token holder | Withdraw tokens from pool |
| Swap | Authenticated + token approval | Swap tokens in pool |

### Security Considerations

1. **Admin Key Compromise**: If admin key is compromised, attacker can:
   - Change swap fee to extreme values
   - Remove pools (trap liquidity)
   - Add malicious pools
2. **LP Token Ownership**: Only LP token holders can remove liquidity
3. **Slippage Protection**: Users must set appropriate slippage tolerance
4. **Constant Product**: Mathematical formula prevents drain attacks
5. **Pool State**: TTL ensures inactive pools expire

---

## PoR Validator Authorization

### Function Authorization Matrix

| Function | Caller Requirement | Auth Check | Description |
|----------|------------------|------------|-------------|
| `initialize` | Public (once) | None | Initialize validator |
| `update_config` | Admin | `admin.require_auth()` | Update configuration |
| `submit_proof` | Validator | `validator.require_auth()` + signature check | Submit proof of reserve |
| `invalidate_proof` | Admin | `admin.require_auth()` | Invalidate proof |
| `get_last_proof` | Public | None | Get last valid proof |
| `get_proof_history` | Public | None | Get proof history |
| `get_config` | Public | None | Get validator config |

### Admin Permissions

| Action | Required Role | Description |
|--------|--------------|-------------|
| Initialize validator | None (one-time) | Sets initial config |
| Update admin | Admin | Can change admin address |
| Update max_staleness | Admin | Can change staleness tolerance |
| Update required_signers | Admin | Can change signature requirements |
| Invalidate proof | Admin | Manually invalidate proof |

### Validator Permissions

| Action | Required Condition | Description |
|--------|-------------------|-------------|
| Submit proof | Authorized validator + valid signature | Submit reserve proof |

### Security Considerations

1. **Admin Key Compromise**: If admin key is compromised, attacker can:
   - Invalidate legitimate proofs
   - Change staleness requirements
   - Change signature requirements
2. **Validator Authorization**: Only authorized validators can submit proofs
3. **Signature Verification**: Proofs must have valid signatures
4. **Freshness Check**: Stale proofs are rejected
5. **Balance Verification**: Reported balance must match on-chain balance

---

## Relayer Slashing Authorization

### Function Authorization Matrix

| Function | Caller Requirement | Auth Check | Description |
|----------|------------------|------------|-------------|
| `initialize` | Public (once) | None | Initialize slashing |
| `update_config` | Admin | `admin.require_auth()` | Update configuration |
| `bond` | Public | `caller.require_auth()` | Bond relayer stake |
| `unbond` | Relayer | `relayer.require_auth()` + unbonding period | Unbond stake |
| `slash` | Public | `caller.require_auth()` + violation check | Slash relayer |
| `get_relayer_stake` | Public | None | Get relayer stake |
| `get_slash_record` | Public | None | Get slash record |
| `get_config` | Public | None | Get slashing config |

### Admin Permissions

| Action | Required Role | Description |
|--------|--------------|-------------|
| Initialize slashing | None (one-time) | Sets initial config |
| Update admin | Admin | Can change admin address |
| Update slash_percentage | Admin | Can change slash amount |
| Update min_stake | Admin | Can change minimum stake |
| Manual slash | Admin | Can slash without violation check (emergency) |

### Relayer Permissions

| Action | Required Condition | Description |
|--------|-------------------|-------------|
| Bond | Authenticated + sufficient funds | Bond relayer stake |
| Unbond | Relayer + unbonding period passed | Unbond relayer stake |

### Public Permissions

| Action | Required Condition | Description |
|--------|-------------------|-------------|
| Slash | Authenticated + violation detected | Slash relayer stake |

### Security Considerations

1. **Admin Key Compromise**: If admin key is compromised, attacker can:
   - Change slash percentage to 100% (drain all stakes)
   - Change minimum stake to prevent bonding
   - Manually slash honest relayers
2. **Slash Validation**: Slashing requires violation detection
3. **Unbonding Period**: Prevents immediate exit after violation
4. **Stake Limits**: Minimum stake ensures skin in the game
5. **Emergency Slash**: Manual slash should have governance oversight

---

## Strategy Registry Authorization

### Function Authorization Matrix

| Function | Caller Requirement | Auth Check | Description |
|----------|------------------|------------|-------------|
| `initialize` | Public (once) | None | Initialize registry |
| `update_config` | Admin | `admin.require_auth()` | Update configuration |
| `register_strategy` | Public | `caller.require_auth()` | Register new strategy |
| `update_strategy` | Owner | `owner.require_auth()` | Update strategy metadata |
| `deregister_strategy` | Owner | `owner.require_auth()` | Deregister strategy |
| `approve_strategy` | Admin | `admin.require_auth()` | Approve strategy |
| `revoke_approval` | Admin | `admin.require_auth()` | Revoke strategy approval |
| `get_strategy` | Public | None | Get strategy info |
| `get_performance` | Public | None | Get strategy performance |
| `get_config` | Public | None | Get registry config |

### Admin Permissions

| Action | Required Role | Description |
|--------|--------------|-------------|
| Initialize registry | None (one-time) | Sets initial config |
| Update admin | Admin | Can change admin address |
| Update max_strategies | Admin | Can change strategy limit |
| Approve strategy | Admin | Approve strategy for use |
| Revoke approval | Admin | Revoke strategy approval |

### Strategy Owner Permissions

| Action | Required Condition | Description |
|--------|-------------------|-------------|
| Register strategy | Authenticated | Register new strategy |
| Update strategy | Strategy owner | Update strategy metadata |
| Deregister strategy | Strategy owner | Remove strategy from registry |

### Security Considerations

1. **Admin Key Compromise**: If admin key is compromised, attacker can:
   - Approve malicious strategies
   - Revoke legitimate strategy approvals
   - Change strategy limits
2. **Strategy Approval**: Only approved strategies can be used
3. **Owner Control**: Strategy owners control their strategy metadata
4. **Performance Tracking**: Performance metrics are trustlessly tracked
5. **Strategy Limits**: Maximum strategy count prevents registry bloat

---

## Cross-Contract Authorization

### Contract-to-Contract Calls

Several contracts make cross-contract calls that require authorization:

| Caller Contract | Called Contract | Authorization Method |
|-----------------|-----------------|---------------------|
| BTC Relay | BTC Relay Crypto | Contract address in config |
| Flash Loan Guard | Price Oracle | Contract address in config |
| Multi-Hop Swap | Pool Contracts | Pool addresses in hop parameters |
| All Contracts | RBAC | Role verification via contract call |

### Authorization Flow

```
User → Contract A → Contract B (with auth)
                    ↓
                RBAC (role check)
```

### Security Considerations

1. **Contract Address Immutability**: Called contract addresses should be immutable or require admin approval
2. **Role Verification**: Cross-contract calls should verify roles via RBAC
3. **Nested Call Authorization**: Atomic execution prevents reentrancy but does not protect against confused-deputy reuse; authorization must be bound to the exact immediate invocation
4. **Interface Compliance**: Called contracts must implement expected interfaces

### Nested Invocation Authorization Model

Soroban authentication authorizes only the immediate invocation of a contract function using the caller's signature. Nested invocation paths are modeled as `User -> Contract A -> Contract B -> Contract C`, with each hop evaluated only at the exact `require_auth()` boundary. A privileged entry point must not assume that the direct caller is the originator or that an authorization tree created for one call graph is valid for another. Every privileged cross-contract call binds the exact contract ID, function name, argument hash, and nonce where applicable.

#### Trust Assumptions per Privileged Cross-Contract Call

| Caller Contract | Called Contract | Trust Assumption |
|-----------------|-----------------|------------------|
| BTC Relay | BTC Relay Crypto | Cryptography contract is immutable and only verifies SPV proofs; admin replacement is a governed action |
| Flash Loan Guard | Price Oracle | Oracle is honest and exactly the configured address; nested calls cannot substitute another oracle |
| Multi-Hop Swap | Pool Contracts | Pool addresses in hop parameters are user-approved and invariant during nested execution |
| All Contracts | RBAC | RBAC address is fixed after initialization and role checks use authenticated caller identity, not `env.caller()` |

#### Exact Authorization Binding

Privileged functions must authenticate with `require_auth()` using the full invocation context. The authorization payload implicitly or explicitly includes:

- **Contract**: the contract ID of the privileged entry point
- **Function**: the exact function name being invoked
- **Arguments**: the full encoded argument vector of that invocation
- **Nonce**: the caller's current nonce, where required by the Soroban account/contract authorization framework

This binding prevents an authorization produced for `swap` from being replayed on `withdraw`, and prevents a nested intermediary from re-authorizing the same payload against a different target.

#### Adversarial Intermediary-Contract Tests

The following adversarial tests must be included in the contract test suite:

1. A malicious intermediary contract invokes a privileged function with the victim's valid authorization payload; the call must fail unless the payload exactly matches the privileged entry point.
2. A malicious intermediary contract re-enters a privileged contract after a nested call; the authorization context must not be reused for a different function or arguments.
3. An authorization tree created for a direct call is submitted through a two-contract nested path; the second contract must reject it if the contract ID or function does not match.
4. A relayer or agent contract forwards a user operation to a privileged entry point with additional arguments; the nested call must fail if the forwarded payload differs from the authenticated operation.
5. Nested invocation depth is varied from 0 to the protocol maximum; authorization invariants remain unchanged.

#### Security Invariants under Arbitrary Nesting Depth

- Invariant 1: For any privileged function `f` on contract `C`, `f` executes only if the immediate caller's authorization payload names exactly `C`, `f`, and the submitted arguments.
- Invariant 2: A valid authorization payload for one contract, function, or argument set cannot be used to authorize a different contract, function, or argument set, regardless of nesting depth.
- Invariant 3: A nested intermediary cannot extend, weaken, or re-target an authorization payload it did not create.
- Invariant 4: No privileged entry point relies on `env.caller()` as an identity claim for funds or roles; identity is always the authenticated `Address`.
- Invariant 5: Protocol nesting-depth limits are enforced by Soroban runtime; within those limits every invariant is proven by the exact-binding property above.

---

## Recommendations for Auditors

1. **Verify Auth Checks**: Ensure all privileged functions have proper `require_auth()` calls
2. **Check Role Validation**: Verify role-based access is properly implemented
3. **Review Admin Functions**: Ensure admin functions have appropriate safeguards
4. **Test Authorization**: Test unauthorized access attempts
5. **Review Event Emission**: Ensure all authorization changes emit events
6. **Check Cross-Contract Auth**: Verify cross-contract calls have proper authorization
7. **Review Emergency Functions**: Ensure emergency functions have appropriate controls
8. **Validate Permission Models**: Ensure permission models match contract requirements

---

## Conclusion

This authorization matrix provides a comprehensive view of access control across the Soroban contract suite. Key security considerations:

1. **Admin Key Security**: All admin keys should be multi-sig or governed
2. **Role-Based Access**: RBAC provides centralized authorization
3. **Public Functions**: Ensure public functions have appropriate safeguards
4. **Cross-Contract Calls**: Verify authorization across contract boundaries
5. **Event Emission**: All authorization changes should emit events

Any authorization issues should be addressed before deployment to ensure proper access control and security.
