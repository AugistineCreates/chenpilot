# Storage Maps - Soroban Contract Suite

This document details the storage layout and data structures for each contract in the Chen Pilot Soroban suite.

## Table of Contents
- [Storage Overview](#storage-overview)
- [BTC Relay Storage](#btc-relay-storage)
- [RBAC Storage](#rbac-storage)
- [Multi-Hop Swap Storage](#multi-hop-swap-storage)
- [Flash Loan Guard Storage](#flash-loan-guard-storage)
- [Core Vault Storage](#core-vault-storage)
- [Fee Distribution Storage](#fee-distribution-storage)
- [HTLC Storage](#htlc-storage)
- [Intent Market Validator Storage](#intent-market-validator-storage)
- [Lending Liquidation Storage](#lending-liquidation-storage)
- [Liquidity Vault Storage](#liquidity-vault-storage)
- [PoR Validator Storage](#por-validator-storage)
- [Relayer Slashing Storage](#relayer-slashing-storage)
- [Strategy Registry Storage](#strategy-registry-storage)

---

## Storage Overview

### Storage Types in Soroban
- **Instance Storage**: Permanent, contract-wide data (config, constants)
- **Persistent Storage**: Long-lived data with optional TTL
- **Temporary Storage**: Ephemeral data for current transaction

### TTL Strategy
- **Configuration**: No TTL (permanent)
- **Claimed/Used Records**: ~30 days (6,048,000 ledgers)
- **Price Snapshots**: ~1 day (172,800 ledgers)
- **Pool State**: ~30 days (6,048,000 ledgers)
- **Temporary Data**: Transaction lifetime

### Key Naming Conventions
- Enum-based keys for type safety
- Composite keys for indexed data
- Symbol shortcuts for common keys

---

## BTC Relay Storage

### Storage Keys

```rust
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    Claimed(BytesN<32>),
}
```

### Storage Layout

| Key | Type | Storage | TTL | Description |
|-----|------|---------|-----|-------------|
| `Config` | `Config` | Instance | None | Contract configuration |
| `Claimed(tx_id)` | `bool` | Persistent | 30 days | Transaction claim status |

### Data Structures

#### Config
```rust
pub struct Config {
    pub admin: Address,              // Contract admin
    pub wrapped_btc_token: Address,  // WBTC token address
    pub min_confirmations: u32,      // Required confirmations
    pub crypto_contract: Address,    // BTC crypto contract
}
```

#### SpvProof (Input)
```rust
pub struct SpvProof {
    pub block_header: Bytes,         // 80-byte Bitcoin header
    pub tx_id: BytesN<32>,          // Transaction ID
    pub merkle_proof: Vec<BytesN<32>>, // Merkle proof
    pub tx_index: u32,              // Transaction index
    pub amount_sat: i128,           // Amount in satoshis
    pub recipient: Address,          // Stellar recipient
}
```

### Storage Access Patterns

- **Read**: Config (every operation), Claimed (verification)
- **Write**: Config (admin only), Claimed (on successful claim)
- **TTL**: Claimed records expire after 30 days

### Storage Estimates

- **Config**: ~200 bytes (fixed)
- **Per Claim**: ~40 bytes (32-byte key + bool)
- **1000 Claims**: ~40 KB

---

## RBAC Storage

### Storage Keys

```rust
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    SuperAdmin,
    HasRole(Address, Role),
}
```

### Storage Layout

| Key | Type | Storage | TTL | Description |
|-----|------|---------|-----|-------------|
| `SuperAdmin` | `Address` | Instance | None | Super admin address |
| `HasRole(addr, role)` | `bool` | Persistent | None | Role assignment |

### Data Structures

#### Role
```rust
pub enum Role {
    OracleProvider,
    AgentOperator,
    EmergencyAdmin,
}
```

### Storage Access Patterns

- **Read**: SuperAdmin (admin operations), HasRole (authorization)
- **Write**: SuperAdmin (transfer), HasRole (grant/revoke)
- **TTL**: No TTL (permanent role assignments)

### Storage Estimates

- **SuperAdmin**: ~40 bytes (fixed)
- **Per Role**: ~80 bytes (composite key + bool)
- **100 Users × 3 Roles**: ~24 KB

---

## Multi-Hop Swap Storage

### Storage Keys

```rust
// Symbol-based key for last output
symbol_short!("last_out")
```

### Storage Layout

| Key | Type | Storage | TTL | Description |
|-----|------|---------|-----|-------------|
| `last_out` | `i128` | Instance | None | Last swap output amount |

### Data Structures

#### Hop (Input)
```rust
pub struct Hop {
    pub pool: Address,              // Pool contract address
    pub token_in: Address,          // Input token
    pub token_out: Address,         // Output token
    pub amount_in: i128,            // Input amount
    pub min_amount_out: i128,       // Minimum output
}
```

#### HopResult (Output)
```rust
pub struct HopResult {
    pub pool: Address,              // Pool contract
    pub token_in: Address,          // Input token
    pub token_out: Address,         // Output token
    pub amount_in: i128,            // Actual input
    pub amount_out: i128,           // Actual output
}
```

### Storage Access Patterns

- **Read**: last_out (query function)
- **Write**: last_out (after each swap)
- **TTL**: No TTL (convenience storage)

### Storage Estimates

- **last_out**: ~16 bytes (fixed)
- **No persistent storage per swap** (stateless execution)

---

## Flash Loan Guard Storage

### Storage Keys

```rust
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    LastSnapshotLedger,
    PriceSnapshot,
    OracleFreshness,
    PriceSequenceHistory,
    CircuitBreaker,
}
```

### Storage Layout

| Key | Type | Storage | TTL | Description |
|-----|------|---------|-----|-------------|
| `Config` | `Config` | Instance | None | Contract configuration |
| `PriceSnapshot` | `PriceSnapshot` | Instance | 1 day | Current price snapshot |
| `PriceSequenceHistory` | `Vec<PriceSnapshot>` | Instance | None | Last 10 snapshots |
| `CircuitBreaker` | `CircuitBreakerState` | Instance | None | Circuit breaker state |

### Data Structures

#### Config
```rust
pub struct Config {
    pub admin: Address,                          // Contract admin
    pub oracle: Address,                         // Price oracle
    pub guarded_asset: Address,                   // Asset to guard
    pub max_intra_ledger_deviation_bps: i128,     // Max deviation (basis points)
    pub min_ledger_gap: u32,                      // Min ledgers between snapshots
    pub max_oracle_staleness_seconds: u64,       // Max oracle staleness
    pub max_consecutive_price_change_bps: i128,  // Max consecutive change
    pub max_oracle_update_gap_seconds: u64,      // Max update gap
    pub circuit_breaker_threshold_bps: i128,      // CB trigger threshold
    pub circuit_breaker_window_seconds: u64,      // CB reset window
}
```

#### PriceSnapshot
```rust
pub struct PriceSnapshot {
    pub price: i128,              // Asset price
    pub ledger: u32,              // Snapshot ledger
    pub oracle_timestamp: u64,    // Oracle timestamp
    pub oracle_sequence: u64,     // Oracle sequence number
}
```

#### CircuitBreakerState
```rust
pub struct CircuitBreakerState {
    pub triggered: bool,          // Is CB active
    pub trigger_ledger: u32,      // Trigger ledger
    pub trigger_timestamp: u64,   // Trigger timestamp
    pub consecutive_violations: u32, // Violation count
}
```

### Storage Access Patterns

- **Read**: Config (every operation), PriceSnapshot (assert), CircuitBreaker (check)
- **Write**: Config (admin only), PriceSnapshot (record), CircuitBreaker (update)
- **TTL**: PriceSnapshot expires after 1 day

### Storage Estimates

- **Config**: ~200 bytes (fixed)
- **PriceSnapshot**: ~40 bytes (fixed)
- **PriceSequenceHistory**: ~400 bytes (10 × 40 bytes)
- **CircuitBreaker**: ~30 bytes (fixed)
- **Total**: ~670 bytes per contract

---

## Core Vault Storage

### Storage Keys

```rust
// Example structure (actual implementation may vary)
#[contracttype]
pub enum DataKey {
    Config,
    UserBalance(Address),
    TotalBorrows,
    TotalReserves,
}
```

### Storage Layout

| Key | Type | Storage | TTL | Description |
|-----|------|---------|-----|-------------|
| `Config` | `Config` | Instance | None | Vault configuration |
| `UserBalance(addr)` | `i128` | Persistent | None | User deposit balance |
| `TotalBorrows` | `i128` | Instance | None | Total outstanding borrows |
| `TotalReserves` | `i128` | Instance | None | Total reserve assets |

### Data Structures

#### Config
```rust
pub struct Config {
    pub admin: Address,              // Vault admin
    pub collateral_token: Address,   // Collateral asset
    pub debt_token: Address,         // Debt asset
    pub collateral_factor: i128,     // Collateral factor (bps)
    pub liquidation_threshold: i128, // Liquidation threshold (bps)
    pub interest_rate: i128,         // Interest rate (bps)
}
```

### Storage Access Patterns

- **Read**: Config (operations), UserBalance (queries), Totals (calculations)
- **Write**: Config (admin), UserBalance (deposits/withdraws), Totals (operations)
- **TTL**: No TTL (permanent accounting)

### Storage Estimates

- **Config**: ~150 bytes (fixed)
- **Per User**: ~80 bytes (address + balance)
- **1000 Users**: ~80 KB

---

## Fee Distribution Storage

### Storage Keys

```rust
// Example structure
#[contracttype]
pub enum DataKey {
    Config,
    FeePool,
    RecipientShare(Address),
    LastDistribution,
}
```

### Storage Layout

| Key | Type | Storage | TTL | Description |
|-----|------|---------|-----|-------------|
| `Config` | `Config` | Instance | None | Distribution config |
| `FeePool` | `i128` | Instance | None | Accumulated fees |
| `RecipientShare(addr)` | `i128` | Persistent | None | Recipient share |
| `LastDistribution` | `u64` | Instance | None | Last distribution time |

### Data Structures

#### Config
```rust
pub struct Config {
    pub admin: Address,              // Distribution admin
    pub fee_token: Address,          // Fee token
    pub distribution_interval: u64,  // Distribution interval
}
```

### Storage Access Patterns

- **Read**: Config (operations), FeePool (balance), RecipientShare (claims)
- **Write**: Config (admin), FeePool (accumulation), RecipientShare (distribution)
- **TTL**: No TTL (permanent accounting)

### Storage Estimates

- **Config**: ~100 bytes (fixed)
- **FeePool**: ~16 bytes (fixed)
- **Per Recipient**: ~80 bytes (address + share)
- **100 Recipients**: ~8 KB

---

## HTLC Storage

### Storage Keys

```rust
// Example structure
#[contracttype]
pub enum DataKey {
    ContractState,
}
```

### Storage Layout

| Key | Type | Storage | TTL | Description |
|-----|------|---------|-----|-------------|
| `ContractState` | `HTLCState` | Instance | None | HTLC contract state |

### Data Structures

#### HTLCState
```rust
pub struct HTLCState {
    pub sender: Address,            // Sender address
    pub receiver: Address,          // Receiver address
    pub hash_lock: BytesN<32>,      // Hash lock
    pub time_lock: u64,             // Time lock expiry
    pub amount: i128,               // Locked amount
    pub token: Address,             // Token address
    pub claimed: bool,              // Claim status
    pub refunded: bool,             // Refund status
}
```

### Storage Access Patterns

- **Read**: ContractState (all operations)
- **Write**: ContractState (claim/refund)
- **TTL**: No TTL (contract lifecycle)

### Storage Estimates

- **ContractState**: ~150 bytes (fixed)
- **Per Contract Instance**: ~150 bytes

---

## Intent Market Validator Storage

### Storage Keys

```rust
// Example structure
#[contracttype]
pub enum DataKey {
    Config,
    UsedNonce(BytesN<32>),
    IntentStatus(BytesN<32>),
}
```

### Storage Layout

| Key | Type | Storage | TTL | Description |
|-----|------|---------|-----|-------------|
| `Config` | `Config` | Instance | None | Validator config |
| `UsedNonce(nonce)` | `bool` | Persistent | 30 days | Used nonce tracking |
| `IntentStatus(intent_id)` | `IntentStatus` | Persistent | 7 days | Intent validation status |

### Data Structures

#### Config
```rust
pub struct Config {
    pub admin: Address,              // Validator admin
    pub max_intent_age: u64,         // Max intent age
    pub allowed_intent_types: Vec<Bytes>, // Allowed types
}
```

#### IntentStatus
```rust
pub struct IntentStatus {
    pub validated: bool,              // Validation status
    pub validated_at: u64,           // Validation timestamp
    pub validator: Address,          // Validator address
}
```

### Storage Access Patterns

- **Read**: Config (validation), UsedNonce (replay check), IntentStatus (query)
- **Write**: Config (admin), UsedNonce (validation), IntentStatus (validation)
- **TTL**: UsedNonce (30 days), IntentStatus (7 days)

### Storage Estimates

- **Config**: ~150 bytes (fixed)
- **Per Nonce**: ~40 bytes (32-byte key + bool)
- **Per Intent**: ~100 bytes (32-byte key + status)
- **1000 Intents**: ~100 KB

---

## Lending Liquidation Storage

### Storage Keys

```rust
// Example structure
#[contracttype]
pub enum DataKey {
    Config,
    Position(Address),
    LiquidationQueue,
}
```

### Storage Layout

| Key | Type | Storage | TTL | Description |
|-----|------|---------|-----|-------------|
| `Config` | `Config` | Instance | None | Liquidation config |
| `Position(addr)` | `Position` | Persistent | None | User position |
| `LiquidationQueue` | `Vec<Address>` | Instance | None | Liquidation queue |

### Data Structures

#### Config
```rust
pub struct Config {
    pub admin: Address,              // Liquidation admin
    pub collateral_factor: i128,     // Collateral factor
    pub liquidation_threshold: i128, // Liquidation threshold
    pub liquidation_penalty: i128,   // Liquidation penalty (bps)
    pub liquidation_incentive: i128, // Liquidator incentive (bps)
}
```

#### Position
```rust
pub struct Position {
    pub collateral: i128,            // Collateral amount
    pub debt: i128,                 // Debt amount
    pub last_update: u64,           // Last update time
    pub health_factor: i128,        // Health factor
}
```

### Storage Access Patterns

- **Read**: Config (operations), Position (liquidation check), Queue (processing)
- **Write**: Config (admin), Position (updates/liquidation), Queue (management)
- **TTL**: No TTL (permanent position tracking)

### Storage Estimates

- **Config**: ~150 bytes (fixed)
- **Per Position**: ~100 bytes (address + position data)
- **1000 Positions**: ~100 KB

---

## Liquidity Vault Storage

### Storage Keys

```rust
// Example structure
#[contracttype]
pub enum DataKey {
    Config,
    PoolState(Address, Address),    // (token_a, token_b)
    UserLiquidity(Address),
    TotalLiquidity,
}
```

### Storage Layout

| Key | Type | Storage | TTL | Description |
|-----|------|---------|-----|-------------|
| `Config` | `Config` | Instance | None | Vault config |
| `PoolState(a,b)` | `PoolState` | Instance | 30 days | Pool reserves |
| `UserLiquidity(addr)` | `i128` | Persistent | None | User LP tokens |
| `TotalLiquidity` | `i128` | Instance | None | Total LP supply |

### Data Structures

#### Config
```rust
pub struct Config {
    pub admin: Address,              // Vault admin
    pub fee_bps: i128,              // Swap fee (basis points)
}
```

#### PoolState
```rust
pub struct PoolState {
    pub reserve_a: i128,            // Token A reserve
    pub reserve_b: i128,            // Token B reserve
    pub last_update: u32,           // Last update ledger
    pub constant_product: i128,      // Constant product (k)
}
```

### Storage Access Patterns

- **Read**: Config (operations), PoolState (swaps), UserLiquidity (queries)
- **Write**: Config (admin), PoolState (swaps), UserLiquidity (mint/burn)
- **TTL**: PoolState (30 days - extends on activity)

### Storage Estimates

- **Config**: ~80 bytes (fixed)
- **Per Pool**: ~100 bytes (composite key + state)
- **Per User**: ~80 bytes (address + liquidity)
- **100 Pools × 1000 Users**: ~108 KB

---

## PoR Validator Storage

### Storage Keys

```rust
// Example structure
#[contracttype]
pub enum DataKey {
    Config,
    LastProof,
    ProofHistory,
}
```

### Storage Layout

| Key | Type | Storage | TTL | Description |
|-----|------|---------|-----|-------------|
| `Config` | `Config` | Instance | None | Validator config |
| `LastProof` | `ProofOfReserve` | Instance | None | Last valid proof |
| `ProofHistory` | `Vec<ProofOfReserve>` | Instance | None | Proof history |

### Data Structures

#### Config
```rust
pub struct Config {
    pub admin: Address,              // Validator admin
    pub max_staleness: u64,         // Max proof staleness
    pub required_signers: u32,       // Required signers
}
```

#### ProofOfReserve
```rust
pub struct ProofOfReserve {
    pub reserve_balance: i128,      // Reserve balance
    pub timestamp: u64,              // Proof timestamp
    pub signature: BytesN<64>,     // Signature
    pub validator: Address,          // Validator address
}
```

### Storage Access Patterns

- **Read**: Config (validation), LastProof (query), History (audit)
- **Write**: Config (admin), LastProof (validation), History (append)
- **TTL**: No TTL (audit trail)

### Storage Estimates

- **Config**: ~100 bytes (fixed)
- **Per Proof**: ~150 bytes (proof data)
- **100 Proofs**: ~15 KB

---

## Relayer Slashing Storage

### Storage Keys

```rust
// Example structure
#[contracttype]
pub enum DataKey {
    Config,
    RelayerStake(Address),
    SlashRecord(Address, u64),      // (relayer, violation_id)
    TotalSlashed,
}
```

### Storage Layout

| Key | Type | Storage | TTL | Description |
|-----|------|---------|-----|-------------|
| `Config` | `Config` | Instance | None | Slashing config |
| `RelayerStake(addr)` | `i128` | Persistent | None | Relayer stake |
| `SlashRecord(addr, id)` | `SlashRecord` | Persistent | None | Slash record |
| `TotalSlashed` | `i128` | Instance | None | Total slashed amount |

### Data Structures

#### Config
```rust
pub struct Config {
    pub admin: Address,              // Slashing admin
    pub slash_percentage: i128,     // Slash percentage (bps)
    pub min_stake: i128,            // Minimum stake
}
```

#### SlashRecord
```rust
pub struct SlashRecord {
    pub amount: i128,               // Slashed amount
    pub timestamp: u64,             // Slash timestamp
    pub reason: Bytes,              // Slash reason
}
```

### Storage Access Patterns

- **Read**: Config (operations), RelayerStake (check), SlashRecord (audit)
- **Write**: Config (admin), RelayerStake (bond/slash), SlashRecord (slashing)
- **TTL**: No TTL (permanent records)

### Storage Estimates

- **Config**: ~100 bytes (fixed)
- **Per Relayer**: ~80 bytes (address + stake)
- **Per Slash**: ~150 bytes (composite key + record)
- **100 Relayers × 10 Slashes**: ~1.5 KB

---

## Strategy Registry Storage

### Storage Keys

```rust
// Example structure
#[contracttype]
pub enum DataKey {
    Config,
    Strategy(BytesN<32>),            // Strategy ID
    StrategyPerformance(BytesN<32>),
    ApprovedStrategies,
}
```

### Storage Layout

| Key | Type | Storage | TTL | Description |
|-----|------|---------|-----|-------------|
| `Config` | `Config` | Instance | None | Registry config |
| `Strategy(id)` | `Strategy` | Persistent | None | Strategy metadata |
| `StrategyPerformance(id)` | `Performance` | Instance | None | Performance metrics |
| `ApprovedStrategies` | `Vec<BytesN<32>>` | Instance | None | Approved list |

### Data Structures

#### Config
```rust
pub struct Config {
    pub admin: Address,              // Registry admin
    pub max_strategies: u32,        // Max strategies
}
```

#### Strategy
```rust
pub struct Strategy {
    pub owner: Address,             // Strategy owner
    pub contract_address: Address,    // Strategy contract
    pub metadata: Bytes,            // Strategy metadata
    pub registered_at: u64,         // Registration time
}
```

#### Performance
```rust
pub struct Performance {
    pub total_returns: i128,        // Total returns
    pub total_volume: i128,         // Total volume
    pub win_rate: i128,             // Win rate (bps)
    pub last_updated: u64,          // Last update time
}
```

### Storage Access Patterns

- **Read**: Config (operations), Strategy (query), Performance (metrics)
- **Write**: Config (admin), Strategy (registration), Performance (updates)
- **TTL**: No TTL (permanent registry)

### Storage Estimates

- **Config**: ~80 bytes (fixed)
- **Per Strategy**: ~200 bytes (ID + metadata)
- **Per Performance**: ~80 bytes (metrics)
- **100 Strategies**: ~28 KB

---

## Storage Cost Estimates

### Per-Contract Storage Costs
Based on Soroban storage pricing (approximate):

| Contract | Instance Storage | Persistent Storage | Est. Monthly Cost |
|----------|-----------------|-------------------|-------------------|
| BTC Relay | ~240 bytes | ~40 KB (1000 claims) | ~$0.50 |
| RBAC | ~40 bytes | ~24 KB (100 users) | ~$0.30 |
| Multi-Hop Swap | ~16 bytes | 0 | ~$0.01 |
| Flash Loan Guard | ~670 bytes | 0 | ~$0.10 |
| Core Vault | ~166 bytes | ~80 KB (1000 users) | ~$1.00 |
| Fee Distribution | ~116 bytes | ~8 KB (100 recipients) | ~$0.20 |
| HTLC | ~150 bytes | 0 | ~$0.02 |
| Intent Validator | ~150 bytes | ~100 KB (1000 intents) | ~$1.20 |
| Lending Liquidation | ~150 bytes | ~100 KB (1000 positions) | ~$1.20 |
| Liquidity Vault | ~180 bytes | ~108 KB (100 pools × 1000 users) | ~$1.30 |
| PoR Validator | ~250 bytes | ~15 KB (100 proofs) | ~$0.25 |
| Relayer Slashing | ~180 bytes | ~1.5 KB (100 relayers) | ~$0.10 |
| Strategy Registry | ~280 bytes | ~28 KB (100 strategies) | ~$0.40 |

### Total Suite Storage
- **Instance Storage**: ~2.5 KB (all contracts)
- **Persistent Storage**: ~500 KB (moderate usage)
- **Estimated Monthly Cost**: ~$6.50

---

## Storage Best Practices

### 1. TTL Management
- Use TTL for data that naturally expires
- Set appropriate TTL based on data sensitivity
- Monitor storage costs and adjust TTLs

### 2. Key Design
- Use enum-based keys for type safety
- Composite keys for indexed data
- Symbol shortcuts for common keys

### 3. Data Compression
- Use efficient data structures
- Avoid redundant storage
- Consider data normalization

### 4. Access Patterns
- Optimize for read-heavy vs write-heavy patterns
- Cache frequently accessed data in instance storage
- Batch storage operations when possible

### 5. Security
- Sensitive data should use persistent storage
- Configuration should be in instance storage
- Audit trails should have no TTL

---

## Conclusion

This storage map provides a comprehensive view of data storage across the Soroban contract suite. Auditors should verify:

1. Storage keys are properly typed and unique
2. TTL settings are appropriate for data sensitivity
3. Storage costs are reasonable for expected usage
4. Access patterns are optimized for performance
5. Sensitive data is properly protected

Any storage design issues should be addressed before deployment to ensure cost efficiency and data integrity.
