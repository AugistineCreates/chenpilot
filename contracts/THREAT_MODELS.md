# Threat Models - Soroban Contract Suite

This document outlines the threat models for each contract in the Chen Pilot Soroban suite.

## Table of Contents
- [Common Threats](#common-threats)
- [BTC Relay](#btc-relay-threat-model)
- [RBAC](#rbac-threat-model)
- [Multi-Hop Swap](#multi-hop-swap-threat-model)
- [Flash Loan Guard](#flash-loan-guard-threat-model)
- [Core Vault](#core-vault-threat-model)
- [Fee Distribution](#fee-distribution-threat-model)
- [HTLC](#htlc-threat-model)
- [Intent Market Validator](#intent-market-validator-threat-model)
- [Lending Liquidation](#lending-liquidation-threat-model)
- [Liquidity Vault](#liquidity-vault-threat-model)
- [PoR Validator](#por-validator-threat-model)
- [Relayer Slashing](#relayer-slashing-threat-model)
- [Strategy Registry](#strategy-registry-threat-model)

---

## Common Threats

### 1. Reentrancy
**Description**: Attacker re-enters a contract during execution to manipulate state.

**Mitigation**:
- Soroban's atomic transaction model prevents reentrancy across contracts
- Follows-checks-effects pattern internally
- No external calls before state updates

### 2. Integer Overflow/Underflow
**Description**: Arithmetic operations exceed type bounds.

**Mitigation**:
- Rust's built-in overflow checks in debug mode
- Explicit `checked_*` arithmetic in critical paths
- Soroban SDK provides checked arithmetic

### 3. Access Control Bypass
**Description**: Unauthorized actor calls privileged functions.

**Mitigation**:
- RBAC contract provides centralized authorization
- `require_auth()` on all privileged operations
- Role-based permission checks

### 4. Storage Exhaustion
**Description**: Attacker fills storage to increase costs or cause denial of service.

**Mitigation**:
- TTL-based storage expiration
- Persistent storage limited to essential data
- Instance storage for configuration

### 5. Front-Running
**Description**: Attacker observes pending transactions and inserts their own.

**Mitigation**:
- Use of commit-reveal patterns where applicable
- Price snapshots with freshness checks
- Minimum time gaps between operations

---

## BTC Relay Threat Model

### Contract Purpose
Verifies Bitcoin SPV proofs to mint wrapped BTC on Stellar.

### Threat Vectors

#### T1: Invalid Block Header
**Description**: Attacker submits a malformed or fake Bitcoin block header.

**Impact**: False positive BTC deposits, unauthorized minting.

**Mitigation**:
- Validates block header length (exactly 80 bytes)
- Proof-of-work verification via double SHA-256
- Target extraction and hash comparison
- Delegated to btc_relay_crypto for heavy crypto

#### T2: Merkle Proof Spoofing
**Description**: Attacker provides fake Merkle proof claiming tx is in block.

**Impact**: Claiming BTC that doesn't exist, double-spending.

**Mitigation**:
- Merkle root extraction from block header
- Merkle proof reconstruction and verification
- Transaction index validation
- Delegated to btc_relay_crypto for Merkle computation

#### T3: Replay Attacks
**Description**: Attacker re-submits the same Bitcoin transaction multiple times.

**Impact**: Double-minting of wrapped BTC.

**Mitigation**:
- Claimed transaction IDs stored in persistent storage
- TTL of ~30 days for claimed records
- Check before processing new claims

#### T4: Insufficient Confirmations
**Description**: Attacker submits transaction from very recent block with low confirmations.

**Impact**: Chain reorganization risk, minting based on orphaned blocks.

**Mitigation**:
- Configurable `min_confirmations` parameter
- Merkle proof depth validation
- Minimum depth enforced by admin

#### T5: Crypto Sub-contract Compromise
**Description**: Attacker replaces or compromises btc_relay_crypto contract.

**Impact**: Can bypass all cryptographic verifications.

**Mitigation**:
- Crypto contract address immutable after initialization
- Only admin can update config (including crypto contract)
- Admin requires auth for config changes

#### T6: Admin Key Compromise
**Description**: Attacker gains control of admin private key.

**Impact**: Can change config, redirect wrapped BTC token, lower confirmations.

**Mitigation**:
- Admin key should be multi-sig
- Admin changes emit events for monitoring
- Consider timelock on critical config changes

---

## RBAC Threat Model

### Contract Purpose
Centralized role-based access control for protocol operations.

### Threat Vectors

#### T1: Super Admin Compromise
**Description**: Attacker gains control of super admin private key.

**Impact**: Can grant/revoke any role, transfer admin, control entire protocol.

**Mitigation**:
- Super admin should be multi-sig or governance-controlled
- Admin transfer emits events for monitoring
- Consider implementing timelock on admin transfer

#### T2: Unauthorized Role Grant
**Description**: Non-admin attempts to grant roles.

**Impact**: Privilege escalation, unauthorized access to protocol functions.

**Mitigation**:
- `require_auth()` on super admin for role operations
- Only super admin can call `grant_role` and `revoke_role`
- Role checks in all privileged functions

#### T3: Role Caching Attack
**Description**: Attacker exploits stale role information.

**Impact**: Unauthorized access if roles are cached off-chain.

**Mitigation**:
- Roles checked on-chain for every privileged operation
- No caching of role permissions
- Direct storage lookup for role verification

#### T4: Initialization Replay
**Description**: Attacker attempts to re-initialize the contract.

**Impact**: Could reset super admin to attacker-controlled address.

**Mitigation**:
- One-time initialization check
- Panic if already initialized
- Instance storage for initialization flag

---

## Multi-Hop Swap Threat Model

### Contract Purpose
Execute atomic multi-hop token swaps across liquidity pools.

### Threat Vectors

#### T1: Slippage Exploitation
**Description**: Attacker provides hops with unfavorable slippage causing loss.

**Impact**: User receives less than expected output.

**Mitigation**:
- `min_amount_out` parameter per hop
- Slippage validation after each swap
- Transaction reverts if slippage exceeded

#### T2: Token Drain Attack
**Description**: Malicious pool contract drains tokens during swap.

**Impact**: Loss of user funds.

**Mitigation**:
- Contract holds tokens only during swap execution
- Tokens transferred to pool, swap called, output returned
- No persistent token storage in contract

#### T3: Empty Hops Attack
**Description**: Attacker provides empty hop vector or invalid data.

**Impact**: Denial of service or unexpected behavior.

**Mitigation**:
- Validation that hops vector is non-empty
- Panic on empty hops
- Type safety through Rust/Soroban

#### T4: Pool Contract Compromise
**Description**: Attacker compromises a pool contract in the swap path.

**Impact**: Can steal tokens or manipulate swap results.

**Mitigation**:
- Pool contracts should be audited and verified
- Consider whitelisting approved pools
- Monitor pool contract addresses

#### T5: Reentrancy via Pool Call
**Description**: Malicious pool contract re-enters multi-hop swap.

**Impact**: State manipulation during swap execution.

**Mitigation**:
- Soroban's atomic transaction model prevents cross-contract reentrancy
- No external calls between state updates
- Follows checks-effects-effects pattern

---

## Flash Loan Guard Threat Model

### Contract Purpose
Protect against price manipulation attacks using flash loans.

### Threat Vectors

#### T1: Flash Loan Price Manipulation
**Description**: Attacker uses flash loan to manipulate oracle price, then trades.

**Impact**: Profit at expense of liquidity providers.

**Mitigation**:
- Price snapshot with TTL (~1 day)
- Intra-ledger price deviation check
- Oracle freshness validation
- Circuit breaker on consecutive violations

#### T2: Stale Oracle Data
**Description**: Attacker exploits outdated oracle prices.

**Impact**: Trading at incorrect prices.

**Mitigation**:
- Oracle staleness check (max_oracle_staleness_seconds)
- Oracle sequence monotonicity check
- Oracle update gap validation
- Snapshot TTL forces regular refresh

#### T3: Sequencing Attack
**Description**: Attacker submits oracle updates in malicious order.

**Impact**: Price manipulation through sequencing.

**Mitigation**:
- Oracle sequence must be strictly increasing
- Consecutive price change threshold
- Price history tracking (last 10 snapshots)
- Circuit breaker on rapid changes

#### T4: Timing Edge Attack
**Description**: Attacker exploits timing between snapshot and validation.

**Impact**: Bypasses price safety checks.

**Mitigation**:
- Minimum ledger gap between snapshots
- Maximum oracle update gap
- Same-ledger snapshot rejection
- Time-based validation windows

#### T5: Circuit Breaker Bypass
**Description**: Attacker attempts to trade during circuit breaker activation.

**Impact**: Continued manipulation despite safeguards.

**Mitigation**:
- Circuit breaker state checked before snapshot
- Auto-release after time window
- Consecutive violation counting
- Panic on circuit breaker active

#### T6: Oracle Compromise
**Description**: Attacker compromises the price oracle.

**Impact**: Can submit arbitrary prices.

**Mitigation**:
- Oracle should be decentralized and robust
- Multiple oracle sources recommended
- Circuit breaker provides last line of defense
- Consider implementing oracle reputation system

---

## Core Vault Threat Model

### Contract Purpose
Centralized vault for asset custody and lending operations.

### Threat Vectors

#### T1: Unauthorized Withdrawal
**Description**: Attacker withdraws assets without proper authorization.

**Impact**: Loss of vault assets.

**Mitigation**:
- RBAC-based withdrawal authorization
- Multi-sig requirement for large withdrawals
- Withdrawal limits and time locks
- Event emission for all withdrawals

#### T2: Insufficient Collateral
**Description**: Borrower withdraws more than collateral allows.

**Impact**: Under-collateralized positions, bad debt.

**Mitigation**:
- Collateral ratio checks before withdrawal
- Real-time price oracle integration
- Liquidation mechanism for under-collateralized positions
- Conservative collateral factors

#### T3: Asset Drain via Borrow
**Description**: Attacker borrows without repayment intent.

**Impact**: Bad debt in vault.

**Mitigation**:
- Borrow limits per user
- Over-collateralization requirements
- Interest accumulation on borrows
- Liquidation for under-collateralized positions

---

## Fee Distribution Threat Model

### Contract Purpose
Distribute protocol fees to designated recipients.

### Threat Vectors

#### T1: Fee Theft
**Description**: Attacker redirects fees to their own address.

**Impact**: Loss of protocol revenue.

**Mitigation**:
- Admin-controlled recipient addresses
- RBAC for fee distribution configuration
- Event emission for all distributions
- Consider governance for recipient changes

#### T2: Double Distribution
**Description**: Attacker claims fees multiple times.

**Impact**: Over-payment, fee pool depletion.

**Mitigation**:
- Claim tracking with nonces or timestamps
- One-time claim validation
- Fee pool balance checks

---

## HTLC Threat Model

### Contract Purpose
Hashed timelock contracts for atomic cross-chain swaps.

### Threat Vectors

#### T1: Preimage Theft
**Description**: Attacker discovers preimage before intended recipient.

**Impact**: Funds stolen by attacker.

**Mitigation**:
- Secure hash function (SHA-256)
- Random preimage generation
- Short claim window to limit exposure
- Consider using hash locks with additional entropy

#### T2: Refund Failure
**Description**: Legitimate refund fails due to bugs or state issues.

**Impact**: Funds locked indefinitely.

**Mitigation**:
- Clear refund conditions
- Time lock expiration validation
- Emergency admin rescue function
- Comprehensive testing of refund logic

#### T3: Replay Attack
**Description**: Attacker reuses preimage from previous contract.

**Impact**: Unauthorized claim.

**Mitigation**:
- Unique hash per contract instance
- Nonce or random value in hash computation
- One-time use preimage validation

---

## Intent Market Validator Threat Model

### Contract Purpose
Validate market intent operations for DeFi transactions.

### Threat Vectors

#### T1: Invalid Intent
**Description**: Attacker submits malformed or malicious intent.

**Impact**: Invalid transactions executed.

**Mitigation**:
- Intent schema validation
- Signature verification
- Intent nonce tracking
- Whitelist of valid intent types

#### T2: Intent Replay
**Description**: Attacker re-submits the same intent multiple times.

**Impact**: Duplicate transactions.

**Mitigation**:
- Intent nonce or timestamp validation
- Used intent tracking
- Expiration on intents

---

## Lending Liquidation Threat Model

### Contract Purpose
Liquidate under-collateralized lending positions.

### Threat Vectors

#### T1: Invalid Liquidation
**Description**: Attacker liquidates healthy positions.

**Impact**: Loss for position holder.

**Mitigation**:
- Collateral ratio threshold checks
- Real-time price oracle integration
- Liquidation only when ratio below threshold
- Event emission for all liquidations

#### T2: Liquidator Front-Running
**Description**: Attacker front-runs liquidation opportunities.

**Impact**: MEV extraction, reduced liquidation efficiency.

**Mitigation**:
- Consider commit-reveal for liquidation
- Liquidation rewards to incentivize prompt action
- Batch liquidations to reduce opportunities

#### T3: Insufficient Collateral Sale
**Description**: Liquidation doesn't cover debt.

**Impact**: Bad debt in system.

**Mitigation**:
- Conservative liquidation thresholds
- Over-collateralization requirements
- Insurance fund for shortfalls
- Protocol treasury backstop

---

## Liquidity Vault Threat Model

### Contract Purpose
Manage liquidity pools for token swaps.

### Threat Vectors

#### T1: Liquidity Drain
**Description**: Attacker drains liquidity from pool.

**Impact**: Loss of LP funds.

**Mitigation**:
- Withdrawal limits and time locks
- Multi-sig for large withdrawals
- LP token ownership validation
- Emergency pause mechanism

#### T2: Invalid Swap
**Description**: Attacker manipulates swap calculations.

**Impact**: Incorrect swap execution, loss of funds.

**Mitigation**:
- Constant product formula validation
- Slippage protection
- Reserve balance checks
- Mathematical overflow protection

#### T3: Mint/Replay Attack
**Description**: Attacker mints LP tokens without deposit.

**Impact**: Dilution of existing LPs.

**Mitigation**:
- Deposit validation before mint
- LP token supply tracking
- Reserve balance verification

---

## PoR Validator Threat Model

### Contract Purpose
Validate proof of reserve for custodial assets.

### Threat Vectors

#### T1: False Proof of Reserve
**Description**: Attacker submits fake reserve proof.

**Impact**: False sense of security, potential insolvency.

**Mitigation**:
- Cryptographic signature verification
- Merkle proof validation
- Reserve balance verification
- Regular audit requirements

#### T2: Stale Reserve Data
**Description**: Attacker uses outdated reserve data.

**Impact**: Misleading reserve status.

**Mitigation**:
- Timestamp validation on proofs
- Maximum staleness tolerance
- Freshness requirements
- Event emission for proof updates

---

## Relayer Slashing Threat Model

### Contract Purpose
Slash relayers for misbehavior or protocol violations.

### Threat Vectors

#### T1: False Slashing
**Description**: Attacker falsely reports relayer misbehavior.

**Impact**: Unjustified slashing of honest relayers.

**Mitigation**:
- Evidence requirements for slashing
- Challenge period for disputes
- Multi-sig or governance approval
- Slashing appeal mechanism

#### T2: Slashing Bypass
**Description**: Relayer avoids slashing despite misbehavior.

**Impact**: Protocol security compromised.

**Mitigation**:
- Automated slashing conditions
- Monitoring and detection systems
- Clear slashing criteria
- Immutable slashing rules

---

## Strategy Registry Threat Model

### Contract Purpose
Register and manage investment strategies.

### Threat Vectors

#### T1: Malicious Strategy
**Description**: Attacker registers malicious strategy.

**Impact**: Funds lost to malicious strategy.

**Mitigation**:
- Strategy approval process
- Strategy code audit requirements
- Strategy performance tracking
- Strategy removal mechanism

#### T2: Strategy Spoofing
**Description**: Attacker impersonates legitimate strategy.

**Impact**: Users deceived into using fake strategy.

**Mitigation**:
- Strategy signature verification
- Strategy metadata validation
- Whitelist of approved strategies
- Strategy reputation system

---

## Conclusion

This threat model document identifies the primary attack vectors for each contract in the Soroban suite. Mitigation strategies are implemented in the contract code, but ongoing monitoring and governance are essential for long-term security.

### Recommendations for Auditors

1. Verify all access control checks are properly implemented
2. Validate arithmetic operations use checked arithmetic
3. Ensure storage TTLs are appropriate for data sensitivity
4. Review event emission for completeness and accuracy
5. Test edge cases and boundary conditions
6. Verify cross-contract call safety
7. Validate oracle integration and fallback mechanisms
8. Review emergency mechanisms and admin functions
