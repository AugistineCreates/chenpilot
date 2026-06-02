#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, symbol_short};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidationConfig {
    pub threshold_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Config,
}

#[contractclient(name = "IntentMarketValidatorClient")]
pub trait IntentMarketValidatorTrait {
    fn initialize(env: Env, threshold_bps: u32);
    fn validate(env: Env, intent_value: i128, market_value: i128) -> bool;
    fn update_config(env: Env, config: ValidationConfig);
    fn get_config(env: Env) -> ValidationConfig;
}

#[contract]
pub struct IntentMarketValidatorContract;

#[contractimpl]
impl IntentMarketValidatorContract {
    pub fn initialize(env: Env, threshold_bps: u32) {
        if env.storage().instance().has(&DataKey::Config) {
            panic!("Already initialized");
        }
        let config = ValidationConfig { threshold_bps };
        env.storage().instance().set(&DataKey::Config, &config);
    }

    pub fn validate(env: Env, intent_value: i128, market_value: i128) -> bool {
        if intent_value <= 0 || market_value <= 0 {
            panic!("Invalid values");
        }

        let config: ValidationConfig = env.storage().instance().get(&DataKey::Config).expect("Not initialized");

        let diff = if market_value > intent_value {
            market_value - intent_value
        } else {
            intent_value - market_value
        };

        let deviation_bps = diff
            .checked_mul(10000)
            .expect("Deviation math overflow")
            .checked_div(intent_value)
            .expect("Deviation math division error");

        if deviation_bps > config.threshold_bps as i128 {
            env.events().publish(
                (symbol_short!("DevAlert"),),
                (market_value, intent_value, deviation_bps)
            );
            panic!("Intent vs Market: deviation exceeds threshold");
        }

        true
    }

    pub fn update_config(env: Env, config: ValidationConfig) {
        let _current: ValidationConfig = env.storage().instance().get(&DataKey::Config).expect("Not initialized");
        env.storage().instance().set(&DataKey::Config, &config);
    }

    pub fn get_config(env: Env) -> ValidationConfig {
        env.storage().instance().get(&DataKey::Config).expect("Not initialized")
    }
}

mod test;
