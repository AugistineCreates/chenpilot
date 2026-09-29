#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contractclient, symbol_short,
    Address, Env, token,
};
use contract_failure::{fail, FailureReason};

const POSITION_TTL_LEDGERS: u32 = 6_048_000;
const MAX_BPS: i128 = 10_000;

#[contractclient(name = "PriceOracleClient")]
pub trait PriceOracleTrait {
    fn get_price(env: Env, asset: Address) -> i128;
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    Position(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub oracle: Address,
    pub collateral_token: Address,
    pub debt_token: Address,
    pub min_health_factor: i128,
    pub liquidation_bonus_bps: i128,
    pub ltv_bps: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Position {
    pub collateral_amount: i128,
    pub debt_amount: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtInit {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub admin: Address,
    pub oracle: Address,
    pub collateral_token: Address,
    pub debt_token: Address,
    pub min_health_factor: i128,
    pub liquidation_bonus_bps: i128,
    pub ltv_bps: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtCfgUpd {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub admin: Address,
    pub oracle: Address,
    pub collateral_token: Address,
    pub debt_token: Address,
    pub min_health_factor: i128,
    pub liquidation_bonus_bps: i128,
    pub ltv_bps: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtDeposit {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub borrower: Address,
    pub collateral_amount: i128,
    pub borrow_amount: i128,
    pub health_factor: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtLiquidate {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub liquidator: Address,
    pub borrower: Address,
    pub repay_amount: i128,
    pub collateral_seized: i128,
    pub health_factor: i128,
}

#[contract]
pub struct LendingLiquidationContract;

#[contractimpl]
impl LendingLiquidationContract {
    pub fn initialize(env: Env, config: Config) {
        if env.storage().instance().has(&DataKey::Config) {
            fail(&env, FailureReason::AlreadyInitialized);
        }
        Self::validate_config(&env, &config);
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish(
            (symbol_short!("lend"), symbol_short!("init")),
            EvtInit {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: config.admin.clone(),
                admin: config.admin.clone(),
                oracle: config.oracle.clone(),
                collateral_token: config.collateral_token.clone(),
                debt_token: config.debt_token.clone(),
                min_health_factor: config.min_health_factor,
                liquidation_bonus_bps: config.liquidation_bonus_bps,
                ltv_bps: config.ltv_bps,
            },
        );
    }

    pub fn update_config(env: Env, config: Config) {
        let current_config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| fail(&env, FailureReason::NotInitialized));
        current_config.admin.require_auth();
        Self::validate_config(&env, &config);
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish(
            (symbol_short!("lend"), symbol_short!("cfg_upd")),
            EvtCfgUpd {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: current_config.admin.clone(),
                admin: config.admin.clone(),
                oracle: config.oracle.clone(),
                collateral_token: config.collateral_token.clone(),
                debt_token: config.debt_token.clone(),
                min_health_factor: config.min_health_factor,
                liquidation_bonus_bps: config.liquidation_bonus_bps,
                ltv_bps: config.ltv_bps,
            },
        );
    }

    pub fn deposit_and_borrow(
        env: Env,
        borrower: Address,
        collateral_amount: i128,
        borrow_amount: i128,
    ) {
        borrower.require_auth();
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| fail(&env, FailureReason::NotInitialized));

        if collateral_amount <= 0 || borrow_amount <= 0 {
            fail(&env, FailureReason::AmountNotPositive);
        }

        let mut pos: Position = env
            .storage()
            .persistent()
            .get(&DataKey::Position(borrower.clone()))
            .unwrap_or(Position { collateral_amount: 0, debt_amount: 0 });

        let new_collateral = pos
            .collateral_amount
            .checked_add(collateral_amount)
            .unwrap_or_else(|| fail(&env, FailureReason::ArithmeticError));
        let new_debt = pos
            .debt_amount
            .checked_add(borrow_amount)
            .unwrap_or_else(|| fail(&env, FailureReason::ArithmeticError));

        let oracle = PriceOracleClient::new(&env, &config.oracle);
        let col_price = oracle.get_price(&config.collateral_token);
        let debt_price = oracle.get_price(&config.debt_token);

        Self::validate_prices(&env, col_price, debt_price);

        let new_pos = Position {
            collateral_amount: new_collateral,
            debt_amount: new_debt,
        };

        let hf = Self::compute_health_factor(&env, &new_pos, col_price, debt_price, config.ltv_bps);
        if hf < config.min_health_factor {
            fail(&env, FailureReason::BorrowExceedsLTV);
        }

        let col_token = token::Client::new(&env, &config.collateral_token);
        col_token.transfer(&borrower, &env.current_contract_address(), &collateral_amount);

        let debt_token = token::Client::new(&env, &config.debt_token);
        debt_token.transfer(&env.current_contract_address(), &borrower, &borrow_amount);

        pos.collateral_amount = new_collateral;
        pos.debt_amount = new_debt;

        env.storage().persistent().set_with_ttl(&DataKey::Position(borrower), &pos, POSITION_TTL_LEDGERS);

        env.events().publish(
            (symbol_short!("lend"), symbol_short!("deposit")),
            EvtDeposit {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: borrower.clone(),
                borrower: borrower.clone(),
                collateral_amount: new_collateral,
                borrow_amount: new_debt,
                health_factor: hf,
            },
        );
    }

    pub fn liquidate(env: Env, liquidator: Address, borrower: Address, repay_amount: i128) {
        liquidator.require_auth();
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| fail(&env, FailureReason::NotInitialized));

        if repay_amount <= 0 {
            fail(&env, FailureReason::AmountNotPositive);
        }

        let mut pos: Position = env
            .storage()
            .persistent()
            .get(&DataKey::Position(borrower.clone()))
            .unwrap_or_else(|| fail(&env, FailureReason::NotFound));

        if pos.debt_amount == 0 {
            fail(&env, FailureReason::NoDebtToLiquidate);
        }

        let oracle = PriceOracleClient::new(&env, &config.oracle);
        let col_price = oracle.get_price(&config.collateral_token);
        let debt_price = oracle.get_price(&config.debt_token);

        Self::validate_prices(&env, col_price, debt_price);

        let hf = Self::compute_health_factor(&env, &pos, col_price, debt_price, config.ltv_bps);
        if hf >= config.min_health_factor {
            fail(&env, FailureReason::PositionHealthy);
        }

        let actual_repay = if repay_amount > pos.debt_amount {
            pos.debt_amount
        } else {
            repay_amount
        };

        let collateral_seized = Self::calculate_collateral_to_seize(
            &env,
            actual_repay,
            pos.collateral_amount,
            col_price,
            debt_price,
            config.liquidation_bonus_bps,
        );

        let debt_token = token::Client::new(&env, &config.debt_token);
        debt_token.transfer(&liquidator, &env.current_contract_address(), &actual_repay);

        let col_token = token::Client::new(&env, &config.collateral_token);
        col_token.transfer(&env.current_contract_address(), &liquidator, &collateral_seized);

        pos.debt_amount = pos
            .debt_amount
            .checked_sub(actual_repay)
            .unwrap_or_else(|| fail(&env, FailureReason::ArithmeticError));
        pos.collateral_amount = pos
            .collateral_amount
            .checked_sub(collateral_seized)
            .unwrap_or_else(|| fail(&env, FailureReason::ArithmeticError));
        
        env.storage().persistent().set_with_ttl(&DataKey::Position(borrower.clone()), &pos, POSITION_TTL_LEDGERS);

        env.events().publish(
            (symbol_short!("lend"), symbol_short!("liquidate")),
            EvtLiquidate {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: liquidator.clone(),
                liquidator,
                borrower: borrower.clone(),
                repay_amount: actual_repay,
                collateral_seized,
                health_factor: hf,
            },
        );
    }

    pub fn health_factor(env: Env, borrower: Address) -> i128 {
        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| fail(&env, FailureReason::NotInitialized));
        let pos: Position = env
            .storage()
            .persistent()
            .get(&DataKey::Position(borrower))
            .unwrap_or(Position { collateral_amount: 0, debt_amount: 0 });

        if pos.debt_amount == 0 {
            return i128::MAX;
        }

        let oracle = PriceOracleClient::new(&env, &config.oracle);
        let col_price = oracle.get_price(&config.collateral_token);
        let debt_price = oracle.get_price(&config.debt_token);

        Self::validate_prices(&env, col_price, debt_price);

        Self::compute_health_factor(&env, &pos, col_price, debt_price, config.ltv_bps)
    }

    pub fn get_position(env: Env, borrower: Address) -> Option<Position> {
        env.storage().persistent().get(&DataKey::Position(borrower))
    }

    fn validate_config(env: &Env, config: &Config) {
        if config.min_health_factor <= 0 {
            fail(env, FailureReason::InvalidArgument);
        }
        if config.liquidation_bonus_bps < 0 || config.liquidation_bonus_bps > MAX_BPS {
            fail(env, FailureReason::InvalidArgument);
        }
        if config.ltv_bps <= 0 || config.ltv_bps > MAX_BPS {
            fail(env, FailureReason::InvalidArgument);
        }
    }

    fn validate_prices(env: &Env, col_price: i128, debt_price: i128) {
        if col_price <= 0 || debt_price <= 0 {
            fail(env, FailureReason::InvalidArgument);
        }
    }

    fn calculate_collateral_to_seize(
        env: &Env,
        actual_repay: i128,
        available_collateral: i128,
        col_price: i128,
        debt_price: i128,
        bonus_bps: i128,
    ) -> i128 {
        let repay_value = actual_repay
            .checked_mul(debt_price)
            .unwrap_or_else(|| fail(env, FailureReason::ArithmeticError))
            .checked_div(100_000_000)
            .unwrap_or_else(|| fail(env, FailureReason::ArithmeticError));

        let collateral_seized = repay_value
            .checked_mul(MAX_BPS + bonus_bps)
            .unwrap_or_else(|| fail(env, FailureReason::ArithmeticError))
            .checked_div(MAX_BPS)
            .unwrap_or_else(|| fail(env, FailureReason::ArithmeticError))
            .checked_mul(100_000_000)
            .unwrap_or_else(|| fail(env, FailureReason::ArithmeticError))
            .checked_div(col_price)
            .unwrap_or_else(|| fail(env, FailureReason::ArithmeticError));

        if collateral_seized > available_collateral {
            available_collateral
        } else {
            collateral_seized
        }
    }

    fn compute_health_factor(
        env: &Env,
        pos: &Position,
        col_price: i128,
        debt_price: i128,
        ltv_bps: i128,
    ) -> i128 {
        if pos.debt_amount == 0 {
            return i128::MAX;
        }
        pos.collateral_amount
            .checked_mul(col_price)
            .unwrap_or_else(|| fail(env, FailureReason::ArithmeticError))
            .checked_mul(ltv_bps)
            .unwrap_or_else(|| fail(env, FailureReason::ArithmeticError))
            .checked_div(
                pos.debt_amount
                    .checked_mul(debt_price)
                    .unwrap_or_else(|| fail(env, FailureReason::ArithmeticError)),
            )
            .unwrap_or_else(|| fail(env, FailureReason::ArithmeticError))
    }
}

mod test;
