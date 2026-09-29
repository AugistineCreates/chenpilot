#![cfg(test)]

//! Tests for the pause-state integration (see the `pause_state` crate).
//! Kept in its own module rather than extending `test.rs`, whose `setup()`
//! helper calls `client.init(&admin, &vault_token)` with only two of
//! `init`'s three required arguments — a pre-existing mismatch unrelated
//! to this change (see the caveats note in this PR).

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

fn setup(env: &Env) -> (Address, Address, CoreVaultContractClient<'_>) {
    let admin = Address::generate(env);
    let vault_token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let unified_auth = Address::generate(env);
    let contract_id = env.register(CoreVaultContract, ());
    let client = CoreVaultContractClient::new(env, &contract_id);
    client.init(&admin, &vault_token, &unified_auth);
    (admin, vault_token, client)
}

fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
    soroban_sdk::token::StellarAssetClient::new(env, token).mint(to, &amount);
}

#[test]
fn test_defaults_to_not_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _token, client) = setup(&env);

    assert!(!client.is_paused());
}

#[test]
fn test_admin_can_pause_and_unpause() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _token, client) = setup(&env);

    client.pause();
    assert!(client.is_paused());

    client.unpause();
    assert!(!client.is_paused());
}

#[test]
#[should_panic]
fn test_deposit_blocked_while_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, token, client) = setup(&env);
    let user = Address::generate(&env);
    mint(&env, &token, &user, 1_000);

    client.pause();
    client.deposit(&user, &100); // must panic — vault is paused
}

#[test]
fn test_deposit_allowed_before_pause_and_after_unpause() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, token, client) = setup(&env);
    let user = Address::generate(&env);
    mint(&env, &token, &user, 1_000);

    // Before any pause — succeeds.
    client.deposit(&user, &100);
    assert_eq!(client.get_deposit(&user), Some(100));

    // Pause, then unpause — deposits resume working.
    client.pause();
    client.unpause();
    client.deposit(&user, &50);
    assert_eq!(client.get_deposit(&user), Some(150));
}

#[test]
fn test_withdrawal_still_allowed_while_paused() {
    // Deliberate design choice, documented on CoreVaultContract::pause():
    // pausing blocks new deposits but not withdrawals or force-exit, so an
    // emergency pause can't be used to trap funds users already deposited.
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, token, client) = setup(&env);
    let user = Address::generate(&env);
    mint(&env, &token, &user, 1_000);

    client.deposit(&user, &100);
    client.pause();

    client.withdrawal(&user, &40);
    assert_eq!(client.get_deposit(&user), Some(60));
}

#[test]
fn test_pause_blocks_backend_status_change_via_is_emergency_active() {
    // is_emergency_active() now reflects real pause state (previously a
    // hard-coded `false` stub) — set_backend_status already checked it.
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _token, client) = setup(&env);

    client.set_backend_status(&false);
    assert!(!client.is_backend_online());

    client.pause();

    let result = client.try_set_backend_status(&true);
    assert!(result.is_err(), "set_backend_status should fail while paused");
}

#[test]
#[should_panic]
fn test_double_pause_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _token, client) = setup(&env);

    client.pause();
    client.pause(); // already paused — pause_state fails loudly, not silently
}

#[test]
#[should_panic]
fn test_unpause_without_pause_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _token, client) = setup(&env);

    client.unpause(); // never paused
}
