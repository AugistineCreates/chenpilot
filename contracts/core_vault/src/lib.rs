// ────────────────────────────────────────────────────────────────────────────────

#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, BytesN, Env, IntoVal, Symbol, Val, Vec,
    symbol_short,
};
use contract_failure::{fail, unwrap_or_fail, FailureReason};
use pause_state;

// Unified role enum - must match UnifiedAuth contract
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

// ~1 hour at 5s/ledger
const TIMELOCK_LEDGERS: u32 = 720;

// 48 hours at 5s/ledger
const FORCE_EXIT_DELAY: u64 = 172_800;

// TTL for force-exit requests: ~50 hours (360000 ledgers at 5s/ledger)
const FORCE_EXIT_TTL_LEDGERS: u32 = 360_000;

// TTL for deposit records: ~7 days (persistent, but with TTL extension for active accounts)
const DEPOSIT_TTL_LEDGERS: u32 = 1_209_600;

// ─── Events ─────────────────────────────────────────────────────────────────────

const EVT_INIT: Symbol = symbol_short!("init");
const EVT_DEPOSIT: Symbol = symbol_short!("deposit");
const EVT_WITHDRAWAL: Symbol = symbol_short!("w");
const EVT_FORCE_EXIT_REQ: Symbol = symbol_short!("fexit_req");
const EVT_FORCE_EXIT_CMPL: Symbol = symbol_short!("fexit_c");
const EVT_RECOVERY: Symbol = symbol_short!("recovery");
const EVT_UPG_PROP: Symbol = symbol_short!("upg_prop");
const EVT_UPG_CNCL: Symbol = symbol_short!("upg_cncl");
const EVT_UPG_DONE: Symbol = symbol_short!("upg_done");
const EVT_ADM_XFER: Symbol = symbol_short!("adm_xfer");

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // Legacy admin for backward compatibility
    Admin,
    // UnifiedAuth integration
    UnifiedAuth,
    PendingUpgrade,
    BackendOnline,
    Deposit(Address),
    ForceExit(Address),
    VaultToken,
    // Upgrade mode flag
    UpgradeMode,
    // Per-admin nonce to bind each privileged authorization to a single use.
    AuthNonce(Address),
}

#[contracttype]
#[derive(Clone)]
pub struct PendingUpgrade {
    pub new_wasm_hash: BytesN<32>,
    pub unlock_ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct ForceExitRequest {
    pub amount: i128,
    pub eligible_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct DepositEvent {
    pub user: Address,
    pub amount: i128,
    pub total_deposited: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct WithdrawalEvent {
    pub user: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct RecoveryEvent {
    pub user: Address,
    pub amount: i128,
    pub reason: RecoveryReason,
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum RecoveryReason {
    ForceExitTimeout,
    AdminIntervention,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtInit {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub admin: Address,
    pub vault_token: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtBackendStatus {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub online: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtDeposit {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub user: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtForceExitReq {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub user: Address,
    pub amount: i128,
    pub eligible_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtForceExitDone {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub user: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtUpgProp {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub new_wasm_hash: BytesN<32>,
    pub unlock_ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtUpgCncl {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtUpgDone {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub new_wasm_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtAdmXfer {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub old_admin: Address,
    pub new_admin: Address,
}

#[contract]
pub struct CoreVaultContract;

#[contractimpl]
impl CoreVaultContract {
    /// Initialize the contract with an admin, vault token, and unified auth address.
    /// Emits `init` event on success.
    pub fn init(env: Env, admin: Address, vault_token: Address, unified_auth: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            fail(&env, FailureReason::AlreadyInitialized);
        }
        // Reject hallucinated or non-contract addresses.
        assert!(vault_token.as_contract().is_some(), "unresolved asset");
        assert!(unified_auth.as_contract().is_some(), "unresolved authority");
        // Verify the vault token is a valid token contract.
        let token_client = token::Client::new(&env, &vault_token);
        let _ = token_client.decimals();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::VaultToken, &vault_token);
        env.storage().instance().set(&DataKey::UnifiedAuth, &unified_auth);
        env.storage().instance().set(&DataKey::BackendOnline, &true);
        env.storage().instance().set(&DataKey::UpgradeMode, &false);
        env.events().publish(
            (EVT_INIT,),
            admin.clone(),
        );
    }

    // ── Backend status ────────────────────────────────────────────────────────

    /// Admin marks the backend as offline, enabling force-exit requests.
    /// Trust boundary: VAULT_ADMIN or EMERGENCY_ADMIN - users cannot manipulate backend status.
    pub fn set_backend_status(env: Env, online: bool) {
        let args: Vec<Val> = (online,).into_val(&env);
        let admin = Self::require_vault_or_emergency_admin(
            &env,
            Symbol::new(&env, "set_backend_status"),
            args,
        );
        
        // Check emergency state - cannot change backend status during emergency
        if Self::is_emergency_active(&env) {
            fail(&env, FailureReason::EmergencyMode);
        }
        
        // Check upgrade mode - restrict backend changes during upgrade
        if Self::is_upgrade_mode_internal(&env) {
            fail(&env, FailureReason::UpgradeMode);
        }
        
        env.storage().instance().set(&DataKey::BackendOnline, &online);

        env.events().publish(
            // "backend_status" is 14 chars — over symbol_short!'s 9-char
            // limit, so this uses Symbol::new (max 32 chars) instead.
            (symbol_short!("vault"), Symbol::new(&env, "backend_status")),
            EvtBackendStatus {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: admin,
                online,
            },
        );
    }

    pub fn is_backend_online(env: Env) -> bool {
        env.storage().instance().get(&DataKey::BackendOnline).unwrap_or(true)
    }

    // ── Emergency pause (see the `pause_state` crate for the standard) ─────────
    //
    // Deposits are blocked while paused — no new funds should enter the vault
    // during an incident. Withdrawal and force-exit stay available: pausing
    // is meant to stop new exposure, not trap funds users already deposited.
    // This mirrors common DeFi vault emergency-pause conventions and is a
    // deliberate choice, not an oversight — see the module doc on
    // `pause_state` for the composable pattern this implements.

    /// Pause the vault. Blocks `deposit()` until `unpause()` is called.
    /// Trust boundary: VAULT_ADMIN or EMERGENCY_ADMIN, same as
    /// `set_backend_status`.
    /// Emits the standard `pause_state` `pause_chg` event.
    pub fn pause(env: Env) {
        let admin = Self::require_vault_or_emergency_admin(
            &env,
            symbol_short!("pause"),
            Vec::new(&env),
        );
        pause_state::pause(&env, admin);
    }

    /// Unpause the vault, re-enabling `deposit()`.
    /// Trust boundary: VAULT_ADMIN or EMERGENCY_ADMIN.
    /// Emits the standard `pause_state` `pause_chg` event.
    pub fn unpause(env: Env) {
        let admin = Self::require_vault_or_emergency_admin(
            &env,
            symbol_short!("unpause"),
            Vec::new(&env),
        );
        pause_state::unpause(&env, admin);
    }

    /// Whether the vault is currently paused. Safe to call from another
    /// contract via a `#[contractclient]` trait for cross-contract pause
    /// checks — see `pause_state`'s module doc.
    pub fn is_paused(env: Env) -> bool {
        pause_state::is_paused(&env)
    }

    // ── Deposit ───────────────────────────────────────────────────────────────

    /// Deposit tokens into the vault.
    /// Only allowed when backend is ONLINE and the vault is not paused.
    /// Trust boundary: Funds are non-custodial - user owns their deposit balance.
    /// Emits `deposit` event on success.
    pub fn deposit(env: Env, user: Address, amount: i128) {
        user.require_auth();
        pause_state::require_not_paused(&env);
        if !Self::is_backend_online(env.clone()) {
            fail(&env, FailureReason::BackendOffline);
        }

        let vault_token: Address =
            unwrap_or_fail(&env, env.storage().instance().get(&DataKey::VaultToken), FailureReason::StorageValueMissing);
        let token_client = token::Client::new(&env, &vault_token);
        token_client.transfer(&user, &env.current_contract_address(), &amount);

        let current: i128 = env.storage().persistent()
            .get(&DataKey::Deposit(user.clone()))
            .unwrap_or(0);
        let new_balance = current + amount;
        
        // Store deposit with TTL extension to keep active accounts fresh
        env.storage().persistent().set(&DataKey::Deposit(user.clone()), &new_balance);
        env.storage().persistent().extend_ttl(&DataKey::Deposit(user.clone()), 100, DEPOSIT_TTL_LEDGERS);

        env.events().publish(
            (EVT_DEPOSIT, user.clone()),
            DepositEvent { user, amount, total_deposited: new_balance },
        );
    }

    // ── Withdrawal ────────────────────────────────────────────────────────────

    /// Normal withdrawal when backend is ONLINE.
    /// Trust boundary: Users can withdraw their own balance; contract holds no custody.
    /// Emits `w` event on success.
    pub fn withdrawal(env: Env, user: Address, amount: i128) {
        user.require_auth();
        if !Self::is_backend_online(env.clone()) {
            fail(&env, FailureReason::BackendOffline);
        }

        let balance: i128 = env.storage().persistent()
            .get(&DataKey::Deposit(user.clone()))
            .unwrap_or(0);
        if balance < amount {
            fail(&env, FailureReason::InsufficientBalance);
        }

        let new_balance = balance - amount;
        if new_balance == 0 {
            env.storage().persistent().remove(&DataKey::Deposit(user.clone()));
        } else {
            env.storage().persistent().set(&DataKey::Deposit(user.clone()), &new_balance);
            env.storage().persistent().extend_ttl(&DataKey::Deposit(user.clone()), 100, DEPOSIT_TTL_LEDGERS);
        }

        let vault_token: Address =
            unwrap_or_fail(&env, env.storage().instance().get(&DataKey::VaultToken), FailureReason::StorageValueMissing);
        let token_client = token::Client::new(&env, &vault_token);
        token_client.transfer(&env.current_contract_address(), &user, &amount);

        env.events().publish(
            (EVT_WITHDRAWAL, user.clone()),
            WithdrawalEvent { user, amount },
        );
    }

    // ── Force Exit ────────────────────────────────────────────────────────────

    /// Initiate a force-exit. Only allowed when backend is OFFLINE.
    /// Starts the 48-hour challenge period.
    /// Trust boundary: Escape hatch for users when backend is unavailable.
    /// Emits `fexit_req` event on success.
    pub fn force_exit_request(env: Env, user: Address) {
        user.require_auth();
        if Self::is_backend_online(env.clone()) {
            fail(&env, FailureReason::BackendOnline);
        }

        let balance: i128 = env.storage().persistent()
            .get(&DataKey::Deposit(user.clone()))
            .unwrap_or(0);
        if balance <= 0 {
            fail(&env, FailureReason::InsufficientBalance);
        }

        // Prevent duplicate requests
        if env.storage().persistent().has(&DataKey::ForceExit(user.clone())) {
            fail(&env, FailureReason::ForceExitAlreadyPending);
        }

        let eligible_at = env.ledger().timestamp() + FORCE_EXIT_DELAY;
        let req = ForceExitRequest { amount: balance, eligible_at };
        
        // Store force-exit with TTL to auto-expire unclaimed requests after ~50 hours
        // This prevents stale requests from accumulating indefinitely
        env.storage().persistent().set(&DataKey::ForceExit(user.clone()), &req);
        env.storage().persistent().extend_ttl(&DataKey::ForceExit(user.clone()), 100, FORCE_EXIT_TTL_LEDGERS);

        env.events().publish(
            (EVT_FORCE_EXIT_REQ, user),
            req,
        );
    }

    /// Complete the force-exit after the 48-hour challenge period has passed.
    /// Trust boundary: Users can claim their own funds after challenge period.
    /// Emits `fexit_c` event on success.
    pub fn force_exit_complete(env: Env, user: Address) {
        user.require_auth();

        let req: ForceExitRequest = env.storage().persistent()
            .get(&DataKey::ForceExit(user.clone()))
            .unwrap_or_else(|| fail(&env, FailureReason::NoPendingForceExit));

        if env.ledger().timestamp() < req.eligible_at {
            fail(&env, FailureReason::ChallengePeriodNotElapsed);
        }

        // Clear state before transfer (re-entrancy guard)
        env.storage().persistent().remove(&DataKey::ForceExit(user.clone()));
        env.storage().persistent().remove(&DataKey::Deposit(user.clone()));

        let vault_token: Address =
            unwrap_or_fail(&env, env.storage().instance().get(&DataKey::VaultToken), FailureReason::StorageValueMissing);
        let token_client = token::Client::new(&env, &vault_token);
        token_client.transfer(&env.current_contract_address(), &user, &req.amount);

        env.events().publish(
            (EVT_FORCE_EXIT_CMPL, user),
            req,
        );
    }

    /// Recovery: Cancel a pending force-exit request.
    /// Only callable by VAULT_ADMIN or EMERGENCY_ADMIN.
    /// Trust boundary: ADMIN emergency function for edge cases.
    /// Emits `recovery` event on success.
    /// Note: During force_exit_request, the deposit is NOT removed. It is only removed
    /// during force_exit_complete. This function cancels the pending request without
    /// modifying the deposit balance.
    pub fn recovery(env: Env, user: Address) {
        let args: Vec<Val> = (user.clone(),).into_val(&env);
        Self::require_vault_or_emergency_admin(
            &env,
            Symbol::new(&env, "recovery"),
            args,
        );

        let req: ForceExitRequest = env.storage().persistent()
            .get(&DataKey::ForceExit(user.clone()))
            .unwrap_or_else(|| fail(&env, FailureReason::NoPendingForceExit));

        // Validate state consistency
        let deposit: i128 = env.storage().persistent()
            .get(&DataKey::Deposit(user.clone()))
            .unwrap_or(0);
        if deposit != req.amount {
            fail(&env, FailureReason::DepositForceExitMismatch);
        }

        // Remove force exit request - deposit balance remains unchanged
        env.storage().persistent().remove(&DataKey::ForceExit(user.clone()));

        env.events().publish(
            (EVT_RECOVERY, user.clone()),
            RecoveryEvent { user, amount: req.amount, reason: RecoveryReason::AdminIntervention },
        );
    }

    /// Returns a pending force-exit request for a user, if any
    pub fn get_force_exit(env: Env, user: Address) -> Option<ForceExitRequest> {
        env.storage().persistent().get(&DataKey::ForceExit(user))
    }

    /// Returns the current deposit balance for a user
    pub fn get_deposit(env: Env, user: Address) -> Option<i128> {
        env.storage().persistent().get(&DataKey::Deposit(user))
    }

    // ── Upgrade time-lock ─────────────────────────────────────────────────────

    /// Propose a contract upgrade. Starts ~1 hour timelock.
    /// Trust boundary: UPGRADE_ADMIN ONLY - upgrade is time-locked, not immediately executable.
    /// Enters upgrade mode which restricts critical state changes.
    /// Emits `upg_prop` event on success.
    pub fn propose_upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let args: Vec<Val> = (new_wasm_hash.clone(),).into_val(&env);
        let caller = Self::require_upgrade_admin(
            &env,
            Symbol::new(&env, "propose_upgrade"),
            args,
        );
        
        // Check emergency state - cannot upgrade during emergency
        if Self::is_emergency_active(&env) {
            fail(&env, FailureReason::EmergencyMode);
        }

        let unlock_ledger = env.ledger().sequence() + TIMELOCK_LEDGERS;
        let pending = PendingUpgrade { new_wasm_hash: new_wasm_hash.clone(), unlock_ledger };
        env.storage().instance().set(&DataKey::PendingUpgrade, &pending);
        
        // Enter upgrade mode - restricts critical state changes
        env.storage().instance().set(&DataKey::UpgradeMode, &true);

        env.events().publish(
            (EVT_UPG_PROP, caller),
            pending,
        );
    }

    /// Cancel a pending upgrade.
    /// Trust boundary: UPGRADE_ADMIN ONLY - before timelock expires.
    /// Exits upgrade mode and restores normal operations.
    /// Emits `upg_cncl` event on success.
    pub fn cancel_upgrade(env: Env) {
        let caller = Self::require_upgrade_admin(
            &env,
            Symbol::new(&env, "cancel_upgrade"),
            Vec::new(&env),
        );
        env.storage().instance().remove(&DataKey::PendingUpgrade);
        
        // Exit upgrade mode
        env.storage().instance().set(&DataKey::UpgradeMode, &false);

        env.events().publish(
            (EVT_UPG_CNCL, caller.clone()),
            caller,
        );
    }

    /// Apply the pending upgrade after timelock has elapsed.
    /// Trust boundary: Anyone can call after timelock expires (admin or public).
    /// Exits upgrade mode after successful upgrade.
    /// Emits `upg_done` event on success.
    pub fn apply_upgrade(env: Env) {
        let pending: PendingUpgrade = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgrade)
            .unwrap_or_else(|| fail(&env, FailureReason::NoPendingUpgrade));

        if env.ledger().sequence() < pending.unlock_ledger {
            fail(&env, FailureReason::TimelockNotExpired);
        }

        let wasm_hash = pending.new_wasm_hash.clone();
        env.storage().instance().remove(&DataKey::PendingUpgrade);
        
        // Exit upgrade mode after successful upgrade
        env.storage().instance().set(&DataKey::UpgradeMode, &false);
        
        env.deployer().update_current_contract_wasm(wasm_hash.clone());

        env.events().publish(
            (EVT_UPG_DONE,),
            wasm_hash,
        );
    }

    /// Transfer admin role to a new address.
    /// Trust boundary: CURRENT ADMIN ONLY (legacy) - use UnifiedAuth for role management.
    /// Emits `adm_xfer` event on success.
    pub fn transfer_admin(env: Env, new_admin: Address) {
        let args: Vec<Val> = (new_admin.clone(),).into_val(&env);
        let admin = Self::require_legacy_admin(
            &env,
            Symbol::new(&env, "transfer_admin"),
            args,
        );

        let old_admin = admin.clone();
        env.storage().instance().set(&DataKey::Admin, &new_admin);

        env.events().publish(
            (EVT_ADM_XFER,),
            (old_admin, new_admin),
        );
    }
    
    /// Set the UnifiedAuth contract address.
    /// Trust boundary: CURRENT ADMIN ONLY.
    pub fn set_unified_auth(env: Env, unified_auth: Address) {
        let args: Vec<Val> = (unified_auth.clone(),).into_val(&env);
        Self::require_legacy_admin(
            &env,
            Symbol::new(&env, "set_unified_auth"),
            args,
        );
        env.storage().instance().set(&DataKey::UnifiedAuth, &unified_auth);
    }
    
    // ─── UnifiedAuth Integration Helpers ─────────────────────────────────────
    
    fn get_unified_auth_internal(env: &Env) -> Address {
        env.storage().instance().get(&DataKey::UnifiedAuth)
            .unwrap_or_else(|| fail(env, FailureReason::UnifiedAuthNotConfigured))
    }
    
    /// Authenticate the legacy admin for the exact `function` and `args`.
    ///
    /// Trust assumptions:
    /// - The legacy admin is the current trust anchor until UnifiedAuth is wired.
    /// - The auth payload binds vault address, function symbol, arguments, and a
    ///   per-admin nonce, preventing confused-deputy and replay attacks.
    fn require_legacy_admin(env: &Env, function: Symbol, args: Vec<Val>) -> Address {
        let admin: Address =
            unwrap_or_fail(env, env.storage().instance().get(&DataKey::Admin), FailureReason::StorageValueMissing);
        let nonce: u32 = env.storage().instance()
            .get(&DataKey::AuthNonce(admin.clone()))
            .unwrap_or(0);
        env.storage().instance()
            .set(&DataKey::AuthNonce(admin.clone()), &(nonce + 1));

        let mut auth: Vec<Val> = Vec::new(env);
        auth.push_back(env.current_contract_address().into_val(env));
        auth.push_back(function.into_val(env));
        for arg in args.iter() {
            auth.push_back(*arg);
        }
        auth.push_back(nonce.into_val(env));

        admin.require_auth_for_args(&auth);
        admin
    }

    fn require_vault_or_emergency_admin(env: &Env, function: Symbol, args: Vec<Val>) -> Address {
        let _unified_auth = Self::get_unified_auth_internal(env);
        // TODO: enforce VaultAdmin/EmergencyAdmin roles via UnifiedAuth.
        Self::require_legacy_admin(env, function, args)
    }
    
    fn require_upgrade_admin(env: &Env, function: Symbol, args: Vec<Val>) -> Address {
        let _unified_auth = Self::get_unified_auth_internal(env);
        // TODO: enforce UpgradeAdmin role via UnifiedAuth.
        Self::require_legacy_admin(env, function, args)
    }
    
    /// Now backed by the real `pause_state` standard rather than a
    /// hard-coded `false`. `set_backend_status` and `propose_upgrade`
    /// already gated themselves on this — pausing the vault via
    /// `Self::pause()` now actually blocks those operations, as their
    /// existing "Check emergency state" comments always assumed it would.
    fn is_emergency_active(env: &Env) -> bool {
        pause_state::is_paused(env)
    }
    
    fn is_upgrade_mode_internal(env: &Env) -> bool {
        env.storage().instance().get(&DataKey::UpgradeMode).unwrap_or(false)
    }

    pub fn upgrade_unlock_ledger(env: Env) -> u32 {
        env.storage()
            .instance()
            .get::<DataKey, PendingUpgrade>(&DataKey::PendingUpgrade)
            .map(|p| p.unlock_ledger)
            .unwrap_or(0)
    }

    pub fn is_upgrade_mode(env: Env) -> bool {
        Self::is_upgrade_mode_internal(&env)
    }
    
    pub fn get_unified_auth(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::UnifiedAuth)
    }
}

mod test;
mod test_pause;
#[cfg(test)]
mod test_diff_fuzz;
