# Emergency Coordination Implementation Guide

## Overview

This document describes how to implement cross-contract emergency coordination between Soroban contracts (core_vault, strategy_registry, strategy_boundary) and Solidity contracts (EmergencyControl.sol, CoreEngine.sol) using the UnifiedAuth system.

## Architecture

### Emergency State Flow

```
EmergencyAdmin triggers emergency in UnifiedAuth
    ↓
UnifiedAuth broadcasts emergency state to registered contracts
    ↓
Each contract enters emergency mode with contract-specific behavior
    ↓
EmergencyAdmin coordinates recovery across all contracts
    ↓
UnifiedAuth ends emergency state
    ↓
Contracts restore normal operations
```

## Implementation Steps

### Phase 1: UnifiedAuth Emergency Broadcasting

#### 1.1 Add Contract Notification Function

```rust
// In UnifiedAuth contract
pub fn notify_contract_emergency(env: Env, contract_id: ContractId) {
    let super_admin = Self::super_admin(&env);
    super_admin.require_auth();

    let contract_address = Self::get_contract_address(&env, contract_id.clone())
        .expect("Contract not registered");

    let emergency_state = Self::get_emergency_state(&env)
        .expect("No active emergency");

    // In production, this would call the contract's emergency handler
    // For now, emit event for off-chain coordination
    env.events().publish(
        (symbol_short!("emergency"), symbol_short!("notify")),
        (contract_id, emergency_state)
    );
}
```

#### 1.2 Add Batch Emergency Notification

```rust
pub fn broadcast_emergency(env: Env) {
    let super_admin = Self::super_admin(&env);
    super_admin.require_auth();

    // Notify all registered contracts
    Self::notify_contract_emergency(env.clone(), ContractId::CoreVault);
    Self::notify_contract_emergency(env.clone(), ContractId::StrategyRegistry);
    Self::notify_contract_emergency(env.clone(), ContractId::StrategyBoundary);
    Self::notify_contract_emergency(env.clone(), ContractId::LiquidityVault);
}
```

### Phase 2: Contract Emergency Handlers

#### 2.1 core_vault Emergency Integration

```rust
// Add to core_vault DataKey
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // ... existing keys ...
    EmergencyMode,
    EmergencyTriggeredAt,
}

// Add emergency handler function
pub fn handle_emergency(env: Env, is_emergency: bool, reason: EmergencyReason) {
    // Only UnifiedAuth can call this
    let unified_auth = Self::get_unified_auth(&env);
    let caller = env.current_contract_address();

    // Verify caller is UnifiedAuth (in production)
    // For now, check admin
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();

    if is_emergency {
        // Enter emergency mode
        env.storage().instance().set(&DataKey::EmergencyMode, &true);
        env.storage().instance().set(&DataKey::EmergencyTriggeredAt, &env.ledger().timestamp());

        // Set backend offline to enable force exits
        env.storage().instance().set(&DataKey::BackendOnline, &false);
    } else {
        // Exit emergency mode
        env.storage().instance().set(&DataKey::EmergencyMode, &false);

        // Do not auto-set backend online - requires explicit admin decision
    }

    env.events().publish(
        (symbol_short!("vault"), symbol_short!("emergency")),
        (is_emergency, reason)
    );
}

pub fn is_emergency_mode(env: Env) -> bool {
    env.storage().instance().get(&DataKey::EmergencyMode).unwrap_or(false)
}
```

#### 2.2 strategy_registry Emergency Integration

```rust
// Add to strategy_registry DataKey
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // ... existing keys ...
    EmergencyMode,
    EmergencyFreezeStrategies,
}

pub fn handle_emergency(env: Env, is_emergency: bool) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();

    if is_emergency {
        env.storage().instance().set(&DataKey::EmergencyMode, &true);
        // Freeze strategy changes during emergency
        env.storage().instance().set(&DataKey::EmergencyFreezeStrategies, &true);
    } else {
        env.storage().instance().set(&DataKey::EmergencyMode, &false);
        env.storage().instance().set(&DataKey::EmergencyFreezeStrategies, &false);
    }
}

// Modify vote_strategy to check emergency mode
pub fn vote_strategy(env: Env, ai_agent: Address, pool_id: BytesN<32>) {
    if Self::is_emergency_mode(env.clone()) {
        panic!("Strategy voting disabled during emergency");
    }
    // ... existing logic ...
}
```

#### 2.3 strategy_boundary Emergency Integration

```rust
// Already has emergency_withdrawal function
// Add emergency mode tracking
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // ... existing keys ...
    EmergencyMode,
}

pub fn handle_emergency(env: Env, is_emergency: bool) {
    Self::check_strategy_admin(&env);

    if is_emergency {
        env.storage().instance().set(&DataKey::EmergencyMode, &true);
    } else {
        env.storage().instance().set(&DataKey::EmergencyMode, &false);
    }
}

// Modify allocate_to_strategy to check emergency mode
pub fn allocate_to_strategy(env: Env, strategy_id: BytesN<32>, amount: i128) {
    if Self::is_emergency_mode(env.clone()) {
        panic!("Strategy allocation disabled during emergency");
    }
    // ... existing logic ...
}
```

### Phase 3: Solidity Emergency Coordination

#### 3.1 Update EmergencyControl.sol

```solidity
// Add cross-chain emergency coordination
abstract contract EmergencyControl is AccessControl, Pausable {
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant CROSS_CHAIN_COORDINATOR = keccak256("CROSS_CHAIN_COORDINATOR");
    uint256 public constant EVENT_VERSION = 1;

    event EmergencyPaused(uint256 indexed version, address indexed actor, uint256 timestamp, string reason);
    event EmergencyUnpaused(uint256 indexed version, address indexed actor, uint256 timestamp);
    event CrossChainEmergencyTriggered(uint256 indexed version, address indexed actor, string targetChain);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(EMERGENCY_ROLE, msg.sender);
        _grantRole(CROSS_CHAIN_COORDINATOR, msg.sender);
    }

    function pause(string calldata reason) external onlyRole(EMERGENCY_ROLE) {
        _pause();
        emit EmergencyPaused(EVENT_VERSION, msg.sender, block.timestamp, reason);
    }

    function unpause() external onlyRole(EMERGENCY_ROLE) {
        _unpause();
        emit EmergencyUnpaused(EVENT_VERSION, msg.sender, block.timestamp);
    }

    function pauseWithCrossChainCoordination(
        string calldata reason,
        string calldata targetChain
    ) external onlyRole(CROSS_CHAIN_COORDINATOR) {
        _pause();
        emit EmergencyPaused(EVENT_VERSION, msg.sender, block.timestamp, reason);
        emit CrossChainEmergencyTriggered(EVENT_VERSION, msg.sender, targetChain);

        // In production, this would trigger a cross-chain message to Soroban
        // For now, emit event for off-chain coordination
    }

    function isEmergencyPaused() public view returns (bool) {
        return paused();
    }
}
```

#### 3.2 Update CoreEngine.sol

```solidity
contract CoreEngine is EmergencyControl, ReentrancyGuard {
    // ... existing code ...

    function emergencyWithdraw(address token) external whenPaused nonReentrant {
        uint256 principal = userPrincipal[msg.sender][token];
        require(principal > 0, "No principal to withdraw");

        userPrincipal[msg.sender][token] = 0;
        IERC20(token).safeTransfer(msg.sender, principal);

        emit EmergencyWithdrawn(EVENT_VERSION, msg.sender, msg.sender, token, principal);
    }

    // Add function to check Soroban emergency state
    function isSorobanEmergencyActive() public view returns (bool) {
        // In production, this would query the Soroban chain via oracle
        // For now, return false
        return false;
    }

    // Modify deposit to check both chains
    function deposit(address token, uint256 amount) external whenNotPaused nonReentrant {
        require(!isSorobanEmergencyActive(), "Soroban emergency active");
        require(amount > 0, "Amount must be greater than zero");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        userPrincipal[msg.sender][token] += amount;
        emit Deposited(EVENT_VERSION, msg.sender, msg.sender, token, amount);
    }
}
```

### Phase 4: Cross-Chain Communication

#### 4.1 Oracle-Based Emergency State Sync

```rust
// In UnifiedAuth, add oracle integration
pub fn sync_emergency_from_solidity(env: Env, is_emergency: bool, source_chain: String) {
    Self::require_oracle_provider(&env);

    if is_emergency {
        // Trigger emergency on Soroban side
        let state = EmergencyState {
            is_emergency: true,
            triggered_by: env.current_contract_address(),
            triggered_at: env.ledger().timestamp(),
            reason: EmergencyReason::GovernanceDecision, // Or specific cross-chain reason
        };
        env.storage().instance().set(&DataKey::EmergencyState, &state);

        // Broadcast to all contracts
        Self::broadcast_emergency(env);
    } else {
        // End emergency
        env.storage().instance().remove(&DataKey::EmergencyState);
    }
}
```

### Phase 5: Emergency Response Procedures

#### 5.1 Emergency Escalation Matrix

| Severity | Response Time | Actions                         | Who Can Trigger            |
| -------- | ------------- | ------------------------------- | -------------------------- |
| Critical | < 5 minutes   | Full pause, force exits enabled | EmergencyAdmin             |
| High     | < 15 minutes  | Partial pause, strategy freeze  | EmergencyAdmin, VaultAdmin |
| Medium   | < 1 hour      | Backend offline, monitoring     | VaultAdmin                 |
| Low      | < 4 hours     | Increased monitoring, alerts    | Any admin                  |

#### 5.2 Emergency Response Checklist

```
1. Verify emergency condition
2. Trigger emergency in UnifiedAuth
3. Broadcast emergency to all contracts
4. Monitor contract responses
5. Coordinate cross-chain if needed
6. Execute emergency procedures
7. Document all actions
8. Plan recovery
9. Execute recovery when safe
10. End emergency in UnifiedAuth
```

## Testing Strategy

### Unit Tests

1. UnifiedAuth emergency state management
2. Contract emergency handler responses
3. Emergency notification broadcasting
4. Cross-chain emergency sync

### Integration Tests

1. End-to-end emergency flow
2. Multi-contract emergency coordination
3. Cross-chain emergency propagation
4. Emergency recovery procedures

### Security Tests

1. Unauthorized emergency triggering
2. Emergency bypass attempts
3. Emergency state manipulation
4. Cross-chain emergency spoofing

### Simulation Tests

1. High-severity emergency response
2. Partial emergency scenarios
3. Emergency during upgrade
4. Concurrent emergencies

## Deployment Procedure

### 1. Deploy UnifiedAuth

```bash
# Deploy UnifiedAuth contract
soroban contract deploy \
  --wasm contracts/unified_auth/target/release/unified_auth.wasm \
  --source <admin-address> \
  --network <network>
```

### 2. Register Contracts

```bash
# Register core_vault
soroban contract invoke \
  --id <unified-auth-id> \
  --function register_contract \
  --arg CoreVault \
  --arg <core-vault-address> \
  --source <admin-address>

# Register other contracts similarly
```

### 3. Grant Emergency Roles

```bash
# Grant EmergencyAdmin role
soroban contract invoke \
  --id <unified-auth-id> \
  --function grant_role \
  --arg <emergency-admin-address> \
  --arg EmergencyAdmin \
  --source <super-admin-address>
```

### 4. Update Contract Configurations

```bash
# Configure core_vault with UnifiedAuth
soroban contract invoke \
  --id <core-vault-id> \
  --function set_unified_auth \
  --arg <unified-auth-address> \
  --source <admin-address>
```

### 5. Test Emergency Flow

```bash
# Trigger test emergency
soroban contract invoke \
  --id <unified-auth-id> \
  --function trigger_emergency \
  --arg GovernanceDecision \
  --source <emergency-admin-address>

# Verify contracts respond
# End test emergency
soroban contract invoke \
  --id <unified-auth-id> \
  --function end_emergency \
  --source <emergency-admin-address>
```

## Monitoring and Alerting

### 1. Emergency State Monitoring

- Monitor UnifiedAuth emergency state
- Track contract emergency mode status
- Alert on emergency state changes

### 2. Cross-Chain Monitoring

- Monitor Solidity contract pause status
- Track cross-chain emergency messages
- Alert on cross-chain emergency mismatches

### 3. Health Monitoring

- Monitor contract responsiveness
- Track emergency handler execution
- Alert on failed emergency notifications

## Rollback Procedure

If emergency coordination fails:

1. Manually pause each contract individually
2. Use contract-specific admin functions
3. Document the failure
4. Investigate root cause
5. Fix the issue
6. Re-test emergency flow
7. Re-deploy if necessary

## Security Considerations

### 1. Emergency Role Security

- Use multi-sig for EmergencyAdmin
- Implement time-lock for emergency actions
- Regular role audits
- Clear succession planning

### 2. Cross-Chain Security

- Validate cross-chain messages
- Use trusted oracles
- Implement replay protection
- Monitor for cross-chain attacks

### 3. Emergency State Consistency

- Ensure atomic state transitions
- Implement rollback mechanisms
- Monitor for state divergence
- Regular state reconciliation

## Documentation Requirements

### 1. Operational Documentation

- Emergency response procedures
- Escalation paths
- Contact information
- Decision trees

### 2. Technical Documentation

- Emergency flow diagrams
- Contract interface specifications
- Cross-chain message formats
- API documentation

### 3. Audit Documentation

- Emergency action logs
- Post-incident reports
- Security audit results
- Compliance documentation
