#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Vec, symbol_short};
use contract_failure::{fail, FailureReason};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidationConfig {
    pub threshold_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Config,
    TrustedSources,
}

#[contractclient(name = "IntentMarketValidatorClient")]
pub trait IntentMarketValidatorTrait {
    fn initialize(env: Env, threshold_bps: u32);
    fn validate(env: Env, intent_value: i128, market_value: i128, market_source: Address) -> bool;
    fn register_trusted_source(env: Env, source: Address);
    fn update_config(env: Env, config: ValidationConfig);
    fn get_config(env: Env) -> ValidationConfig;
}

#[contracttype]
#[derive(Clone)]
pub struct EvtInit {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub threshold_bps: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtCfgUpd {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub threshold_bps: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtDevAlert {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub market_value: i128,
    pub intent_value: i128,
    pub deviation_bps: i128,
    pub source: Address,
}

#[contract]
pub struct IntentMarketValidatorContract;

#[contractimpl]
impl IntentMarketValidatorContract {
    pub fn initialize(env: Env, threshold_bps: u32) {
        if env.storage().instance().has(&DataKey::Config) {
            fail(&env, FailureReason::AlreadyInitialized);
        }
        let config = ValidationConfig { threshold_bps };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::TrustedSources, &Vec::<Address>::new(&env));

        env.events().publish(
            (symbol_short!("intent"), symbol_short!("init")),
            EvtInit {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: env.current_contract_address(),
                threshold_bps,
            },
        );
    }

    pub fn validate(env: Env, intent_value: i128, market_value: i128, market_source: Address) -> bool {
        if intent_value <= 0 || market_value <= 0 {
            fail(&env, FailureReason::InvalidArgument);
        }

        let trusted_sources: Vec<Address> = env.storage().instance().get(&DataKey::TrustedSources).unwrap_or_else(|| Vec::new(&env));
        if !trusted_sources.iter().any(|s| s == &market_source) {
            fail(&env, FailureReason::InvalidArgument);
        }

        let config: ValidationConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| fail(&env, FailureReason::NotInitialized));

        let diff = if market_value > intent_value {
            market_value - intent_value
        } else {
            intent_value - market_value
        };

        let deviation_bps = diff
            .checked_mul(10000)
            .unwrap_or_else(|| fail(&env, FailureReason::ArithmeticError))
            .checked_div(intent_value)
            .unwrap_or_else(|| fail(&env, FailureReason::ArithmeticError));

        if deviation_bps > config.threshold_bps as i128 {
            env.events().publish(
                (symbol_short!("intent"), symbol_short!("dev_alert")),
                EvtDevAlert {
                    version: 1,
                    ledger: env.ledger().sequence(),
                    actor: env.current_contract_address(),
                    market_value,
                    intent_value,
                    deviation_bps,
                    source: market_source,
                },
            );
            fail(&env, FailureReason::PriceDeviationExceedsThreshold);
        }

        true
    }

    pub fn register_trusted_source(env: Env, source: Address) {
        let mut sources: Vec<Address> = env.storage().instance().get(&DataKey::TrustedSources).unwrap_or_else(|| Vec::new(&env));
        if !sources.iter().any(|s| s == &source) {
            sources.push_back(source);
            env.storage().instance().set(&DataKey::TrustedSources, &sources);
        }
    }

    pub fn update_config(env: Env, config: ValidationConfig) {
        let _current: ValidationConfig = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| fail(&env, FailureReason::NotInitialized));
        env.storage().instance().set(&DataKey::Config, &config);

        env.events().publish(
            (symbol_short!("intent"), symbol_short!("cfg_upd")),
            EvtCfgUpd {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: env.current_contract_address(),
                threshold_bps: config.threshold_bps,
            },
        );
    }

    pub fn get_config(env: Env) -> ValidationConfig {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| fail(&env, FailureReason::NotInitialized))
    }
}

mod test;
