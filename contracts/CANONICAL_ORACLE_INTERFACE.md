# Canonical Oracle-Consumption Interface

## Overview

Design a canonical oracle-consumption interface for all price-sensitive contracts (`liquidity_vault`, `lending_liquidation`, `flash_loan_guard`) to ensure coherent risk logic across contracts.

## Current State Analysis

### Existing Oracle Interfaces

**flash_loan_guard**:
```rust
#[contractclient(name = "PriceOracleClient")]
pub trait PriceOracleTrait {
    fn get_price(env: Env, asset: Address) -> i128;
}
```

**liquidity_vault**:
```rust
#[contractclient(name = "PriceOracleClient")]
pub trait PriceOracleTrait {
    fn get_price(env: Env, asset: Address) -> Option<PriceData>;
}

pub struct PriceData {
    pub price: i128,
    pub decimals: u32,
    pub timestamp: u64,
}
```

**lending_liquidation**:
```rust
#[contractclient(name = "PriceOracleClient")]
pub trait PriceOracleTrait {
    fn get_price(env: Env, asset: Address) -> i128;
}
```

### Issues Identified

1. **Inconsistent Return Types**: Some return `i128`, others return `Option<PriceData>`
2. **Missing Metadata**: Simple `i128` returns lack timestamp and decimal information
3. **No Standard Validation**: Each contract implements its own price validation
4. **Duplicated Safety Logic**: Freshness checks, staleness checks are duplicated
5. **No Error Standardization**: Different panic messages and error handling

## Canonical Interface Design

### Core Price Data Structure

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CanonicalPrice {
    /// Raw price value from oracle
    pub price: i128,
    /// Number of decimals for the price
    pub decimals: u32,
    /// Oracle timestamp when price was recorded
    pub oracle_timestamp: u64,
    /// Oracle sequence number for monotonicity checks
    pub oracle_sequence: u64,
    /// Confidence score (0-10000 basis points)
    pub confidence_bps: u32,
    /// Price source identifier
    pub source: Bytes,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceValidationResult {
    pub is_valid: bool,
    pub normalized_price: i128,
    pub freshness_score: u32,
    pub staleness_warning: bool,
    pub deviation_warning: bool,
    pub reason: Option<Bytes>,
}
```

### Canonical Oracle Trait

```rust
#[contractclient(name = "CanonicalOracleClient")]
pub trait CanonicalOracleTrait {
    /// Get canonical price data for an asset
    fn get_canonical_price(env: Env, asset: Address) -> CanonicalPrice;
    
    /// Batch get prices for multiple assets
    fn get_batch_prices(env: Env, assets: Vec<Address>) -> Vec<CanonicalPrice>;
    
    /// Get price with validation
    fn get_validated_price(
        env: Env, 
        asset: Address,
        max_staleness_seconds: u64,
        min_confidence_bps: u32
    ) -> PriceValidationResult;
    
    /// Check oracle health status
    fn oracle_health(env: Env) -> OracleHealth;
}
```

### Oracle Health Structure

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OracleHealth {
    pub is_healthy: bool,
    pub last_update_timestamp: u64,
    pub last_update_sequence: u64,
    pub consecutive_failures: u32,
    pub uptime_percentage: u32,
}
```

### Price Safety Configuration

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceSafetyConfig {
    /// Maximum acceptable oracle staleness in seconds
    pub max_staleness_seconds: u64,
    /// Minimum confidence threshold in basis points
    pub min_confidence_bps: u32,
    /// Maximum acceptable price deviation between consecutive reads
    pub max_deviation_bps: i128,
    /// Minimum required ledger gap between price updates
    pub min_ledger_gap: u32,
    /// Maximum acceptable oracle update gap in seconds
    pub max_oracle_update_gap_seconds: u64,
    /// Circuit breaker threshold in basis points
    pub circuit_breaker_threshold_bps: i128,
    /// Circuit breaker window in seconds
    pub circuit_breaker_window_seconds: u64,
}
```

## Implementation Strategy

### Phase 1: Create Shared Oracle Library

Create a new contract `canonical_oracle` that implements the canonical interface:

```
contracts/canonical_oracle/
├── src/
│   ├── lib.rs           # Main oracle implementation
│   ├── validation.rs    # Price validation logic
│   ├── safety.rs        # Safety checks and circuit breakers
│   └── types.rs         # Shared type definitions
└── Cargo.toml
```

### Phase 2: Migrate Existing Contracts

**flash_loan_guard**:
- Replace `PriceOracleTrait` with `CanonicalOracleTrait`
- Use `get_validated_price` for safety checks
- Remove duplicated validation logic
- Keep existing circuit breaker logic as additional layer

**liquidity_vault**:
- Replace `PriceOracleTrait` with `CanonicalOracleTrait`
- Use `get_canonical_price` for price data
- Remove `PriceData` struct (use `CanonicalPrice`)
- Simplify price normalization logic

**lending_liquidation**:
- Replace `PriceOracleTrait` with `CanonicalOracleTrait`
- Use `get_validated_price` for safety checks
- Remove duplicated validation logic
- Add confidence-based liquidation thresholds

### Phase 3: Add Advanced Safety Features

1. **Multi-Oracle Aggregation**: Support multiple oracle sources with weighted averaging
2. **Price Smoothing**: Implement moving average to reduce noise
3. **Anomaly Detection**: Detect and flag unusual price movements
4. **Fallback Mechanisms**: Graceful degradation when oracle fails

## Price Validation Logic

### Freshness Check

```rust
fn check_freshness(
    price: &CanonicalPrice,
    config: &PriceSafetyConfig,
    current_time: u64
) -> bool {
    current_time <= price.oracle_timestamp + config.max_staleness_seconds
}
```

### Confidence Check

```rust
fn check_confidence(
    price: &CanonicalPrice,
    config: &PriceSafetyConfig
) -> bool {
    price.confidence_bps >= config.min_confidence_bps
}
```

### Deviation Check

```rust
fn check_deviation(
    current_price: i128,
    previous_price: i128,
    config: &PriceSafetyConfig
) -> bool {
    let diff = if current_price > previous_price {
        current_price - previous_price
    } else {
        previous_price - current_price
    };
    
    let deviation_bps = diff
        .checked_mul(10_000)
        .expect("overflow")
        .checked_div(previous_price)
        .expect("div zero");
    
    deviation_bps <= config.max_deviation_bps
}
```

### Sequence Monotonicity Check

```rust
fn check_sequence_monotonicity(
    current_sequence: u64,
    previous_sequence: u64
) -> bool {
    current_sequence > previous_sequence
}
```

## Circuit Breaker Integration

### Circuit Breaker State

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CircuitBreakerState {
    pub triggered: bool,
    pub trigger_timestamp: u64,
    pub trigger_ledger: u32,
    pub consecutive_violations: u32,
    pub last_violation_reason: Bytes,
}
```

### Circuit Breaker Logic

```rust
fn evaluate_circuit_breaker(
    state: &CircuitBreakerState,
    validation_result: &PriceValidationResult,
    config: &PriceSafetyConfig,
    current_time: u64,
    current_ledger: u32
) -> CircuitBreakerState {
    let mut new_state = state.clone();
    
    // Auto-release if window expired
    if state.triggered && current_time > state.trigger_timestamp + config.circuit_breaker_window_seconds {
        new_state.triggered = false;
        new_state.consecutive_violations = 0;
        return new_state;
    }
    
    // Check for violations
    if !validation_result.is_valid {
        new_state.consecutive_violations += 1;
        
        // Trigger circuit breaker after threshold
        if new_state.consecutive_violations >= 3 {
            new_state.triggered = true;
            new_state.trigger_timestamp = current_time;
            new_state.trigger_ledger = current_ledger;
            new_state.last_violation_reason = validation_result.reason.clone().unwrap_or(Bytes::from_slice(&env, b"unknown"));
        }
    } else {
        new_state.consecutive_violations = 0;
    }
    
    new_state
}
```

## Migration Guide

### For Contract Developers

1. **Update Imports**:
```rust
use canonical_oracle::{CanonicalOracleClient, CanonicalPrice, PriceValidationResult};
```

2. **Replace Oracle Calls**:
```rust
// Old
let oracle = PriceOracleClient::new(&env, &config.oracle);
let price = oracle.get_price(&asset);

// New
let oracle = CanonicalOracleClient::new(&env, &config.oracle);
let price_data = oracle.get_canonical_price(&asset);
let validation = oracle.get_validated_price(&asset, max_staleness, min_confidence);
```

3. **Update Config**:
```rust
// Add PriceSafetyConfig to your contract config
pub struct Config {
    // ... existing fields
    pub price_safety: PriceSafetyConfig,
}
```

### For Oracle Providers

1. **Implement Canonical Interface**:
```rust
#[contractimpl]
impl CanonicalOracleTrait for MyOracleContract {
    fn get_canonical_price(env: Env, asset: Address) -> CanonicalPrice {
        // Your oracle implementation
    }
    
    // ... implement other methods
}
```

2. **Provide Metadata**:
- Ensure timestamps are accurate
- Include confidence scores
- Track sequence numbers
- Provide source information

## Testing Strategy

### Unit Tests

1. **Price Validation Tests**:
   - Freshness check edge cases
   - Confidence threshold tests
   - Deviation calculation accuracy
   - Sequence monotonicity verification

2. **Circuit Breaker Tests**:
   - Trigger conditions
   - Auto-release logic
   - Violation counting
   - State persistence

3. **Integration Tests**:
   - Contract-to-oracle communication
   - Batch price retrieval
   - Error handling
   - Performance benchmarks

### Property Tests

1. **Price Monotonicity**: Sequence numbers always increase
2. **Freshness Guarantees**: Stale prices are rejected
3. **Deviation Bounds**: Large deviations trigger circuit breaker
4. **Confidence Thresholds**: Low confidence prices are rejected

## Benefits

1. **Consistency**: All contracts use the same price validation logic
2. **Safety**: Centralized safety checks reduce risk of bugs
3. **Maintainability**: Single source of truth for oracle interactions
4. **Flexibility**: Easy to add new safety features
5. **Auditability**: Clear separation of concerns
6. **Performance**: Optimized batch operations
7. **Observability**: Standardized health monitoring

## Next Steps

1. Implement `canonical_oracle` contract
2. Write comprehensive tests
3. Migrate `flash_loan_guard`
4. Migrate `liquidity_vault`
5. Migrate `lending_liquidation`
6. Update documentation
7. Deploy to testnet
8. Monitor and iterate
