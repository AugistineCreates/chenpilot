#![cfg(test)]

//! Tests for the pause-state integration (see the `pause_state` crate).
//! Kept in its own module rather than extending `test.rs`, whose `setup()`
//! helper builds a `Config` missing several fields the struct now requires
//! (`max_oracle_staleness_seconds`, `max_consecutive_price_change_bps`,
//! `max_oracle_update_gap_seconds`, `circuit_breaker_threshold_bps`,
//! `circuit_breaker_window_seconds`) and calls `record_snapshot()` with no
//! arguments where the real signature takes
//! `(oracle_timestamp, oracle_sequence)` — a pre-existing mismatch
//! unrelated to this change (see the caveats note in this PR).

use super::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger as _},
    Address, Env,
};

#[contract]
pub struct MockOracle;

#[contractimpl]
impl MockOracle {
    pub fn get_price(env: Env, _asset: Address) -> i128 {
        env.storage().instance().get(&0u32).unwrap_or(100_000_000i128)
    }
}

fn setup(env: &Env) -> (FlashLoanGuardContractClient<'_>, Address) {
    let admin = Address::generate(env);
    let asset = Address::generate(env);
    let oracle_id = env.register(MockOracle, ());

    let contract_id = env.register(FlashLoanGuardContract, ());
    let client = FlashLoanGuardContractClient::new(env, &contract_id);

    client.initialize(&Config {
        admin: admin.clone(),
        oracle: oracle_id,
        guarded_asset: asset,
        max_intra_ledger_deviation_bps: 200,
        min_ledger_gap: 1,
        max_oracle_staleness_seconds: 3600,
        max_consecutive_price_change_bps: 1000,
        max_oracle_update_gap_seconds: 3600,
        circuit_breaker_threshold_bps: 500,
        circuit_breaker_window_seconds: 600,
    });

    (client, admin)
}

#[test]
fn test_defaults_to_not_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    assert!(!client.is_paused());
}

#[test]
fn test_admin_can_pause_and_unpause() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    client.pause();
    assert!(client.is_paused());

    client.unpause();
    assert!(!client.is_paused());
}

#[test]
#[should_panic]
fn test_record_snapshot_blocked_while_paused() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    let (client, _admin) = setup(&env);

    client.pause();
    client.record_snapshot(&env.ledger().timestamp(), &1u64); // must panic
}

#[test]
fn test_record_snapshot_allowed_before_pause_and_after_unpause() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    let (client, _admin) = setup(&env);

    // Before any pause — succeeds.
    client.record_snapshot(&env.ledger().timestamp(), &1u64);
    assert!(client.get_snapshot().is_some());

    client.pause();
    client.unpause();

    env.ledger().set_sequence_number(102);
    client.record_snapshot(&env.ledger().timestamp(), &2u64);
    assert!(client.get_snapshot().is_some());
}

#[test]
#[should_panic]
fn test_double_pause_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    client.pause();
    client.pause();
}

#[test]
#[should_panic]
fn test_unpause_without_pause_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    client.unpause();
}
