#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Env, Address, Symbol};
use contract_failure::{fail, FailureReason};

/// The three roles this contract manages.
/// Stored per-address — an address can hold multiple roles.
#[contracttype]
#[derive(Clone, PartialEq)]
pub enum Role {
    OracleProvider,
    AgentOperator,
    EmergencyAdmin,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Superadmin that can grant/revoke any role
    SuperAdmin,
    /// (Address, Role) -> bool
    HasRole(Address, Role),
    /// Symbol -> AssetRegistration
    Asset(Symbol),
}

#[contracttype]
#[derive(Clone)]
pub struct AssetRegistration {
    pub contract: Address,
    pub registered_at: u32,
    pub registered_by: Address,
}

// ── Event data ────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct EvtRoleGranted {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub to: Address,
    pub role: Role,
    pub by: Address,
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
pub struct EvtInit {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub super_admin: Address,
}

// ─────────────────────────────────────────────────────────────────────────────

#[contract]
pub struct RbacContract;

#[contractimpl]
impl RbacContract {
    /// One-time setup — sets the super-admin.
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::SuperAdmin) {
            fail(&env, FailureReason::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::SuperAdmin, &admin);

        env.events().publish(
            (symbol_short!("rbac"), symbol_short!("init")),
            EvtInit {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: admin.clone(),
                super_admin: admin,
            },
        );
    }

    /// Grant a role to an address. Only super-admin can call this.
    pub fn grant_role(env: Env, to: Address, role: Role) {
        let admin = Self::super_admin(&env);
        admin.require_auth();

        env.storage()
            .persistent()
            .set(&DataKey::HasRole(to.clone(), role.clone()), &true);

        env.events().publish(
            (symbol_short!("rbac"), symbol_short!("role_grant")),
            EvtRoleGranted {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: admin.clone(),
                to,
                role,
                by: admin,
            },
        );
    }

    /// Revoke a role from an address. Only super-admin can call this.
    pub fn revoke_role(env: Env, from: Address, role: Role) {
        let admin = Self::super_admin(&env);
        admin.require_auth();

        env.storage()
            .persistent()
            .remove(&DataKey::HasRole(from.clone(), role.clone()));

        env.events().publish(
            (symbol_short!("rbac"), symbol_short!("role_revoke")),
            EvtRoleRevoked {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: admin.clone(),
                from,
                role,
                by: admin,
            },
        );
    }

    /// Check whether an address holds a given role.
    pub fn has_role(env: Env, addr: Address, role: Role) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::HasRole(addr, role))
            .unwrap_or(false)
    }

    /// Transfer super-admin to a new address.
    pub fn transfer_admin(env: Env, new_admin: Address) {
        let old_admin = Self::super_admin(&env);
        old_admin.require_auth();
        env.storage().instance().set(&DataKey::SuperAdmin, &new_admin);

        env.events().publish(
            (symbol_short!("rbac"), symbol_short!("adm_xfer")),
            EvtAdminTransferred {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: old_admin.clone(),
                old_admin,
                new_admin,
            },
        );
    }

    /// Register a canonical symbol for an asset contract.
    /// Only the super-admin can add or update entries.
    pub fn register_asset(env: Env, symbol: Symbol, contract: Address) {
        let admin = Self::super_admin(&env);
        admin.require_auth();
        let registration = AssetRegistration {
            contract: contract.clone(),
            registered_at: env.ledger().sequence(),
            registered_by: admin.clone(),
        };
        env.storage().persistent().set(&DataKey::Asset(symbol), &registration);
    }

    /// Resolve a canonical symbol to its registered contract address.
    /// Fails if the symbol is not registered, preventing hallucinated symbols.
    pub fn resolve_asset(env: Env, symbol: Symbol) -> Address {
        let registration = env
            .storage()
            .persistent()
            .get::<DataKey, AssetRegistration>(&DataKey::Asset(symbol))
            .unwrap_or_else(|| fail(&env, FailureReason::Unauthorized));
        registration.contract
    }

    /// Get the full registration record for approval/provenance purposes.
    pub fn get_asset_registration(env: Env, symbol: Symbol) -> AssetRegistration {
        env.storage()
            .persistent()
            .get::<DataKey, AssetRegistration>(&DataKey::Asset(symbol))
            .unwrap_or_else(|| fail(&env, FailureReason::Unauthorized))
    }

    // ── Role-gated action helpers ─────────────────────────────────────────────
    // These are the entry points other contracts / the SDK would call.
    // Each asserts the caller holds the required role before proceeding.

    /// Only an OracleProvider may submit a price feed update.
    ///
    /// Security: Authorization is bound to the transaction source account
    /// (`env.invoker()`) and to the exact contract, function, and arguments.
    /// Nested invocation through other contracts cannot alter or replay this
    /// authorization.
    pub fn submit_price(env: Env, price: i128) -> i128 {
        let caller = env.invoker();
        caller.require_auth();
        Self::assert_role(&env, &caller, Role::OracleProvider);
        // real logic would store the price; return it for testability
        price
    }

    /// Only an AgentOperator may trigger an agent task.
    ///
    /// Security: Same as [`submit_price`] — authorization is bound to the
    /// transaction source account and to the exact arguments.
    pub fn run_agent(env: Env, task_id: u32) -> u32 {
        let caller = env.invoker();
        caller.require_auth();
        Self::assert_role(&env, &caller, Role::AgentOperator);
        task_id
    }

    /// Only an EmergencyAdmin may pause the system.
    ///
    /// Security: Same as [`submit_price`] — authorization is bound to the
    /// transaction source account and to the exact arguments.
    pub fn emergency_pause(env: Env) {
        let caller = env.invoker();
        caller.require_auth();
        Self::assert_role(&env, &caller, Role::EmergencyAdmin);
        // real logic would flip a pause flag
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    fn super_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::SuperAdmin)
            .unwrap_or_else(|| fail(env, FailureReason::NotInitialized))
    }

    fn assert_role(env: &Env, addr: &Address, role: Role) {
        let has = env
            .storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::HasRole(addr.clone(), role))
            .unwrap_or(false);
        if !has {
            fail(env, FailureReason::Unauthorized);
        }
    }
}

mod test;
