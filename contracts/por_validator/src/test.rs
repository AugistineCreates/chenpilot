#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Env};

#[contract]
pub struct MockOracle;

#[contractimpl]
impl MockOracle {
    pub fn get_reserve_data(env: Env) -> ReserveData {
        env.storage().instance().get(&symbol_short!("res")).unwrap()
    }

    pub fn set_reserve_data(env: Env, data: ReserveData) {
        env.storage().instance().set(&symbol_short!("res"), &data);
    }
}

fn create_token<'a>(env: &Env, admin: &Address) -> (Address, token::Client<'a>, token::StellarAssetClient<'a>) {
    let contract_id = env.register_stellar_asset_contract(admin.clone());
    let token = token::Client::new(env, &contract_id);
    let stellar_asset_client = token::StellarAssetClient::new(env, &contract_id);
    (contract_id, token, stellar_asset_client)
}

#[test]
fn test_por_validation_success_and_safety_status() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (wbtc_addr, _token_client, stellar_asset) = create_token(&env, &admin);
    let oracle_id = env.register_contract(None, MockOracle);
    let oracle_client = MockOracleClient::new(&env, &oracle_id);
    oracle_client.set_reserve_data(&ReserveData { balance: 1_000_000, circulating_supply: 1_000_000, timestamp: 12345 });
    stellar_asset.mint(&admin, &1_000_000);

    let contract_id = env.register_contract(None, PoRValidatorContract);
    let client = PoRValidatorContractClient::new(&env, &contract_id);
    client.initialize(&admin, &wbtc_addr, &oracle_id, &50);

    let proof = client.verify_reserves();
    assert!(proof.is_valid);
    assert_eq!(client.is_valid(), true);
    assert!(client.vault_safety_status().is_safe);
}

#[test]
fn test_por_validation_alert_on_discrepancy() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (wbtc_addr, _token_client, stellar_asset) = create_token(&env, &admin);
    let oracle_id = env.register_contract(None, MockOracle);
    let oracle_client = MockOracleClient::new(&env, &oracle_id);
    oracle_client.set_reserve_data(&ReserveData { balance: 1_000_000, circulating_supply: 1_100_000, timestamp: 12345 });
    stellar_asset.mint(&admin, &1_100_000);

    let contract_id = env.register_contract(None, PoRValidatorContract);
    let client = PoRValidatorContractClient::new(&env, &contract_id);
    client.initialize(&admin, &wbtc_addr, &oracle_id, &50);

    let proof = client.verify_reserves();
    assert_eq!(proof.is_valid, false);
    assert_eq!(client.is_valid(), false);
    assert!(!client.vault_safety_status().is_safe);
}

#[test]
fn test_por_stale_proof_blocks_vault_safety() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (wbtc_addr, _token_client, stellar_asset) = create_token(&env, &admin);
    let oracle_id = env.register_contract(None, MockOracle);
    let oracle_client = MockOracleClient::new(&env, &oracle_id);
    oracle_client.set_reserve_data(&ReserveData { balance: 1_000_000, circulating_supply: 1_000_000, timestamp: 12345 });
    stellar_asset.mint(&admin, &1_000_000);

    let contract_id = env.register_contract(None, PoRValidatorContract);
    let client = PoRValidatorContractClient::new(&env, &contract_id);
    client.initialize(&admin, &wbtc_addr, &oracle_id, &50);
    client.set_safety_policy(&1, &0);
    client.verify_reserves();

    env.ledger().set_sequence_number(env.ledger().sequence() + 1);
    let status = client.vault_safety_status();
    assert!(!status.proof_is_fresh);
    assert!(!status.is_safe);
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_initialization_failure() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, PoRValidatorContract);
    let client = PoRValidatorContractClient::new(&env, &contract_id);
    client.initialize(&admin, &admin, &admin, &50);
    client.initialize(&admin, &admin, &admin, &50);
}

#[test]
fn test_admin_config_update() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let new_oracle = Address::generate(&env);
    let contract_id = env.register_contract(None, PoRValidatorContract);
    let client = PoRValidatorContractClient::new(&env, &contract_id);

    client.initialize(&admin, &admin, &admin, &50);
    let mut config = client.get_config();
    config.oracle = new_oracle.clone();
    client.update_config(&config);
    assert_eq!(client.get_config().oracle, new_oracle);
}

#[test]
fn test_cache_reorg_invalidates_and_revalidates() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (wbtc_addr, _token_client, stellar_asset) = create_token(&env, &admin);
    let oracle_id = env.register_contract(None, MockOracle);
    let oracle_client = MockOracleClient::new(&env, &oracle_id);
    oracle_client.set_reserve_data(&ReserveData { balance: 1_000_000, circulating_supply: 1_000_000, timestamp: 12345 });
    stellar_asset.mint(&admin, &1_000_000);

    let contract_id = env.register_contract(None, PoRValidatorContract);
    let client = PoRValidatorContractClient::new(&env, &contract_id);
    client.initialize(&admin, &wbtc_addr, &oracle_id, &50);
    client.set_safety_policy(&1, &0);

    env.ledger().set_sequence_number(100);
    client.verify_reserves();
    assert!(client.vault_safety_status().is_safe);

    env.ledger().set_sequence_number(99);
    let status = client.vault_safety_status();
    assert!(!status.proof_is_fresh);
    assert!(!status.is_safe);

    client.verify_reserves();
    let status = client.vault_safety_status();
    assert!(status.proof_is_fresh);
    assert!(status.is_safe);
}

#[test]
fn test_cache_upgrade_invalidates() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (wbtc_addr, _token_client, stellar_asset) = create_token(&env, &admin);
    let oracle_id = env.register_contract(None, MockOracle);
    let oracle_client = MockOracleClient::new(&env, &oracle_id);
    oracle_client.set_reserve_data(&ReserveData { balance: 1_000_000, circulating_supply: 1_000_000, timestamp: 12345 });
    stellar_asset.mint(&admin, &1_000_000);

    let contract_id = env.register_contract(None, PoRValidatorContract);
    let client = PoRValidatorContractClient::new(&env, &contract_id);
    client.initialize(&admin, &wbtc_addr, &oracle_id, &50);
    client.set_safety_policy(&1, &0);

    client.verify_reserves();
    assert!(client.vault_safety_status().is_safe);

    let new_oracle = env.register_contract(None, MockOracle);
    let new_oracle_client = MockOracleClient::new(&env, &new_oracle);
    new_oracle_client.set_reserve_data(&ReserveData { balance: 1_000_000, circulating_supply: 1_100_000, timestamp: 12345 });

    let mut config = client.get_config();
    config.oracle = new_oracle;
    client.update_config(&config);

    let status = client.vault_safety_status();
    assert!(!status.proof_is_fresh);
    assert!(!status.is_safe);
}

#[test]
fn test_cache_concurrent_fill_invalidation_race() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (wbtc_addr, _token_client, stellar_asset) = create_token(&env, &admin);
    let oracle_id = env.register_contract(None, MockOracle);
    let oracle_client = MockOracleClient::new(&env, &oracle_id);
    oracle_client.set_reserve_data(&ReserveData { balance: 1_000_000, circulating_supply: 1_000_000, timestamp: 12345 });
    stellar_asset.mint(&admin, &1_000_000);

    let contract_id = env.register_contract(None, PoRValidatorContract);
    let client1 = PoRValidatorContractClient::new(&env, &contract_id);
    let client2 = PoRValidatorContractClient::new(&env, &contract_id);
    client1.initialize(&admin, &wbtc_addr, &oracle_id, &50);
    client1.set_safety_policy(&1, &0);

    client1.verify_reserves();
    assert!(client1.vault_safety_status().is_safe);

    let new_oracle = env.register_contract(None, MockOracle);
    let new_oracle_client = MockOracleClient::new(&env, &new_oracle);
    new_oracle_client.set_reserve_data(&ReserveData { balance: 1_000_000, circulating_supply: 1_100_000, timestamp: 12345 });

    let mut config = client2.get_config();
    config.oracle = new_oracle;
    client2.update_config(&config);

    let status = client1.vault_safety_status();
    assert!(!status.proof_is_fresh);
    assert!(!status.is_safe);
}
