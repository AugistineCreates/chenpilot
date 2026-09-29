#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Env, Address, BytesN, Vec, Map, token};

// ─── Risk Levels ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum RiskLevel {
    Low,    // Stable, audited, battle-tested
    Medium, // Audited, newer but proven
    High,   // Experimental, higher yield potential
}

// ─── Strategy Metadata ───────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct StrategyMetadata {
    pub strategy_id: BytesN<32>,
    pub strategy_address: Address,
    pub risk_level: RiskLevel,
    pub max_allocation: i128,
    pub min_liquidity: i128,
    pub withdrawal_delay: u32,
    pub audit_report: BytesN<32>,
    pub audit_expiry: u64,
}

// ─── Allocation Limits ─────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct AllocationLimits {
    pub max_total_allocation: i128,
    pub max_per_strategy: i128,
    pub min_diversification: u32,
    pub max_concentration: u32, // basis points
}

// ─── Health Status ─────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Critical,
    Compromised,
}

#[contracttype]
#[derive(Clone)]
pub struct StrategyHealth {
    pub strategy_id: BytesN<32>,
    pub total_value: i128,
    pub user_funds: i128,
    pub performance: i64,
    pub last_updated: u64,
    pub health_status: HealthStatus,
}

// ─── Withdrawal Request ───────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct WithdrawalRequest {
    pub user: Address,
    pub strategy_id: BytesN<32>,
    pub amount: i128,
    pub requested_at: u64,
    pub eligible_at: u64,
}

// ─── Risk Limits ───────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct RiskLimits {
    pub max_smart_contract_exposure: i128,
    pub max_market_exposure: i128,
    pub max_liquidity_exposure: i128,
    pub max_single_counterparty: i128,
}

// ─── Storage Keys ─────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    UnifiedAuth,
    StrategyMetadata(BytesN<32>),
    AllocationLimits,
    RiskLimits,
    StrategyAllocation(BytesN<32>),
    TotalStrategyAllocation,
    WithdrawalRequest(Address),
    StrategyHealth(BytesN<32>),
    DisabledStrategy(BytesN<32>),
    ActiveStrategies,
    AuthorizedStrategies,
}

// ─── Events ───────────────────────────────────────────────────────────────

const EVT_INIT: soroban_sdk::Symbol = symbol_short!("init");
const EVT_STRATEGY_REGISTER: soroban_sdk::Symbol = symbol_short!("strat_reg");
const EVT_STRATEGY_DISABLE: soroban_sdk::Symbol = symbol_short!("strat_dis");
const EVT_ALLOCATION: soroban_sdk::Symbol = symbol_short!("alloc");
const EVT_WITHDRAWAL_REQ: soroban_sdk::Symbol = symbol_short!("w_req");
const EVT_WITHDRAWAL_COMP: soroban_sdk::Symbol = symbol_short!("w_comp");
const EVT_HEALTH_UPDATE: soroban_sdk::Symbol = symbol_short!("health");
const EVT_EMERGENCY_WITHDRAW: soroban_sdk::Symbol = symbol_short!("emerg_w");

#[contracttype]
#[derive(Clone)]
pub struct EvtInit {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub admin: Address,
    pub unified_auth: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtStrategyRegistered {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub strategy_id: BytesN<32>,
    pub risk_level: RiskLevel,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtStrategyDisabled {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub strategy_id: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtAllocation {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub strategy_id: BytesN<32>,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtWithdrawalRequested {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub strategy_id: BytesN<32>,
    pub amount: i128,
    pub eligible_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtWithdrawalCompleted {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub strategy_id: BytesN<32>,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtHealthUpdated {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub strategy_id: BytesN<32>,
    pub health_status: HealthStatus,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtEmergencyWithdrawal {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub strategy_id: BytesN<32>,
    pub amount: i128,
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct StrategyBoundaryContract;

#[contractimpl]
impl StrategyBoundaryContract {
    // ─── Initialization ───────────────────────────────────────────────────────

    pub fn init(env: Env, admin: Address, unified_auth: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::UnifiedAuth, &unified_auth);

        // Set default allocation limits
        let default_limits = AllocationLimits {
            max_total_allocation: 1_000_000_000, // 1B tokens
            max_per_strategy: 500_000_000,       // 500M per strategy
            min_diversification: 3,              // Minimum 3 strategies
            max_concentration: 5000,             // Max 50% in single strategy
        };
        env.storage().instance().set(&DataKey::AllocationLimits, &default_limits);

        // Set default risk limits
        let default_risk = RiskLimits {
            max_smart_contract_exposure: 200_000_000,
            max_market_exposure: 300_000_000,
            max_liquidity_exposure: 100_000_000,
            max_single_counterparty: 400_000_000,
        };
        env.storage().instance().set(&DataKey::RiskLimits, &default_risk);

        // Initialize authorized strategy registry
        env.storage().instance().set(&DataKey::AuthorizedStrategies, &Vec::<Address>::new(&env));

        env.events().publish(
            (EVT_INIT,),
            EvtInit {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: admin.clone(),
                admin,
                unified_auth,
            },
        );
    }

    // ─── Strategy Management ───────────────────────────────────────────────

    pub fn register_strategy(
        env: Env,
        metadata: StrategyMetadata,
        auditor_signature: BytesN<64>
    ) {
        Self::check_strategy_admin(&env);

        // Validate audit report is current
        if env.ledger().timestamp() > metadata.audit_expiry {
            panic!("Audit report expired");
        }

        // Verify auditor signature (simplified - in production, verify against known auditors)
        Self::verify_audit_signature(&env, &metadata, auditor_signature);

        // Ensure strategy address is authorized (cannot be a fabricated address)
        let authorized: Vec<Address> = env.storage().instance()
            .get(&DataKey::AuthorizedStrategies)
            .unwrap_or(Vec::new(&env));
        if !authorized.contains(&metadata.strategy_address) {
            panic!("Strategy address is not authorized");
        }

        // Store strategy metadata
        env.storage().instance().set(
            &DataKey::StrategyMetadata(metadata.strategy_id),
            &metadata
        );

        // Add to active strategies
        let mut active: Vec<BytesN<32>> = env.storage().instance()
            .get(&DataKey::ActiveStrategies)
            .unwrap_or(Vec::new(&env));
        if !active.contains(&metadata.strategy_id) {
            active.push_back(metadata.strategy_id);
            env.storage().instance().set(&DataKey::ActiveStrategies, &active);
        }

        env.events().publish(
            (EVT_STRATEGY_REGISTER,),
            EvtStrategyRegistered {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: env.current_contract_address(),
                strategy_id: metadata.strategy_id,
                risk_level: metadata.risk_level,
            },
        );
    }

    pub fn disable_strategy(env: Env, strategy_id: BytesN<32>) {
        Self::check_strategy_admin(&env);

        // Check strategy exists
        let metadata: StrategyMetadata = env.storage().instance()
            .get(&DataKey::StrategyMetadata(strategy_id.clone()))
            .expect("Strategy not found");

        // Mark as disabled
        env.storage().instance().set(&DataKey::DisabledStrategy(strategy_id.clone()), &true);

        env.events().publish(
            (EVT_STRATEGY_DISABLE,),
            EvtStrategyDisabled {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: env.current_contract_address(),
                strategy_id,
            },
        );
    }

    pub fn authorize_strategy_address(env: Env, strategy_address: Address) {
        Self::check_strategy_admin(&env);
        let mut authorized: Vec<Address> = env.storage().instance()
            .get(&DataKey::AuthorizedStrategies)
            .unwrap_or(Vec::new(&env));
        if !authorized.contains(&strategy_address) {
            authorized.push_back(strategy_address);
            env.storage().instance().set(&DataKey::AuthorizedStrategies, &authorized);
        }
    }

    pub fn is_strategy_disabled(env: Env, strategy_id: BytesN<32>) -> bool {
        env.storage().instance()
            .get(&DataKey::DisabledStrategy(strategy_id))
            .unwrap_or(false)
    }

    // ─── Capital Allocation ─────────────────────────────────────────────────

    pub fn allocate_to_strategy(
        env: Env,
        strategy_id: BytesN<32>,
        amount: i128
    ) {
        // Check strategy is not disabled
        if Self::is_strategy_disabled(env.clone(), strategy_id.clone()) {
            panic!("Strategy is disabled");
        }

        // Get strategy metadata
        let metadata: StrategyMetadata = env.storage().instance()
            .get(&DataKey::StrategyMetadata(strategy_id.clone()))
            .expect("Strategy not found");

        // Check allocation limits
        let limits = Self::get_allocation_limits(&env);
        let current_total = Self::get_total_allocation(&env);
        let current_strategy = Self::get_strategy_allocation(&env, strategy_id.clone());

        if current_total + amount > limits.max_total_allocation {
            panic!("Exceeds maximum total allocation");
        }

        if current_strategy + amount > limits.max_per_strategy {
            panic!("Exceeds maximum per-strategy allocation");
        }

        // Check diversification
        let active_strategies = Self::get_active_strategies(&env);
        if active_strategies.len() < limits.min_diversification as usize {
            panic!("Insufficient diversification");
        }

        // Check concentration
        let concentration = ((current_strategy + amount) * 10000) / (current_total + amount);
        if concentration > limits.max_concentration {
            panic!("Exceeds maximum concentration");
        }

        // Execute allocation (in production, this would call the strategy contract)
        Self::execute_strategy_deposit(&env, &metadata, amount);

        // Update allocation tracking
        let new_strategy_alloc = current_strategy + amount;
        env.storage().instance().set(
            &DataKey::StrategyAllocation(strategy_id.clone()),
            &new_strategy_alloc
        );
        env.storage().instance().set(
            &DataKey::TotalStrategyAllocation,
            &(current_total + amount)
        );

        env.events().publish(
            (EVT_ALLOCATION,),
            EvtAllocation {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: env.current_contract_address(),
                strategy_id,
                amount,
            },
        );
    }

    // ─── Withdrawal Management ─────────────────────────────────────────────

    pub fn request_strategy_withdrawal(
        env: Env,
        strategy_id: BytesN<32>,
        amount: i128
    ) {
        let user = env.current_contract_address();

        // Get strategy metadata
        let metadata: StrategyMetadata = env.storage().instance()
            .get(&DataKey::StrategyMetadata(strategy_id.clone()))
            .expect("Strategy not found");

        // Check user has allocation
        let user_alloc = Self::get_user_allocation(&env, user.clone(), strategy_id.clone());
        if user_alloc < amount {
            panic!("Insufficient allocation");
        }

        // Calculate eligibility time
        let eligible_at = env.ledger().timestamp() + metadata.withdrawal_delay as u64;

        // Create withdrawal request
        let request = WithdrawalRequest {
            user: user.clone(),
            strategy_id: strategy_id.clone(),
            amount,
            requested_at: env.ledger().timestamp(),
            eligible_at,
        };

        env.storage().persistent().set(
            &DataKey::WithdrawalRequest(user.clone()),
            &request
        );

        env.events().publish(
            (EVT_WITHDRAWAL_REQ,),
            EvtWithdrawalRequested {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: user,
                strategy_id,
                amount,
                eligible_at,
            },
        );
    }

    pub fn complete_strategy_withdrawal(env: Env) {
        let user = env.current_contract_address();

        let request: WithdrawalRequest = env.storage().persistent()
            .get(&DataKey::WithdrawalRequest(user.clone()))
            .expect("No pending withdrawal");

        // Check eligibility
        if env.ledger().timestamp() < request.eligible_at {
            panic!("Withdrawal not yet eligible");
        }

        // Remove request before transfer (re-entrancy guard)
        env.storage().persistent().remove(&DataKey::WithdrawalRequest(user.clone()));

        // Execute withdrawal
        Self::execute_strategy_withdrawal(
            &env,
            request.strategy_id.clone(),
            request.amount,
            user.clone()
        );

        // Update allocation tracking
        let current_strategy = Self::get_strategy_allocation(&env, request.strategy_id.clone());
        let current_total = Self::get_total_allocation(&env);
        env.storage().instance().set(
            &DataKey::StrategyAllocation(request.strategy_id.clone()),
            &(current_strategy - request.amount)
        );
        env.storage().instance().set(
            &DataKey::TotalStrategyAllocation,
            &(current_total - request.amount)
        );

        env.events().publish(
            (EVT_WITHDRAWAL_COMP,),
            EvtWithdrawalCompleted {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: user,
                strategy_id: request.strategy_id,
                amount: request.amount,
            },
        );
    }

    // ─── Emergency Controls ───────────────────────────────────────────────

    pub fn emergency_strategy_withdrawal(env: Env, strategy_id: BytesN<32>) {
        Self::check_emergency_admin(&env);

        // Check emergency mode is active
        if !Self::is_emergency_active(&env) {
            panic!("Not in emergency mode");
        }

        // Get current allocation
        let allocation = Self::get_strategy_allocation(&env, strategy_id.clone());
        if allocation == 0 {
            panic!("No allocation to withdraw");
        }

        // Force withdraw from strategy
        Self::force_withdraw_from_strategy(&env, strategy_id.clone(), allocation);

        // Update allocation tracking
        let current_total = Self::get_total_allocation(&env);
        env.storage().instance().set(&DataKey::StrategyAllocation(strategy_id.clone()), &0);
        env.storage().instance().set(&DataKey::TotalStrategyAllocation, &(current_total - allocation));

        env.events().publish(
            (EVT_EMERGENCY_WITHDRAW,),
            EvtEmergencyWithdrawal {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: env.current_contract_address(),
                strategy_id,
                amount: allocation,
            },
        );
    }

    // ─── Health Monitoring ───────────────────────────────────────────────

    pub fn update_strategy_health(env: Env, health: StrategyHealth) {
        Self::check_oracle_provider(&env);

        // Store health data
        env.storage().instance().set(
            &DataKey::StrategyHealth(health.strategy_id.clone()),
            &health
        );

        // Auto-disable if critical
        if health.health_status == HealthStatus::Critical || health.health_status == HealthStatus::Compromised {
            Self::disable_strategy(env, health.strategy_id.clone());
        }

        env.events().publish(
            (EVT_HEALTH_UPDATE,),
            EvtHealthUpdated {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: env.current_contract_address(),
                strategy_id: health.strategy_id,
                health_status: health.health_status,
            },
        );
    }

    // ─── Configuration ─────────────────────────────────────────────────────

    pub fn set_allocation_limits(env: Env, limits: AllocationLimits) {
        Self::check_strategy_admin(&env);
        env.storage().instance().set(&DataKey::AllocationLimits, &limits);
    }

    pub fn set_risk_limits(env: Env, limits: RiskLimits) {
        Self::check_strategy_admin(&env);
        env.storage().instance().set(&DataKey::RiskLimits, &limits);
    }

    // ─── Queries ───────────────────────────────────────────────────────────

    pub fn get_strategy_metadata(env: Env, strategy_id: BytesN<32>) -> Option<StrategyMetadata> {
        env.storage().instance().get(&DataKey::StrategyMetadata(strategy_id))
    }

    pub fn get_strategy_health(env: Env, strategy_id: BytesN<32>) -> Option<StrategyHealth> {
        env.storage().instance().get(&DataKey::StrategyHealth(strategy_id))
    }

    pub fn get_allocation_limits(env: Env) -> AllocationLimits {
        env.storage().instance().get(&DataKey::AllocationLimits).unwrap()
    }

    pub fn get_risk_limits(env: Env) -> RiskLimits {
        env.storage().instance().get(&DataKey::RiskLimits).unwrap()
    }

    // ─── Private Helpers ───────────────────────────────────────────────────

    fn check_strategy_admin(env: &Env) {
        let unified_auth: Address = env.storage().instance().get(&DataKey::UnifiedAuth).unwrap();
        // In production, this would call UnifiedAuth contract
        // For now, check local admin
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
    }

    fn check_emergency_admin(env: &Env) {
        let unified_auth: Address = env.storage().instance().get(&DataKey::UnifiedAuth).unwrap();
        // In production, call UnifiedAuth::require_role(UnifiedRole::EmergencyAdmin)
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
    }

    fn check_oracle_provider(env: &Env) {
        let unified_auth: Address = env.storage().instance().get(&DataKey::UnifiedAuth).unwrap();
        // In production, call UnifiedAuth::require_role(UnifiedRole::OracleProvider)
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
    }

    fn verify_audit_signature(env: &Env, metadata: &StrategyMetadata, signature: BytesN<64>) {
        // Simplified - in production, verify against known auditor addresses
        // This is a placeholder for actual signature verification
    }

    fn execute_strategy_deposit(env: &Env, metadata: &StrategyMetadata, amount: i128) {
        // In production, this would call the strategy contract's deposit function
        // For now, this is a placeholder
    }

    fn execute_strategy_withdrawal(env: &Env, strategy_id: BytesN<32>, amount: i128, recipient: Address) {
        // In production, this would call the strategy contract's withdraw function
        // For now, this is a placeholder
    }

    fn force_withdraw_from_strategy(env: &Env, strategy_id: BytesN<32>, amount: i128) {
        // In production, this would call the strategy contract's emergency withdraw function
        // For now, this is a placeholder
    }

    fn get_allocation_limits(env: &Env) -> AllocationLimits {
        env.storage().instance().get(&DataKey::AllocationLimits).unwrap()
    }

    fn get_total_allocation(env: &Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalStrategyAllocation).unwrap_or(0)
    }

    fn get_strategy_allocation(env: &Env, strategy_id: BytesN<32>) -> i128 {
        env.storage().instance().get(&DataKey::StrategyAllocation(strategy_id)).unwrap_or(0)
    }

    fn get_user_allocation(env: &Env, user: Address, strategy_id: BytesN<32>) -> i128 {
        // In production, this would track per-user allocations
        // For now, return a placeholder
        0
    }

    fn get_active_strategies(env: &Env) -> Vec<BytesN<32>> {
        env.storage().instance().get(&DataKey::ActiveStrategies).unwrap_or(Vec::new(env))
    }

    fn is_emergency_active(env: &Env) -> bool {
        // In production, call UnifiedAuth::is_emergency_active()
        false
    }
}

mod test;
