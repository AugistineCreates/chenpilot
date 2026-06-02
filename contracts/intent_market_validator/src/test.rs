#![cfg(test)]

use super::*;
use soroban_sdk::{Env, Address, contractclient};

#[test]
fn test_validation_success() {
    let env = Env::default();

    let contract_id = env.register_contract(None, IntentMarketValidatorContract);
    let client = IntentMarketValidatorContractClient::new(&env, &contract_id);

    client.initialize(&200);

    let valid = client.validate(&1000, &1010);
    assert!(valid);
}

#[test]
#[should_panic(expected = "Intent vs Market: deviation exceeds threshold")]
fn test_validation_deviation_rejection() {
    let env = Env::default();

    let contract_id = env.register_contract(None, IntentMarketValidatorContract);
    let client = IntentMarketValidatorContractClient::new(&env, &contract_id);

    client.initialize(&100);

    client.validate(&1000, &1200);
}

#[test]
fn test_update_config() {
    let env = Env::default();

    let contract_id = env.register_contract(None, IntentMarketValidatorContract);
    let client = IntentMarketValidatorContractClient::new(&env, &contract_id);

    client.initialize(&100);
    let config = ValidationConfig { threshold_bps: 500 };

    client.update_config(&config);
    let new_config = client.get_config();
    assert_eq!(new_config.threshold_bps, 500);
}
