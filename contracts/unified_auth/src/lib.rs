#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Env, Address, BytesN, Vec, Map};

// ─── Roles ─────────────────────────────────────────────────────────────────────

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

// ─── Contract Identifiers ───────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum ContractId {
    CoreVault,
    Rbac,
    StrategyRegistry,
    StrategyBoundary,
    LiquidityVault,
}

// ─── Emergency State ───────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum EmergencyReason {
    ExploitDetected,
    OracleFailure,
    BackendOffline,
    GovernanceDecision,
}

#[contracttype]
#[derive(Clone)]
pub struct EmergencyState {
    pub is_emergency: bool,
    pub triggered_by: Address,
    pub triggered_at: u64,
    pub reason: EmergencyReason,
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    SuperAdmin,
    HasRole(Address, UnifiedRole),
    RegisteredContract(ContractId),
    EmergencyState,
    ContractAddress(ContractId),
}

// ─── Events ───────────────────────────────────────────────────────────────────

const EVT_INIT: soroban_sdk::Symbol = symbol_short!("init");
const EVT_ROLE_GRANTED: soroban_sdk::Symbol = symbol_short!("role_grant");
const EVT_ROLE_REVOKED: soroban_sdk::Symbol = symbol_short!("role_revoke");
const EVT_ADMIN_XFER: soroban_sdk::Symbol = symbol_short!("adm_xfer");
const EVT_EMERGENCY_TRIGGER: soroban_sdk::Symbol = symbol_short!("emerg_trig");
const EVT_EMERGENCY_END: soroban_sdk::Symbol = symbol_short!("emerg_end");
const EVT_CONTRACT_REGISTER: soroban_sdk::Symbol = symbol_short!("contract_reg");
const EVT_CONTRACT_UNREGISTER: soroban_sdk::Symbol = symbol_short!("contract_unreg");

#[contracttype]
#[derive(Clone)]
pub struct EvtInit {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub super_admin: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtRoleGranted {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub to: Address,
    pub role: UnifiedRole,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtRoleRevoked {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub from: Address,
    pub role: UnifiedRole,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtAdminTransferred {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub old_admin: Address,
    pub new_admin: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtEmergencyTriggered {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub reason: EmergencyReason,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtEmergencyEnded {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtContractRegistered {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub contract_id: ContractId,
    pub contract_address: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtContractUnregistered {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub contract_id: ContractId,
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct UnifiedAuthContract;

#[contractimpl]
impl UnifiedAuthContract {
    // ─── Initialization ───────────────────────────────────────────────────────

    /// Initialize the contract with a super admin
    pub fn init(env: Env, super_admin: Address) {
        if env.storage().instance().has(&DataKey::SuperAdmin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::SuperAdmin, &super_admin);

        env.events().publish(
            (EVT_INIT,),
            EvtInit {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: super_admin.clone(),
                super_admin,
            },
        );
    }

    // ─── Role Management ─────────────────────────────────────────────────────

    /// Grant a role to an address. Only SuperAdmin can call this.
    pub fn grant_role(env: Env, to: Address, role: UnifiedRole) {
        let super_admin = Self::super_admin(&env);
        super_admin.require_auth();

        env.storage()
            .persistent()
            .set(&DataKey::HasRole(to.clone(), role.clone()), &true);

        env.events().publish(
            (EVT_ROLE_GRANTED,),
            EvtRoleGranted {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: super_admin,
                to,
                role,
            },
        );
    }

    /// Revoke a role from an address. Only SuperAdmin can call this.
    pub fn revoke_role(env: Env, from: Address, role: UnifiedRole) {
        let super_admin = Self::super_admin(&env);
        super_admin.require_auth();

        env.storage()
            .persistent()
            .remove(&DataKey::HasRole(from.clone(), role.clone()));

        env.events().publish(
            (EVT_ROLE_REVOKED,),
            EvtRoleRevoked {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: super_admin,
                from,
                role,
            },
        );
    }

    /// Check whether an address holds a given role
    pub fn has_role(env: Env, addr: Address, role: UnifiedRole) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::HasRole(addr, role))
            .unwrap_or(false)
    }

    /// Require that an address holds a given role, panic otherwise
    pub fn require_role(env: Env, addr: Address, role: UnifiedRole) {
        if !Self::has_role(env.clone(), addr.clone(), role.clone()) {
            panic!("unauthorized: missing role {:?}", role);
        }
    }

    /// Transfer super admin to a new address
    pub fn transfer_super_admin(env: Env, new_admin: Address) {
        let old_admin = Self::super_admin(&env);
        old_admin.require_auth();
        env.storage().instance().set(&DataKey::SuperAdmin, &new_admin);

        env.events().publish(
            (EVT_ADMIN_XFER,),
            EvtAdminTransferred {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: old_admin.clone(),
                old_admin,
                new_admin,
            },
        );
    }

    // ─── Emergency Coordination ───────────────────────────────────────────────

    /// Trigger emergency mode. Only EmergencyAdmin can call this.
    pub fn trigger_emergency(env: Env, reason: EmergencyReason) {
        let caller = env.current_contract_address();
        Self::require_role(env.clone(), caller.clone(), UnifiedRole::EmergencyAdmin);

        let state = EmergencyState {
            is_emergency: true,
            triggered_by: caller,
            triggered_at: env.ledger().timestamp(),
            reason,
        };

        env.storage().instance().set(&DataKey::EmergencyState, &state);

        env.events().publish(
            (EVT_EMERGENCY_TRIGGER,),
            EvtEmergencyTriggered {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: caller,
                reason,
            },
        );
    }

    /// End emergency mode. Only EmergencyAdmin can call this.
    pub fn end_emergency(env: Env) {
        let caller = env.current_contract_address();
        Self::require_role(env.clone(), caller.clone(), UnifiedRole::EmergencyAdmin);

        env.storage().instance().remove(&DataKey::EmergencyState);

        env.events().publish(
            (EVT_EMERGENCY_END,),
            EvtEmergencyEnded {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: caller,
            },
        );
    }

    /// Check if emergency mode is active
    pub fn is_emergency_active(env: Env) -> bool {
        env.storage()
            .instance()
            .get::<DataKey, EmergencyState>(&DataKey::EmergencyState)
            .map(|s| s.is_emergency)
            .unwrap_or(false)
    }

    /// Get the current emergency state
    pub fn get_emergency_state(env: Env) -> Option<EmergencyState> {
        env.storage()
            .instance()
            .get::<DataKey, EmergencyState>(&DataKey::EmergencyState)
    }

    // ─── Contract Registration ───────────────────────────────────────────────

    /// Register a contract with the unified auth system. Only SuperAdmin can call this.
    pub fn register_contract(env: Env, contract_id: ContractId, contract_address: Address) {
        let super_admin = Self::super_admin(&env);
        super_admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::RegisteredContract(contract_id.clone()), &true);
        env.storage()
            .instance()
            .set(&DataKey::ContractAddress(contract_id.clone()), &contract_address);

        env.events().publish(
            (EVT_CONTRACT_REGISTER,),
            EvtContractRegistered {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: super_admin,
                contract_id,
                contract_address,
            },
        );
    }

    /// Unregister a contract. Only SuperAdmin can call this.
    pub fn unregister_contract(env: Env, contract_id: ContractId) {
        let super_admin = Self::super_admin(&env);
        super_admin.require_auth();

        env.storage()
            .instance()
            .remove(&DataKey::RegisteredContract(contract_id.clone()));
        env.storage()
            .instance()
            .remove(&DataKey::ContractAddress(contract_id.clone()));

        env.events().publish(
            (EVT_CONTRACT_UNREGISTER,),
            EvtContractUnregistered {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: super_admin,
                contract_id,
            },
        );
    }

    /// Check if a contract is registered
    pub fn is_contract_registered(env: Env, contract_id: ContractId) -> bool {
        env.storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::RegisteredContract(contract_id))
            .unwrap_or(false)
    }

    /// Get the address of a registered contract
    pub fn get_contract_address(env: Env, contract_id: ContractId) -> Option<Address> {
        env.storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::ContractAddress(contract_id))
    }

    // ─── Private Helpers ─────────────────────────────────────────────────────

    fn super_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::SuperAdmin)
            .expect("not initialized")
    }
}

mod test;
