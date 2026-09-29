# Shared Authorization Framework: Soroban Contract Security Model

## Current Authorization Landscape

### Existing Role Systems

1. **core_vault**: Single admin address with full powers
2. **rbac**: Role-based with SuperAdmin + 3 operational roles
3. **strategy_registry**: Single admin address
4. **EmergencyControl.sol**: OpenZeppelin AccessControl with 2 roles

### Authorization Matrix

| Contract             | Current Model | Admin Powers              | Role Separation |
| -------------------- | ------------- | ------------------------- | --------------- |
| core_vault           | Single Admin  | Full control              | None            |
| rbac                 | Role-based    | SuperAdmin + roles        | Partial         |
| strategy_registry    | Single Admin  | Full control              | None            |
| EmergencyControl.sol | AccessControl | DEFAULT_ADMIN + EMERGENCY | Partial         |

## Proposed Unified Authorization Framework

### 1. Role Hierarchy Design

```
SuperAdmin (root authority)
├── EmergencyAdmin (emergency pause, recovery)
├── VaultAdmin (backend status, vault operations)
├── UpgradeAdmin (contract upgrades)
├── StrategyAdmin (strategy registry management)
└── RoleAdmin (grant/revoke operational roles)

Operational Roles (delegated):
├── OracleProvider (price feeds)
├── AgentOperator (agent tasks)
└── StrategyOperator (strategy execution)
```

### 2. Contract Integration Points

#### UnifiedAuth Contract (New)

- Central role management
- Cross-contract role verification
- Emergency coordination
- Audit logging

#### Contract-Specific Adapters

- Each contract integrates with UnifiedAuth
- Contracts request role verification
- UnifiedAuth enforces consistent policies

### 3. Access Control Matrix

| Function            | EmergencyAdmin | VaultAdmin | UpgradeAdmin | StrategyAdmin | OracleProvider | AgentOperator |
| ------------------- | -------------- | ---------- | ------------ | ------------- | -------------- | ------------- |
| Emergency Pause     | ✅             | ❌         | ❌           | ❌            | ❌             | ❌            |
| Backend Status      | ✅             | ✅         | ❌           | ❌            | ❌             | ❌            |
| Recovery            | ✅             | ✅         | ❌           | ❌            | ❌             | ❌            |
| Contract Upgrade    | ❌             | ❌         | ✅           | ❌            | ❌             | ❌            |
| Strategy Management | ❌             | ❌         | ❌           | ✅            | ❌             | ❌            |
| Price Submission    | ❌             | ❌         | ❌           | ❌            | ✅             | ❌            |
| Agent Execution     | ❌             | ❌         | ❌           | ❌            | ❌             | ✅            |

### 4. Cross-Contract Emergency Coordination

#### Emergency Propagation

```
1. EmergencyAdmin triggers emergency_pause()
2. UnifiedAuth broadcasts emergency state to all registered contracts
3. Each contract enters emergency mode:
   - core_vault: Blocks deposits, allows force-exit
   - strategy_registry: Pauses strategy changes
   - Other contracts: Implement contract-specific emergency logic
```

#### Emergency Recovery

```
1. EmergencyAdmin triggers emergency_recovery()
2. UnifiedAuth coordinates recovery across contracts
3. Contracts restore normal operations in coordinated manner
```

## Implementation Design

### UnifiedAuth Contract Structure

```rust
#[contracttype]
#[derive(Clone, PartialEq)]
pub enum UnifiedRole {
    SuperAdmin,
    EmergencyAdmin,
    VaultAdmin,
    UpgradeAdmin,
    StrategyAdmin,
    RoleAdmin,
    OracleProvider,
    AgentOperator,
    StrategyOperator,
}

#[contracttype]
#[derive(Clone)]
pub enum ContractId {
    CoreVault,
    Rbac,
    StrategyRegistry,
    // Add other contracts as needed
}

#[contracttype]
#[derive(Clone)]
pub struct EmergencyState {
    pub is_emergency: bool,
    pub triggered_by: Address,
    pub triggered_at: u64,
    pub reason: EmergencyReason,
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum EmergencyReason {
    ExploitDetected,
    OracleFailure,
    BackendOffline,
    GovernanceDecision,
}
```

### Key Functions

#### Role Management

```rust
// SuperAdmin only
pub fn grant_role(env: Env, to: Address, role: UnifiedRole);
pub fn revoke_role(env: Env, from: Address, role: UnifiedRole);
pub fn transfer_super_admin(env: Env, new_admin: Address);

// Role verification (called by other contracts)
pub fn has_role(env: Env, addr: Address, role: UnifiedRole) -> bool;
pub fn require_role(env: Env, addr: Address, role: UnifiedRole);
```

#### Emergency Coordination

```rust
// EmergencyAdmin only
pub fn trigger_emergency(env: Env, reason: EmergencyReason);
pub fn end_emergency(env: Env);

// State queries
pub fn is_emergency_active(env: Env) -> bool;
pub fn get_emergency_state(env: Env) -> Option<EmergencyState>;
```

#### Contract Registration

```rust
// SuperAdmin only
pub fn register_contract(env: Env, contract_id: ContractId, contract_address: Address);
pub fn unregister_contract(env: Env, contract_id: ContractId);

// Emergency broadcast
pub fn notify_contract_emergency(env: Env, contract_id: ContractId);
```

### Integration Pattern for Existing Contracts

#### core_vault Integration

```rust
// Replace current admin checks with UnifiedAuth calls
pub fn set_backend_status(env: Env, online: bool) {
    // Old: let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    // New: UnifiedAuth::require_role(&env, env.current_contract_address(), UnifiedRole::VaultAdmin);

    UnifiedAuthClient::new(&env, &unified_auth_address)
        .require_role(&env.current_contract_address(), UnifiedRole::VaultAdmin);

    // Check emergency state
    if UnifiedAuthClient::new(&env, &unified_auth_address)
        .is_emergency_active() {
        panic!("Cannot change backend status during emergency");
    }

    env.storage().instance().set(&DataKey::BackendOnline, &online);
}
```

#### strategy_registry Integration

```rust
pub fn add_verified_pool(env: Env, pool_id: BytesN<32>) {
    UnifiedAuthClient::new(&env, &unified_auth_address)
        .require_role(&env.current_contract_address(), UnifiedRole::StrategyAdmin);

    // Existing logic...
}
```

## Migration Strategy

### Phase 1: Deploy UnifiedAuth

1. Deploy UnifiedAuth contract
2. Initialize with SuperAdmin
3. Grant initial roles to existing admins

### Phase 2: Register Contracts

1. Register core_vault with UnifiedAuth
2. Register strategy_registry with UnifiedAuth
3. Register other contracts as needed

### Phase 3: Migrate Contracts

1. Update core_vault to use UnifiedAuth
2. Update strategy_registry to use UnifiedAuth
3. Update other contracts progressively

### Phase 4: Deprecate Old Systems

1. Remove old admin checks from contracts
2. Consolidate role management in UnifiedAuth
3. Update documentation and governance processes

## Security Considerations

### 1. SuperAdmin Key Security

- Multi-sig recommendation for SuperAdmin
- Time-lock for critical role changes
- Clear succession planning

### 2. Emergency Role Safety

- EmergencyAdmin should have limited scope
- Emergency actions should be reversible
- Clear audit trail for emergency actions

### 3. Role Granularity

- Principle of least privilege
- Regular role audits
- Automated role expiration where appropriate

### 4. Cross-Contract Consistency

- UnifiedAuth as single source of truth
- Contracts must respect UnifiedAuth decisions
- No bypass mechanisms

## Testing Strategy

### Unit Tests

1. Role grant/revoke operations
2. Role verification correctness
3. Emergency state transitions
4. Contract registration/deregistration

### Integration Tests

1. Cross-contract role verification
2. Emergency propagation to registered contracts
3. Contract-specific emergency behavior
4. Role-based access control enforcement

### Security Tests

1. Unauthorized access attempts
2. Role escalation attacks
3. Emergency bypass attempts
4. Race conditions in emergency coordination

## Governance Integration

### 1. Role Assignment Process

- Documented role assignment procedures
- Multi-sig approval for sensitive roles
- Regular role review schedule

### 2. Emergency Response Process

- Clear emergency escalation paths
- Defined emergency response team
- Post-emergency review procedures

### 3. Audit Requirements

- Complete audit trail of role changes
- Emergency action logging
- Regular access reviews
