# Security Boundaries Analysis: core_vault, rbac, and EmergencyControl.sol

## Current State Analysis

### 1. core_vault (Soroban)

- **Admin Model**: Simple address-based admin stored in instance storage
- **Admin Functions**:
  - `set_backend_status()` - Toggle backend online/offline
  - `recovery()` - Cancel force-exit requests
  - `propose_upgrade()`, `cancel_upgrade()`, `apply_upgrade()` - Contract upgrades
  - `transfer_admin()` - Transfer admin rights
- **Trust Boundaries**:
  - Admin has full control over backend status
  - Admin can cancel user force-exit requests
  - Admin controls upgrade process with timelock

### 2. rbac (Soroban)

- **Admin Model**: Role-based with SuperAdmin as ultimate authority
- **Roles**: OracleProvider, AgentOperator, EmergencyAdmin
- **Trust Boundaries**:
  - SuperAdmin can grant/revoke any role
  - Each role has specific function access
  - EmergencyAdmin can pause system
- **Integration**: Currently standalone, not integrated with core_vault

### 3. EmergencyControl.sol (Solidity)

- **Admin Model**: OpenZeppelin AccessControl with DEFAULT_ADMIN_ROLE and EMERGENCY_ROLE
- **Functions**: `pause()`, `unpause()`, `isEmergencyPaused()`
- **Trust Boundaries**:
  - EMERGENCY_ROLE can pause/unpause contract
  - DEFAULT_ADMIN_ROLE can manage roles
- **Integration**: Used by CoreEngine.sol, not integrated with Soroban contracts

## Security Issues Identified

### Issue #1: Fragmented Admin Authority

**Problem**: Three separate admin systems with no coordination:

- core_vault has its own admin
- rbac has SuperAdmin
- EmergencyControl.sol has DEFAULT_ADMIN_ROLE and EMERGENCY_ROLE

**Risk**:

- No single source of truth for emergency powers
- Potential for admin key conflicts
- Ambiguous governance paths during emergencies

### Issue #2: No Cross-Chain Emergency Coordination

**Problem**: EmergencyControl.sol (Solidity) and rbac EmergencyAdmin (Soroban) operate independently

**Risk**:

- Emergency pause on one chain doesn't affect the other
- Inconsistent emergency response across surfaces
- Users could be protected on one chain but vulnerable on another

### Issue #3: Missing Role Integration in core_vault

**Problem**: core_vault doesn't use rbac for authorization

**Risk**:

- No separation of duties in core_vault
- Single admin has all powers (backend status, upgrades, recovery)
- Cannot delegate specific responsibilities without full admin access

### Issue #4: Undefined Emergency Powers Scope

**Problem**: Emergency powers are not clearly defined across contracts

**Risk**:

- Unclear what emergency admins can do in core_vault
- No documented escalation paths
- Potential for emergency power abuse

## Proposed Security Boundary Framework

### 1. Unified Authorization Hierarchy

```
SuperAdmin (ultimate authority)
├── EmergencyAdmin (can pause, trigger emergency modes)
├── VaultAdmin (can manage backend status, recovery)
├── UpgradeAdmin (can manage contract upgrades)
└── RoleAdmin (can grant/revoke operational roles)
```

### 2. Cross-Contract Emergency Coordination

- EmergencyAdmin role should be recognized across all contracts
- Emergency pause should propagate to dependent contracts
- Clear escalation paths for different emergency scenarios

### 3. Separation of Duties in core_vault

- Split current admin powers into specific roles
- VaultAdmin: backend status, recovery operations
- UpgradeAdmin: upgrade management
- EmergencyAdmin: emergency pause integration

### 4. Governance Path Clarity

- Document exact powers for each role
- Define escalation procedures
- Specify time-lock requirements for different actions
