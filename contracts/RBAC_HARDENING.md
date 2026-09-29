# RBAC Contract Hardening - Reusable Authorization Primitive

## Overview

Evolve the current RBAC contract into a reusable and formally specified authorization building block with role hierarchy semantics, revocation guarantees, and stronger event/audit behavior.

## Current State Analysis

### Existing RBAC Contract

**Current Features**:
- Simple role-based access control with 3 fixed roles
- Super-admin with full control
- Basic grant/revoke operations
- Simple role checking
- Basic event logging

**Limitations**:
1. **Fixed Role Set**: Roles are hardcoded (OracleProvider, AgentOperator, EmergencyAdmin)
2. **No Hierarchy**: All roles are flat, no inheritance or precedence
3. **No Time-Based Access**: No expiration or time-based permissions
4. **Weak Revocation**: No revocation guarantees or notifications
5. **Limited Audit**: Minimal event data, no audit trail
6. **No Delegation**: Cannot delegate authority
7. **No Context Awareness**: Cannot check permissions in specific contexts
8. **No Resource-Level Control**: Cannot restrict access to specific resources

## Enhanced RBAC Design

### Role Hierarchy System

```rust
#[contracttype]
#[derive(Clone, PartialEq, Eq)]
pub enum Role {
    // System roles (highest priority)
    SuperAdmin,           // Full system control
    SecurityAdmin,        // Security operations
    
    // Operational roles
    OracleProvider,       // Price feed operations
    AgentOperator,        // Agent task execution
    EmergencyAdmin,       // Emergency operations
    
    // Delegated roles (can be granted by higher roles)
    PriceValidator,       // Validate price submissions
    TaskSupervisor,       // Supervise agent tasks
    Auditor,              // Audit operations
    
    // Custom roles (user-defined)
    Custom(Bytes),         // User-defined role names
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoleHierarchy {
    pub role: Role,
    pub parent_role: Option<Role>,
    pub priority: u32,
    pub can_grant: Vec<Role>,
    pub can_revoke: Vec<Role>,
}
```

### Role Assignment with Metadata

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoleAssignment {
    pub address: Address,
    pub role: Role,
    pub granted_by: Address,
    pub granted_at: u64,
    pub expires_at: Option<u64>,
    pub context: Option<Bytes>,  // Resource/context restriction
    pub conditions: Option<RoleConditions>,
    pub is_delegatable: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoleConditions {
    pub time_restrictions: Option<TimeRestrictions>,
    pub amount_restrictions: Option<AmountRestrictions>,
    pub frequency_restrictions: Option<FrequencyRestrictions>,
    pub ip_restrictions: Option<Bytes>,  // IP whitelist
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TimeRestrictions {
    pub allowed_hours_start: u32,  // Hour of day (0-23)
    pub allowed_hours_end: u32,
    pub allowed_days: u32,        // Bitmask for days (1=Mon, 2=Tue, etc.)
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AmountRestrictions {
    pub max_amount_per_tx: i128,
    pub max_amount_per_day: i128,
    pub max_amount_per_week: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FrequencyRestrictions {
    pub max_operations_per_hour: u32,
    pub max_operations_per_day: u32,
}
```

### Revocation System

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RevocationRequest {
    pub id: u64,
    pub target_address: Address,
    pub role: Role,
    pub requested_by: Address,
    pub reason: Bytes,
    pub requested_at: u64,
    pub status: RevocationStatus,
    pub effective_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RevocationStatus {
    Pending,
    Approved,
    Rejected,
    Executed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RevocationGuarantee {
    pub guarantee_id: u64,
    pub role: Role,
    pub min_notice_period_seconds: u64,
    pub requires_approval: bool,
    pub auto_revocation_enabled: bool,
}
```

### Enhanced Event System

```rust
#[contracttype]
#[derive(Clone)]
pub struct EvtRoleGranted {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub to: Address,
    pub role: Role,
    pub by: Address,
    pub expires_at: Option<u64>,
    pub context: Option<Bytes>,
    pub delegation_chain: Vec<Address>,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtRoleRevoked {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub from: Address,
    pub role: Role,
    pub by: Address,
    pub reason: Bytes,
    pub notice_period_seconds: u64,
    pub was_emergency: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtPermissionChecked {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub address: Address,
    pub role: Role,
    pub operation: Bytes,
    pub resource: Option<Bytes>,
    pub allowed: bool,
    pub reason: Option<Bytes>,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtDelegationChain {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub delegator: Address,
    pub delegatee: Address,
    pub role: Role,
    pub chain_length: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtAuditTrail {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub operation: Bytes,
    pub success: bool,
    pub roles_used: Vec<Role>,
    pub resource_accessed: Option<Bytes>,
    pub metadata: Bytes,
}
```

### Permission System

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Permission {
    pub resource: Bytes,
    pub action: Bytes,
    pub conditions: Option<PermissionConditions>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PermissionConditions {
    pub min_role_level: Option<Role>,
    pub requires_context: bool,
    pub time_sensitive: bool,
    pub amount_sensitive: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PermissionCheck {
    pub address: Address,
    pub permission: Permission,
    pub context: Option<Bytes>,
    pub timestamp: u64,
}
```

## Implementation Strategy

### Phase 1: Core RBAC Enhancement

**Storage Structure**:
```rust
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // Administration
    SuperAdmin,
    Config,
    
    // Role definitions
    RoleDefinition(Role),
    RoleHierarchy(Role),
    
    // Role assignments
    RoleAssignment(Address, Role),
    ActiveRoles(Address),  // Vec<Role>
    
    // Revocation system
    RevocationRequest(u64),
    PendingRevocations(Address),  // Vec<u64>
    RevocationGuarantee(Role),
    
    // Permission system
    PermissionDefinition(Bytes, Bytes),  // (resource, action)
    RolePermissions(Role),  // Vec<Permission>
    
    // Audit trail
    AuditLog(u64),
    AuditIndex(Address),  // Vec<u64>
    
    // Statistics
    RoleStats(Role),
    OperationStats(Bytes),
}
```

**Configuration**:
```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RbacConfig {
    pub super_admin: Address,
    pub max_role_hierarchy_depth: u32,
    pub default_role_expiration_seconds: u64,
    pub min_revocation_notice_seconds: u64,
    pub audit_log_retention_ledgers: u32,
    pub emergency_revocation_enabled: bool,
    pub delegation_enabled: bool,
    pub custom_roles_enabled: bool,
}
```

### Phase 2: Role Hierarchy Implementation

**Hierarchy Management**:
```rust
pub fn define_role_hierarchy(env: Env, hierarchy: RoleHierarchy) {
    let admin = Self::super_admin(&env);
    admin.require_auth();
    
    // Validate hierarchy depth
    let depth = Self::calculate_hierarchy_depth(&env, &hierarchy.role);
    let config: RbacConfig = env.storage().instance().get(&DataKey::Config).unwrap();
    if depth > config.max_role_hierarchy_depth {
        panic!("hierarchy depth exceeds maximum");
    }
    
    // Validate no circular dependencies
    if Self::would_create_cycle(&env, &hierarchy) {
        panic!("circular dependency detected");
    }
    
    env.storage().instance().set(&DataKey::RoleHierarchy(hierarchy.role.clone()), &hierarchy);
}
```

**Permission Inheritance**:
```rust
pub fn check_permission(env: Env, address: Address, permission: Permission, context: Option<Bytes>) -> bool {
    let roles = Self::get_active_roles(&env, &address);
    
    for role in roles.iter() {
        if Self::role_has_permission(&env, role, &permission) {
            if Self::check_conditions(&env, role, &permission, context, address) {
                return true;
            }
        }
    }
    
    false
}

fn role_has_permission(env: &Env, role: &Role, permission: &Permission) -> bool {
    // Check direct permissions
    if let Some(perms) = env.storage().instance().get::<DataKey, Vec<Permission>>(&DataKey::RolePermissions(role.clone())) {
        if perms.iter().any(|p| p.resource == permission.resource && p.action == permission.action) {
            return true;
        }
    }
    
    // Check inherited permissions through hierarchy
    if let Some(hierarchy) = env.storage().instance().get::<DataKey, RoleHierarchy>(&DataKey::RoleHierarchy(role.clone())) {
        if let Some(parent) = hierarchy.parent_role {
            return Self::role_has_permission(env, &parent, permission);
        }
    }
    
    false
}
```

### Phase 3: Enhanced Role Assignment

**Time-Based Roles**:
```rust
pub fn grant_role(env: Env, to: Address, role: Role, expires_at: Option<u64>, context: Option<Bytes>) {
    let admin = Self::super_admin(&env);
    admin.require_auth();
    
    // Check if admin can grant this role
    if !Self::can_grant_role(&env, &admin, &role) {
        panic!("insufficient privileges to grant this role");
    }
    
    let assignment = RoleAssignment {
        address: to.clone(),
        role: role.clone(),
        granted_by: admin.clone(),
        granted_at: env.ledger().timestamp(),
        expires_at,
        context,
        conditions: None,
        is_delegatable: Self::is_role_delegatable(&env, &role),
    };
    
    env.storage().persistent().set(&DataKey::RoleAssignment(to.clone(), role.clone()), &assignment);
    
    // Update active roles
    let mut active_roles = env.storage().persistent().get::<DataKey, Vec<Role>>(&DataKey::ActiveRoles(to.clone())).unwrap_or(Vec::new(&env));
    if !active_roles.iter().any(|r| r == &role) {
        active_roles.push_back(role);
        env.storage().persistent().set(&DataKey::ActiveRoles(to), &active_roles);
    }
    
    // Log event
    env.events().publish((symbol_short!("rbac"), symbol_short!("role_grant")), EvtRoleGranted {
        version: 1,
        ledger: env.ledger().sequence(),
        actor: admin.clone(),
        to,
        role,
        by: admin,
        expires_at,
        context,
        delegation_chain: Self::get_delegation_chain(&env, &admin),
    });
}
```

### Phase 4: Revocation System

**Notice-Based Revocation**:
```rust
pub fn request_revocation(env: Env, target_address: Address, role: Role, reason: Bytes, effective_delay_seconds: u64) -> u64 {
    let admin = Self::super_admin(&env);
    admin.require_auth();
    
    let config: RbacConfig = env.storage().instance().get(&DataKey::Config).unwrap();
    
    // Ensure minimum notice period
    if effective_delay_seconds < config.min_revocation_notice_seconds && !config.emergency_revocation_enabled {
        panic!("revocation notice period too short");
    }
    
    let request_id = env.storage().instance().get::<DataKey, u64>(&DataKey::RevocationRequest(0)).unwrap_or(0) + 1;
    env.storage().instance().set(&DataKey::RevocationRequest(0), &request_id);
    
    let request = RevocationRequest {
        id: request_id,
        target_address: target_address.clone(),
        role: role.clone(),
        requested_by: admin.clone(),
        reason: reason.clone(),
        requested_at: env.ledger().timestamp(),
        status: RevocationStatus::Pending,
        effective_at: env.ledger().timestamp() + effective_delay_seconds as u64,
    };
    
    env.storage().persistent().set(&DataKey::RevocationRequest(request_id), &request);
    
    // Add to pending revocations
    let mut pending = env.storage().persistent().get::<DataKey, Vec<u64>>(&DataKey::PendingRevocations(target_address.clone())).unwrap_or(Vec::new(&env));
    pending.push_back(request_id);
    env.storage().persistent().set(&DataKey::PendingRevocations(target_address), &pending);
    
    request_id
}

pub fn execute_revocation(env: Env, request_id: u64) {
    let admin = Self::super_admin(&env);
    admin.require_auth();
    
    let mut request: RevocationRequest = env.storage().persistent().get(&DataKey::RevocationRequest(request_id)).expect("request not found");
    
    let current_time = env.ledger().timestamp();
    if current_time < request.effective_at && !Self::is_emergency(&env) {
        panic!("revocation not yet effective");
    }
    
    // Remove role assignment
    env.storage().persistent().remove(&DataKey::RoleAssignment(request.target_address.clone(), request.role.clone()));
    
    // Update active roles
    if let Some(mut active_roles) = env.storage().persistent().get::<DataKey, Vec<Role>>(&DataKey::ActiveRoles(request.target_address.clone())) {
        active_roles = active_roles.into_iter().filter(|r| r != &request.role).collect();
        env.storage().persistent().set(&DataKey::ActiveRoles(request.target_address), &active_roles);
    }
    
    // Remove from pending
    if let Some(mut pending) = env.storage().persistent().get::<DataKey, Vec<u64>>(&DataKey::PendingRevocations(request.target_address.clone())) {
        pending = pending.into_iter().filter(|id| id != &request_id).collect();
        env.storage().persistent().set(&DataKey::PendingRevocations(request.target_address), &pending);
    }
    
    request.status = RevocationStatus::Executed;
    env.storage().persistent().set(&DataKey::RevocationRequest(request_id), &request);
    
    // Log event
    env.events().publish((symbol_short!("rbac"), symbol_short!("role_revoke")), EvtRoleRevoked {
        version: 1,
        ledger: env.ledger().sequence(),
        actor: admin.clone(),
        from: request.target_address,
        role: request.role,
        by: admin,
        reason: request.reason,
        notice_period_seconds: request.effective_at - request.requested_at,
        was_emergency: Self::is_emergency(&env),
    });
}
```

### Phase 5: Audit Trail

**Comprehensive Logging**:
```rust
pub fn log_audit_event(env: Env, operation: Bytes, success: bool, resource: Option<Bytes>, metadata: Bytes) {
    let caller = env.invoker().expect("no invoker");
    
    let roles = Self::get_active_roles(&env, &caller);
    
    let log_id = env.storage().instance().get::<DataKey, u64>(&DataKey::AuditLog(0)).unwrap_or(0) + 1;
    env.storage().instance().set(&DataKey::AuditLog(0), &log_id);
    
    let audit_entry = EvtAuditTrail {
        version: 1,
        ledger: env.ledger().sequence(),
        actor: caller.clone(),
        operation: operation.clone(),
        success,
        roles_used: roles.clone(),
        resource_accessed: resource.clone(),
        metadata: metadata.clone(),
    };
    
    env.storage().persistent().set_with_ttl(&DataKey::AuditLog(log_id), &audit_entry, 604800); // 1 week TTL
    
    // Add to user's audit index
    let mut user_logs = env.storage().persistent().get::<DataKey, Vec<u64>>(&DataKey::AuditIndex(caller)).unwrap_or(Vec::new(&env));
    user_logs.push_back(log_id);
    env.storage().persistent().set(&DataKey::AuditIndex(caller), &user_logs);
    
    // Publish event
    env.events().publish((symbol_short!("rbac"), symbol_short!("audit")), audit_entry);
}

pub fn get_audit_logs(env: Env, address: Address, limit: u32) -> Vec<EvtAuditTrail> {
    let log_ids = env.storage().persistent().get::<DataKey, Vec<u64>>(&DataKey::AuditIndex(address)).unwrap_or(Vec::new(&env));
    
    let mut logs = Vec::new(&env);
    let count = log_ids.len().min(limit as u32);
    
    for i in (log_ids.len() - count as u32)..log_ids.len() {
        if let Some(log) = env.storage().persistent().get::<DataKey, EvtAuditTrail>(&DataKey::AuditLog(log_ids.get(i).unwrap())) {
            logs.push_back(log);
        }
    }
    
    logs
}
```

### Phase 6: Delegation System

**Role Delegation**:
```rust
pub fn delegate_role(env: Env, to: Address, role: Role, expires_at: Option<u64>) {
    let caller = env.invoker().expect("no invoker");
    
    // Check if caller has the role
    if !Self::has_role(&env, &caller, &role) {
        panic!("caller does not have the role to delegate");
    }
    
    // Check if role is delegatable
    let assignment = env.storage().persistent().get::<DataKey, RoleAssignment>(&DataKey::RoleAssignment(caller.clone(), role.clone())).expect("caller does not have role");
    if !assignment.is_delegatable {
        panic!("role is not delegatable");
    }
    
    // Create delegation chain
    let delegation_chain = Self::get_delegation_chain(&env, &caller);
    
    let new_assignment = RoleAssignment {
        address: to.clone(),
        role: role.clone(),
        granted_by: caller.clone(),
        granted_at: env.ledger().timestamp(),
        expires_at,
        context: None,
        conditions: None,
        is_delegatable: false,  // Delegated roles cannot be further delegated
    };
    
    env.storage().persistent().set(&DataKey::RoleAssignment(to.clone(), role.clone()), &new_assignment);
    
    // Log delegation
    env.events().publish((symbol_short!("rbac"), symbol_short!("delegate")), EvtDelegationChain {
        version: 1,
        ledger: env.ledger().sequence(),
        actor: caller.clone(),
        delegator: caller,
        delegatee: to,
        role,
        chain_length: delegation_chain.len() as u32,
    });
}
```

## Migration Strategy

### Phase 1: Backward Compatibility

Keep existing functions working while adding new features:

```rust
// Legacy functions (maintained for compatibility)
pub fn grant_role(env: Env, to: Address, role: Role) {
    Self::grant_role_with_options(env, to, role, None, None);
}

pub fn revoke_role(env: Env, from: Address, role: Role) {
    Self::request_revocation(env, from, role, Bytes::from_slice(&env, b"legacy"), 0);
    Self::execute_revocation(env, 0);  // Immediate execution for legacy
}
```

### Phase 2: Data Migration

Provide migration function to convert old storage format:

```rust
pub fn migrate_to_v2(env: Env) {
    let admin = Self::super_admin(&env);
    admin.require_auth();
    
    // Migrate role assignments
    // Migrate to new storage structure
    // Set up default hierarchy
    // Configure default guarantees
}
```

### Phase 3: Gradual Rollout

1. Deploy new contract alongside old one
2. Migrate critical roles first
3. Update consuming contracts gradually
4. Decommission old contract after validation

## Testing Strategy

### Unit Tests

1. **Hierarchy Tests**:
   - Role inheritance correctness
   - Circular dependency detection
   - Permission inheritance
   - Priority resolution

2. **Revocation Tests**:
   - Notice period enforcement
   - Emergency revocation
   - Revocation execution
   - Revocation guarantees

3. **Delegation Tests**:
   - Delegation chain tracking
   - Delegation limits
   - Delegation revocation
   - Circular delegation prevention

4. **Audit Tests**:
   - Event completeness
   - Log retention
   - Query performance
   - Data integrity

### Property Tests

1. **Role Consistency**: Roles maintain hierarchy invariants
2. **Permission Safety**: Unauthorized access is always prevented
3. **Revocation Guarantees**: Revocations are always honored
4. **Audit Completeness**: All operations are logged

### Integration Tests

1. **Contract Integration**: Test with consuming contracts
2. **Performance**: Benchmark permission checks
3. **Stress**: Test with many roles and assignments
4. **Recovery**: Test emergency procedures

## Benefits

1. **Flexibility**: Dynamic role definition and hierarchy
2. **Security**: Enhanced revocation guarantees
3. **Auditability**: Comprehensive audit trail
4. **Composability**: Reusable across contracts
5. **Delegation**: Controlled authority delegation
6. **Time-Based Access**: Temporary permissions
7. **Context Awareness**: Resource-level control
8. **Formal Specification**: Clear security properties

## Next Steps

1. Implement enhanced RBAC contract
2. Write comprehensive tests
3. Create migration tools
4. Update documentation
5. Deploy to testnet
6. Monitor and iterate
7. Migrate existing contracts
8. Decommission old RBAC
