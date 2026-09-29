#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger, LedgerInfo}, Env, Address, BytesN};
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};

fn setup(env: &Env) -> (Address, Address, CoreVaultContractClient) {
    let admin = Address::generate(env);
    let vault_token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let unified_auth = Address::generate(env);
    let contract_id = env.register_contract(None, CoreVaultContract);
    let client = CoreVaultContractClient::new(env, &contract_id);
    client.init(&admin, &vault_token, &unified_auth);
    (admin, vault_token, client)
}

fn dummy_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[1u8; 32])
}

fn mint(env: &Env, token: &Address, admin: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(to, &amount);
    let _ = admin;
}

#[test]
fn test_propose_and_cancel_upgrade() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _token, client) = setup(&env);

    client.propose_upgrade(&dummy_hash(&env));
    assert!(client.upgrade_unlock_ledger() > 0);

    client.cancel_upgrade();
    assert_eq!(client.upgrade_unlock_ledger(), 0);
}

#[test]
#[should_panic(expected = "time-lock not expired")]
fn test_apply_upgrade_before_timelock() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _token, client) = setup(&env);

    client.propose_upgrade(&dummy_hash(&env));
    client.apply_upgrade();
}

#[test]
#[should_panic(expected = "no pending upgrade")]
fn test_apply_upgrade_without_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _token, client) = setup(&env);
    client.apply_upgrade();
}

#[test]
fn test_transfer_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _token, client) = setup(&env);

    let new_admin = Address::generate(&env);
    client.transfer_admin(&new_admin);
    client.propose_upgrade(&dummy_hash(&env));
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_init() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, vault_token, client) = setup(&env);
    let unified_auth = Address::generate(&env);
    client.init(&admin, &vault_token, &unified_auth);
}

// ── Withdrawal tests ────────────────────────────────────────────────────────────

#[test]
fn test_withdrawal_happy_path() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, vault_token, client) = setup(&env);

    let user = Address::generate(&env);
    mint(&env, &vault_token, &admin, &user, 1000);
    client.deposit(&user, &1000);

    // Normal withdrawal while backend is online
    client.withdrawal(&user, &400);

    // Check remaining balance
    let balance: i128 = client.get_deposit(&user).unwrap();
    assert_eq!(balance, 600);
}

#[test]
fn test_withdrawal_full_balance_removes_record() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, vault_token, client) = setup(&env);

    let user = Address::generate(&env);
    mint(&env, &vault_token, &admin, &user, 1000);
    client.deposit(&user, &1000);

    // Withdraw full balance
    client.withdrawal(&user, &1000);

    // Deposit record should be removed
    assert!(client.get_deposit(&user).is_none());
}

#[test]
#[should_panic(expected = "backend offline: use force_exit_request")]
fn test_withdrawal_blocked_when_offline() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, vault_token, client) = setup(&env);

    let user = Address::generate(&env);
    mint(&env, &vault_token, &admin, &user, 1000);
    client.deposit(&user, &1000);

    // Set backend offline
    client.set_backend_status(&false);

    // Normal withdrawal should be blocked
    client.withdrawal(&user, &100);
}

// ── Force Exit tests ──────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "backend is online: use normal withdrawal")]
fn test_force_exit_blocked_when_online() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, vault_token, client) = setup(&env);

    let user = Address::generate(&env);
    mint(&env, &vault_token, &admin, &user, 100);
    client.deposit(&user, &100);

    // Backend is still online — force exit should be rejected
    client.force_exit_request(&user);
}

#[test]
fn test_force_exit_happy_path() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, vault_token, client) = setup(&env);

    let user = Address::generate(&env);
    mint(&env, &vault_token, &admin, &user, 1000);

    // Deposit while backend is online
    client.deposit(&user, &1000);

    // Backend goes offline
    client.set_backend_status(&false);

    // User initiates force exit
    client.force_exit_request(&user);

    let req = client.get_force_exit(&user).expect("should have pending request");
    assert_eq!(req.amount, 1000);

    // Advance time past 48 hours
    env.ledger().set(LedgerInfo {
        timestamp: env.ledger().timestamp() + FORCE_EXIT_DELAY + 1,
        ..env.ledger().get()
    });

    client.force_exit_complete(&user);

    // Request should be cleared
    assert!(client.get_force_exit(&user).is_none());

    // User should have their tokens back
    let balance = TokenClient::new(&env, &vault_token).balance(&user);
    assert_eq!(balance, 1000);
}

#[test]
#[should_panic(expected = "challenge period not elapsed")]
fn test_force_exit_too_early() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, vault_token, client) = setup(&env);

    let user = Address::generate(&env);
    mint(&env, &vault_token, &admin, &user, 500);
    client.deposit(&user, &500);
    client.set_backend_status(&false);
    client.force_exit_request(&user);

    // Try to complete immediately — should fail
    client.force_exit_complete(&user);
}

// ── Recovery tests ────────────────────────────────────────────────────────────

#[test]
fn test_recovery_cancels_force_exit() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, vault_token, client) = setup(&env);

    let user = Address::generate(&env);
    mint(&env, &vault_token, &admin, &user, 1000);
    client.deposit(&user, &1000);
    client.set_backend_status(&false);
    client.force_exit_request(&user);

    // Force exit should be pending
    assert!(client.get_force_exit(&user).is_some());

    // Admin recovers the force exit
    client.recovery(&user);

    // Force exit should be cleared
    assert!(client.get_force_exit(&user).is_none());

    // Deposit balance should remain unchanged (force_exit_request doesn't remove it)
    let balance: i128 = client.get_deposit(&user).unwrap();
    assert_eq!(balance, 1000);

    // User can now do a normal withdrawal after recovery (backend goes back online)
    client.set_backend_status(&true);
    client.withdrawal(&user, &500);
    let remaining: i128 = client.get_deposit(&user).unwrap();
    assert_eq!(remaining, 500);
}

#[test]
#[should_panic(expected = "no pending force exit to recover")]
fn test_recovery_fails_without_force_exit() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _token, client) = setup(&env);

    let user = Address::generate(&env);
    client.recovery(&user);
}