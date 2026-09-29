# Contract-to-Contract Strategy Execution Boundary: Vault-Managed Capital

## Current Strategy Architecture

### Existing Components

1. **core_vault**: Holds user deposits, manages withdrawals
2. **strategy_registry**: Manages verified pools and strategy selection
3. **AI Agents**: Authorized to vote on strategies
4. **Strategies**: External pools where capital can be deployed

### Current Trust Assumptions

- **Strategy Selection**: AI agents vote, but no validation of strategy safety
- **Capital Deployment**: No defined mechanism for core_vault to delegate to strategies
- **Strategy Verification**: Admin manually adds verified pools
- **Risk Assessment**: No systematic risk evaluation for strategies

## Security Issues

### Issue #1: Unbounded Trust in Strategy Selection

**Problem**: core_vault has no mechanism to validate strategy safety before deployment

**Current State**:

- strategy_registry selects strategies based on AI votes
- No risk limits or capital allocation controls
- No strategy audit requirements
- No withdrawal restrictions from strategies

**Risk**:

- Malicious or buggy strategies could lose user funds
- No protection against strategy rug pulls
- Unlimited capital exposure to single strategy

### Issue #2: Missing Capital Allocation Controls

**Problem**: No defined boundaries for how much capital can be deployed to strategies

**Current State**:

- No capital allocation limits
- No diversification requirements
- No concentration risk controls
- No per-strategy exposure limits

**Risk**:

- Overexposure to single strategy
- Lack of diversification increases risk
- No circuit breakers for large allocations

### Issue #3: Undefined Strategy Withdrawal Safety

**Problem**: No safety guarantees for withdrawing from strategies

**Current State**:

- No strategy withdrawal time locks
- no slippage protection
- No withdrawal queue management
- No emergency withdrawal paths

**Risk**:

- Strategies may block withdrawals
- Slippage could cause significant losses
- No guaranteed exit during emergencies

### Issue #4: No Strategy Performance Monitoring

**Problem**: No ongoing monitoring of strategy performance and safety

**Current State**:

- No performance tracking
- No strategy health checks
- No automated strategy removal
- No loss limits or stop-loss mechanisms

**Risk**:

- Underperforming strategies continue to receive capital
- No early warning for failing strategies
- No automated risk mitigation

## Proposed Strategy Execution Boundary

### 1. Strategy Safety Framework

#### Strategy Registration Requirements

```rust
#[contracttype]
#[derive(Clone)]
pub struct StrategyMetadata {
    pub strategy_id: BytesN<32>,
    pub strategy_address: Address,
    pub risk_level: RiskLevel,
    pub max_allocation: i128, // Maximum capital allocation
    pub min_liquidity: i128, // Minimum liquidity requirement
    pub withdrawal_delay: u32, // Withdrawal time lock in ledgers
    pub audit_report: BytesN<32>, // Hash of audit report
    pub audit_expiry: u64, // Audit expiration timestamp
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum RiskLevel {
    Low,    // Stable, audited, battle-tested
    Medium, // Audited, newer but proven
    High,   // Experimental, higher yield potential
}
```

#### Strategy Validation

```rust
pub fn register_strategy(
    env: Env,
    metadata: StrategyMetadata,
    auditor_signature: BytesN<64>
) {
    // Only StrategyAdmin can register strategies
    UnifiedAuth::require_role(&env, UnifiedRole::StrategyAdmin);

    // Validate audit report is current
    if env.ledger().timestamp() > metadata.audit_expiry {
        panic!("Audit report expired");
    }

    // Verify auditor signature
    Self::verify_audit_signature(&env, &metadata, auditor_signature);

    // Store strategy metadata
    env.storage().instance().set(
        &DataKey::StrategyMetadata(metadata.strategy_id),
        &metadata
    );
}
```

### 2. Capital Allocation Controls

#### Allocation Limits

```rust
#[contracttype]
#[derive(Clone)]
pub struct AllocationLimits {
    pub max_total_allocation: i128, // Max total capital in strategies
    pub max_per_strategy: i128, // Max per single strategy
    pub min_diversification: u32, // Minimum number of strategies
    pub max_concentration: u32, // Max percentage in single strategy (basis points)
}

pub fn allocate_to_strategy(
    env: Env,
    strategy_id: BytesN<32>,
    amount: i128
) {
    // Check allocation limits
    let limits = Self::get_allocation_limits(&env);
    let current_allocation = Self::get_total_allocation(&env);

    if current_allocation + amount > limits.max_total_allocation {
        panic!("Exceeds maximum total allocation");
    }

    let strategy_allocation = Self::get_strategy_allocation(&env, strategy_id);
    if strategy_allocation + amount > limits.max_per_strategy {
        panic!("Exceeds maximum per-strategy allocation");
    }

    // Check diversification
    let active_strategies = Self::get_active_strategies(&env);
    if active_strategies.len() < limits.min_diversification {
        panic!("Insufficient diversification");
    }

    // Execute allocation
    Self::execute_strategy_deposit(&env, strategy_id, amount);
}
```

### 3. Strategy Withdrawal Safety

#### Withdrawal Queue

```rust
#[contracttype]
#[derive(Clone)]
pub struct WithdrawalRequest {
    pub user: Address,
    pub strategy_id: BytesN<32>,
    pub amount: i128,
    pub requested_at: u64,
    pub eligible_at: u64,
}

pub fn request_strategy_withdrawal(
    env: Env,
    strategy_id: BytesN<32>,
    amount: i128
) {
    let user = env.current_contract_address();

    // Get strategy metadata
    let metadata = Self::get_strategy_metadata(&env, strategy_id);

    // Calculate eligibility time
    let eligible_at = env.ledger().timestamp() + metadata.withdrawal_delay;

    // Create withdrawal request
    let request = WithdrawalRequest {
        user: user.clone(),
        strategy_id,
        amount,
        requested_at: env.ledger().timestamp(),
        eligible_at,
    };

    // Queue the withdrawal
    env.storage().persistent().set(
        &DataKey::WithdrawalRequest(user.clone()),
        &request
    );
}

pub fn complete_strategy_withdrawal(env: Env) {
    let user = env.current_contract_address();

    let request = env.storage().persistent()
        .get::<DataKey, WithdrawalRequest>(
            &DataKey::WithdrawalRequest(user.clone())
        )
        .expect("No pending withdrawal");

    // Check eligibility
    if env.ledger().timestamp() < request.eligible_at {
        panic!("Withdrawal not yet eligible");
    }

    // Remove request before transfer (re-entrancy guard)
    env.storage().persistent().remove(&DataKey::WithdrawalRequest(user));

    // Execute withdrawal with slippage protection
    Self::execute_strategy_withdrawal(
        &env,
        request.strategy_id,
        request.amount,
        request.user
    );
}
```

### 4. Strategy Performance Monitoring

#### Health Checks

```rust
#[contracttype]
#[derive(Clone)]
pub struct StrategyHealth {
    pub strategy_id: BytesN<32>,
    pub total_value: i128,
    pub user_funds: i128,
    pub performance: i64, // Basis points
    pub last_updated: u64,
    pub health_status: HealthStatus,
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum HealthStatus {
    Healthy,
    Degraded,    // Performance below threshold
    Critical,    // Significant losses
    Compromised, // Security issue detected
}

pub fn update_strategy_health(
    env: Env,
    strategy_id: BytesN<32>,
    health: StrategyHealth
) {
    // Only authorized oracles can update health
    UnifiedAuth::require_role(&env, UnifiedRole::OracleProvider);

    // Store health data
    env.storage().instance().set(
        &DataKey::StrategyHealth(strategy_id),
        &health
    );

    // Auto-disable if critical
    if health.health_status == HealthStatus::Critical {
        Self::disable_strategy(&env, strategy_id);
    }
}
```

### 5. Emergency Strategy Controls

#### Emergency Withdrawal

```rust
pub fn emergency_strategy_withdrawal(
    env: Env,
    strategy_id: BytesN<32>
) {
    // Only EmergencyAdmin can trigger
    UnifiedAuth::require_role(&env, UnifiedRole::EmergencyAdmin);

    // Must be in emergency mode
    if !UnifiedAuth::is_emergency_active(&env) {
        panic!("Not in emergency mode");
    }

    // Bypass normal withdrawal delays
    let allocation = Self::get_strategy_allocation(&env, strategy_id);

    // Execute immediate withdrawal
    Self::force_withdraw_from_strategy(&env, strategy_id, allocation);
}
```

## Integration with core_vault

### 1. core_vault Strategy Interface

```rust
// Add to core_vault
#[contracttype]
#[derive(Clone)]
pub enum VaultDataKey {
    // ... existing keys ...
    StrategyAllocation(BytesN<32>),
    TotalStrategyAllocation,
    WithdrawalQueue(Address),
}

pub fn allocate_to_strategy(
    env: Env,
    strategy_id: BytesN<32>,
    amount: i128
) {
    // Check backend status
    if !Self::is_backend_online(env.clone()) {
        panic!("Backend offline");
    }

    // Check user has sufficient balance
    let user = env.current_contract_address();
    let balance = Self::get_deposit(env.clone(), user.clone()).unwrap_or(0);

    if balance < amount {
        panic!("Insufficient balance");
    }

    // Delegate to strategy boundary contract
    StrategyBoundaryClient::new(&env, &strategy_boundary_address)
        .allocate_to_strategy(strategy_id, amount);

    // Update vault state
    env.storage().persistent().set(
        &VaultDataKey::StrategyAllocation(strategy_id),
        &amount
    );
}
```

### 2. Trust Minimization Principles

#### Principle 1: Strategy Isolation

- Each strategy is isolated contract
- Vault never directly holds strategy tokens
- Strategies cannot access vault internals

#### Principle 2: Withdrawal Guarantees

- All strategies must implement standard withdrawal interface
- Withdrawal time locks prevent flash attacks
- Emergency bypass for critical situations

#### Principle 3: Capital Protection

- Allocation limits prevent overexposure
- Diversification requirements spread risk
- Health monitoring detects issues early

#### Principle 4: Audit Requirements

- All strategies must be audited
- Audit reports must be current
- Auditor signatures verified

## Risk Management Framework

### 1. Risk Categories

- **Smart Contract Risk**: Bugs, exploits in strategy code
- **Market Risk**: Price volatility, impermanent loss
- **Liquidity Risk**: Unable to withdraw from strategy
- **Counterparty Risk**: Strategy operator misconduct

### 2. Risk Mitigation

- **Smart Contract**: Audits, test coverage, bug bounties
- **Market**: Diversification, position limits, stop-loss
- **Liquidity**: Withdrawal queues, slippage protection
- **Counterparty**: Reputation systems, performance tracking

### 3. Risk Limits

```rust
#[contracttype]
#[derive(Clone)]
pub struct RiskLimits {
    pub max_smart_contract_exposure: i128, // Max in unaudited strategies
    pub max_market_exposure: i128, // Max in volatile strategies
    pub max_liquidity_exposure: i128, // Max in illiquid strategies
    pub max_single_counterparty: i128, // Max with single operator
}
```

## Implementation Roadmap

### Phase 1: Strategy Boundary Contract

1. Implement StrategyBoundary contract
2. Define strategy metadata structure
3. Implement strategy registration
4. Add allocation limit controls

### Phase 2: Withdrawal Safety

1. Implement withdrawal queue
2. Add withdrawal time locks
3. Implement slippage protection
4. Add emergency withdrawal

### Phase 3: Monitoring

1. Implement health check system
2. Add performance tracking
3. Implement auto-disable logic
4. Add alerting mechanisms

### Phase 4: core_vault Integration

1. Add strategy allocation functions
2. Integrate with StrategyBoundary
3. Update withdrawal logic
4. Add strategy-specific accounting

### Phase 5: Testing & Audit

1. Comprehensive unit tests
2. Integration tests
3. Security audit
4. Gradual deployment

## Testing Strategy

### Unit Tests

1. Strategy registration validation
2. Allocation limit enforcement
3. Withdrawal queue management
4. Health check logic

### Integration Tests

1. core_vault to strategy allocation
2. Strategy withdrawal flows
3. Emergency withdrawal
4. Cross-contract coordination

### Security Tests

1. Strategy bypass attempts
2. Allocation limit circumvention
3. Withdrawal delay bypass
4. Emergency power abuse

### Property Tests

1. Capital conservation invariants
2. Risk limit enforcement
3. Diversification requirements
4. Performance tracking accuracy
