#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, contractclient, Address, Bytes, Env, Vec, symbol_short};
use contract_failure::{fail, FailureReason};

// ---------------------------------------------------------------------------
// Reusable protected-execution primitive
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub decimals: u32,
    pub timestamp: u64,
}

#[contractclient(name = "PriceOracleClient")]
pub trait PriceOracleTrait {
    fn get_price(env: Env, asset: Address) -> Option<PriceData>;
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Config,
    ExecutionContext,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub oracle: Address,
    pub threshold_bps: u32,
}

/// Generic execution context for protected execution primitive.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutionContext {
    pub caller: Address,
    pub operation: Bytes, // e.g. "swap", "deposit", "withdraw"
    pub intent_price: i128,
    pub min_amount_out: i128,
    pub max_slippage_bps: u32,
    pub deadline_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutionResult {
    pub approved: bool,
    pub market_price: i128,
    pub deviation_bps: u128,
    pub reason: Bytes,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtInit {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub admin: Address,
    pub oracle: Address,
    pub threshold_bps: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtCfgUpd {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub admin: Address,
    pub oracle: Address,
    pub threshold_bps: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtSwapOk {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub token_in: Address,
    pub token_out: Address,
    pub amount_in: i128,
    pub market_price: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtDevAlert {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub market_price: i128,
    pub intent_price: i128,
    pub deviation_bps: i128,
}

#[contract]
pub struct LiquidityVaultContract;

#[contractimpl]
impl LiquidityVaultContract {
    pub fn initialize(env: Env, admin: Address, oracle: Address, threshold_bps: u32) {
        if env.storage().instance().has(&DataKey::Config) {
            fail(&env, FailureReason::AlreadyInitialized);
        }
        let config = Config { admin: admin.clone(), oracle: oracle.clone(), threshold_bps };
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish(
            (symbol_short!("liqv"), symbol_short!("init")),
            EvtInit {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: admin,
                admin: admin.clone(),
                oracle,
                threshold_bps,
            },
        );
    }

    pub fn update_config(env: Env, config: Config) {
        let current: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| fail(&env, FailureReason::NotInitialized));
        current.admin.require_auth();
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish(
            (symbol_short!("liqv"), symbol_short!("cfg_upd")),
            EvtCfgUpd {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: current.admin.clone(),
                admin: config.admin.clone(),
                oracle: config.oracle.clone(),
                threshold_bps: config.threshold_bps,
            },
        );
    }

    /// Generic protected execution: validates intent vs market conditions.
    /// Returns ExecutionResult indicating whether the operation is approved.
    pub fn execute_protected(
        env: Env,
        token_in: Address,
        token_out: Address,
        amount_in: i128,
        ctx: ExecutionContext,
    ) -> ExecutionResult {
        if amount_in <= 0 || ctx.intent_price <= 0 {
            fail(&env, FailureReason::InvalidArgument);
        }

        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| fail(&env, FailureReason::NotInitialized));
        let current_ledger = env.ledger().sequence();

        // Deadline check
        if current_ledger > ctx.deadline_ledger {
            return ExecutionResult {
                approved: false,
                market_price: 0,
                deviation_bps: 0,
                reason: Bytes::from_slice(&env, b"deadline_exceeded"),
            };
        }

        let oracle = PriceOracleClient::new(&env, &config.oracle);
        let p_in = oracle
            .get_price(&token_in)
            .unwrap_or_else(|| fail(&env, FailureReason::OraclePriceMissing));
        let p_out = oracle
            .get_price(&token_out)
            .unwrap_or_else(|| fail(&env, FailureReason::OraclePriceMissing));

        let p_in_norm = normalize_price(p_in.price, p_in.decimals, 8);
        let p_out_norm = normalize_price(p_out.price, p_out.decimals, 8);

        let market_price = p_in_norm
            .checked_mul(100_000_000)
            .unwrap_or_else(|| fail(&env, FailureReason::ArithmeticError))
            .checked_div(p_out_norm)
            .unwrap_or_else(|| fail(&env, FailureReason::ArithmeticError));

        let diff = if market_price > ctx.intent_price {
            market_price - ctx.intent_price
        } else {
            ctx.intent_price - market_price
        };

        let deviation_bps = diff
            .checked_mul(10000)
            .unwrap_or_else(|| fail(&env, FailureReason::ArithmeticError))
            .checked_div(ctx.intent_price)
            .unwrap_or_else(|| fail(&env, FailureReason::ArithmeticError));
        
        // 5. Enforce protection threshold
        if deviation_bps > config.threshold_bps as i128 {
            env.events().publish(
                (symbol_short!("liqv"), symbol_short!("dev_alert")),
                EvtDevAlert {
                    version: 1,
                    ledger: env.ledger().sequence(),
                    actor: config.admin.clone(),
                    market_price,
                    intent_price,
                    deviation_bps,
                },
            );
            return ExecutionResult {
                approved: false,
                market_price,
                deviation_bps: deviation_bps as u128,
                reason: Bytes::from_slice(&env, b"deviation_exceeded"),
            };
        }

        ExecutionResult {
            approved: true,
            market_price,
            deviation_bps: deviation_bps as u128,
            reason: Bytes::from_slice(&env, b"approved"),
        }
    }

    /// Convenience wrapper for swap-style operations.
    pub fn execute_protected_swap(
        env: Env,
        token_in: Address,
        token_out: Address,
        amount_in: i128,
        min_amount_out: i128,
        intent_price: i128,
    ) {
        if amount_in <= 0 || min_amount_out <= 0 || intent_price <= 0 {
            fail(&env, FailureReason::InvalidArgument);
        }

        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| fail(&env, FailureReason::NotInitialized));

        let caller = env.current_contract_address();
        let ctx = ExecutionContext {
            caller,
            operation: Bytes::from_slice(&env, b"swap"),
            intent_price,
            min_amount_out,
            max_slippage_bps: 0,
            deadline_ledger: env.ledger().sequence() + 1000,
        };

        let result = Self::execute_protected(env.clone(), token_in.clone(), token_out.clone(), amount_in, ctx);
        if !result.approved {
            fail(&env, FailureReason::LiquidityProtectionViolation);
        }

        env.events().publish(
            (symbol_short!("liqv"), symbol_short!("swap_ok")),
            EvtSwapOk {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: config.admin.clone(),
                token_in,
                token_out,
                amount_in,
                market_price: result.market_price,
            },
        );
    }

    /// Returns the current configuration.
    pub fn get_config(env: Env) -> Config {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| fail(&env, FailureReason::NotInitialized))
    }
}

/// Normalizes a value from current_decimals to target_decimals using 10^diff factor.
fn normalize_price(price: i128, current_decimals: u32, target_decimals: u32) -> i128 {
    if current_decimals == target_decimals {
        return price;
    }
    if current_decimals < target_decimals {
        let diff = target_decimals - current_decimals;
        let factor = 10i128.pow(diff);
        price * factor
    } else {
        let diff = current_decimals - target_decimals;
        let factor = 10i128.pow(diff);
        price / factor
    }
}

mod test;
mod test_property;
