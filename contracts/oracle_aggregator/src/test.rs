#![cfg(test)]

use super::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger as _},
    Address, Env,
};

// ---------------------------------------------------------------------------
// Mock oracle source
// ---------------------------------------------------------------------------

#[contract]
pub struct MockSource;

#[contractimpl]
impl MockSource {
    pub fn get_price(env: Env) -> SourceReading {
        env.storage()
            .instance()
            .get(&0u32)
            .unwrap_or(SourceReading { price: 100_000_000, decimals: 8, timestamp: 0 })
    }

    pub fn set_price(env: Env, price: i128, decimals: u32, timestamp: u64) {
        env.storage()
            .instance()
            .set(&0u32, &SourceReading { price, decimals, timestamp });
    }
}

/// A source that always fails the cross-contract call (simulates an
/// unreachable/reverting/malicious source that cannot even return data).
#[contract]
pub struct RevertingSource;

#[contractimpl]
impl RevertingSource {
    pub fn get_price(_env: Env) -> SourceReading {
        panic!("this source is down");
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn default_config(env: &Env, admin: &Address) -> AggregateConfig {
    AggregateConfig {
        admin: admin.clone(),
        min_quorum_sources: 3,
        min_quorum_weight_bps: 6_000,
        max_staleness_seconds: 300,
        max_deviation_bps: 500, // 5%
        output_decimals: 8,
    }
}

fn setup(env: &Env) -> (OracleAggregatorContractClient<'_>, Address) {
    let admin = Address::generate(env);
    let contract_id = env.register(OracleAggregatorContract, ());
    let client = OracleAggregatorContractClient::new(env, &contract_id);
    client.initialize(&default_config(env, &admin));
    (client, admin)
}

fn add_mock_source(env: &Env, client: &OracleAggregatorContractClient, weight_bps: u32, price: i128) -> Address {
    let source_id = env.register(MockSource, ());
    let source_client = MockSourceClient::new(env, &source_id);
    source_client.set_price(&price, &8u32, &env.ledger().timestamp());
    client.add_source(&source_id, &weight_bps, &8u32);
    source_id
}

// ---------------------------------------------------------------------------
// Init / governance
// ---------------------------------------------------------------------------

#[test]
fn test_initialize_and_get_config() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let cfg = client.get_config();
    assert_eq!(cfg.admin, admin);
    assert_eq!(cfg.min_quorum_sources, 3);
}

#[test]
#[should_panic]
fn test_double_initialize_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    client.initialize(&default_config(&env, &admin));
}

#[test]
fn test_add_and_list_sources() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    let s1 = add_mock_source(&env, &client, 4_000, 100_000_000);
    let s2 = add_mock_source(&env, &client, 4_000, 100_000_000);

    let sources = client.list_sources();
    assert_eq!(sources.len(), 2);
    assert_eq!(client.get_source(&s1).weight_bps, 4_000);
    assert_eq!(client.get_source(&s2).weight_bps, 4_000);
}

#[test]
#[should_panic]
fn test_add_source_invalid_weight_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let source_id = env.register(MockSource, ());
    client.add_source(&source_id, &0u32, &8u32);
}

#[test]
#[should_panic]
fn test_add_duplicate_source_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let source_id = env.register(MockSource, ());
    client.add_source(&source_id, &1_000, &8u32);
    client.add_source(&source_id, &1_000, &8u32);
}

#[test]
fn test_remove_source() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let s1 = add_mock_source(&env, &client, 4_000, 100_000_000);
    client.remove_source(&s1);
    assert_eq!(client.list_sources().len(), 0);
}

#[test]
fn test_disable_source_excludes_it_from_list() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let s1 = add_mock_source(&env, &client, 4_000, 100_000_000);
    client.update_source(&s1, &4_000, &false);
    assert_eq!(client.get_source(&s1).enabled, false);
}

// ---------------------------------------------------------------------------
// Aggregation happy path
// ---------------------------------------------------------------------------

#[test]
fn test_aggregate_agreeing_sources() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);
    let (client, _admin) = setup(&env);

    add_mock_source(&env, &client, 3_000, 100_000_000); // $1.00
    add_mock_source(&env, &client, 3_000, 100_500_000); // $1.005
    add_mock_source(&env, &client, 3_000, 99_500_000); // $0.995

    let result = client.aggregate();
    assert_eq!(result.sources_used, 3);
    assert_eq!(result.sources_rejected_deviant, 0);
    // Median of the three should land on the middle reading.
    assert_eq!(result.price, 100_000_000);
}

#[test]
fn test_get_latest_returns_cached_fresh_result() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);
    let (client, _admin) = setup(&env);

    add_mock_source(&env, &client, 3_000, 100_000_000);
    add_mock_source(&env, &client, 3_000, 100_000_000);
    add_mock_source(&env, &client, 3_000, 100_000_000);

    client.aggregate();
    let latest = client.get_latest();
    assert_eq!(latest.price, 100_000_000);
}

#[test]
#[should_panic]
fn test_get_latest_fails_when_no_aggregate_yet() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    client.get_latest();
}

// ---------------------------------------------------------------------------
// Fault tolerance: a reverting source must not block aggregation
// ---------------------------------------------------------------------------

#[test]
fn test_reverting_source_is_excluded_not_fatal() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);
    let (client, _admin) = setup(&env);

    add_mock_source(&env, &client, 2_500, 100_000_000);
    add_mock_source(&env, &client, 2_500, 100_000_000);
    add_mock_source(&env, &client, 2_500, 100_000_000);

    let bad_id = env.register(RevertingSource, ());
    client.add_source(&bad_id, &2_500, &8u32);

    // 3 healthy sources still meet quorum (min 3 / 60% weight) even though
    // the 4th is broken.
    let result = client.aggregate();
    assert_eq!(result.sources_used, 3);
    assert_eq!(result.sources_rejected_unavailable, 1);
}
