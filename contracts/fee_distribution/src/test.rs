#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, Env};

fn create_token<'a>(env: &Env, admin: &Address) -> (Address, token::Client<'a>, token::StellarAssetClient<'a>) {
    let contract_id = env.register_stellar_asset_contract(admin.clone());
    let token = token::Client::new(env, &contract_id);
    let stellar_asset_client = token::StellarAssetClient::new(env, &contract_id);
    (contract_id, token, stellar_asset_client)
}

fn setup<'a>() -> (Env, Address, token::Client<'a>, token::StellarAssetClient<'a>, Address, FeeDistributionContractClient<'a>) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let ai_agent_pool = Address::generate(&env);
    let lp_pool = Address::generate(&env);
    let (token_addr, token_client, stellar_asset) = create_token(&env, &admin);
    let contract_id = env.register_contract(None, FeeDistributionContract);
    let client = FeeDistributionContractClient::new(&env, &contract_id);
    client.initialize(&admin, &treasury, &ai_agent_pool, &lp_pool, &3000, &2000);
    (env, token_addr, token_client, stellar_asset, contract_id, client)
}

#[test]
fn test_distribute_emits_reconcilable_record() {
    let (_, token_addr, token_client, stellar_asset, contract_id, client) = setup();
    let fee_source = Address::generate(&client.env);
    stellar_asset.mint(&fee_source, &10000);
    token_client.approve(&fee_source, &contract_id, &10000, &(client.env.ledger().sequence() + 100));
    let record = client.distribute(&token_addr, &fee_source, &10000);
    assert_eq!(record.nonce, 1);
    assert_eq!(record.treasury_share, 3000);
    assert_eq!(record.ai_agent_share, 2000);
    assert_eq!(record.lp_share, 5000);
    assert_eq!(token_client.balance(&fee_source), 0);
    assert_eq!(token_client.balance(&contract_id), 5000);
    assert!(client.last_distribution().is_some());
}

#[test]
fn test_rounding_dust_stays_in_contract_reward_pool() {
    let (_, token_addr, token_client, stellar_asset, contract_id, client) = setup();
    let fee_source = Address::generate(&client.env);
    stellar_asset.mint(&fee_source, &10);
    token_client.approve(&fee_source, &contract_id, &10, &(client.env.ledger().sequence() + 100));
    let record = client.distribute(&token_addr, &fee_source, &10);
    assert_eq!(record.lp_share, 4);
    // LP residual (including rounding dust) stays in the contract reward pool,
    // not parked at the lp_pool address.
    assert_eq!(token_client.balance(&contract_id), 4);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_non_positive_distribution_rejected() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, FeeDistributionContract);
    let client = FeeDistributionContractClient::new(&env, &contract_id);
    client.initialize(&admin, &admin, &admin, &admin, &0, &0);
    client.distribute(&admin, &admin, &0);
}

#[test]
fn test_stake_unstake_roundtrip() {
    let (_, token_addr, token_client, stellar_asset, contract_id, client) = setup();
    let alice = Address::generate(&client.env);
    stellar_asset.mint(&alice, &1000);
    token_client.approve(&alice, &contract_id, &1000, &(client.env.ledger().sequence() + 100));

    client.stake(&token_addr, &alice, &400);
    assert_eq!(client.get_user(&token_addr, &alice).shares, 400);
    assert_eq!(client.get_rewards(&token_addr).total_shares, 400);
    assert_eq!(token_client.balance(&contract_id), 400);

    client.stake(&token_addr, &alice, &100);
    assert_eq!(client.get_user(&token_addr, &alice).shares, 500);

    client.unstake(&token_addr, &alice, &200);
    assert_eq!(client.get_user(&token_addr, &alice).shares, 300);
    assert_eq!(token_client.balance(&alice), 700);
}

#[test]
fn test_late_join_cannot_claim_historical_rewards() {
    let (_, token_addr, token_client, stellar_asset, contract_id, client) = setup();
    let alice = Address::generate(&client.env);
    let bob = Address::generate(&client.env);
    stellar_asset.mint(&alice, &1000);
    stellar_asset.mint(&bob, &1000);
    token_client.approve(&alice, &contract_id, &1000, &(client.env.ledger().sequence() + 100));
    token_client.approve(&bob, &contract_id, &1000, &(client.env.ledger().sequence() + 100));

    client.stake(&token_addr, &alice, &100);
    let fee_source = Address::generate(&client.env);
    stellar_asset.mint(&fee_source, &5000);
    token_client.approve(&fee_source, &contract_id, &5000, &(client.env.ledger().sequence() + 100));
    client.distribute(&token_addr, &fee_source, &5000); // all LP share to alice

    // Bob joins AFTER the distribution; must earn nothing from it.
    client.stake(&token_addr, &bob, &100);
    assert_eq!(client.pending_rewards(&token_addr, &bob), 0);

    // Alice collected the entire LP residual (2500) from the earlier fee.
    assert_eq!(client.pending_rewards(&token_addr, &alice), 2500);
}

#[test]
fn test_partial_exit_preserves_earned_rewards() {
    let (_, token_addr, token_client, stellar_asset, contract_id, client) = setup();
    let alice = Address::generate(&client.env);
    stellar_asset.mint(&alice, &1000);
    token_client.approve(&alice, &contract_id, &1000, &(client.env.ledger().sequence() + 100));

    client.stake(&token_addr, &alice, &100);
    let fee_source = Address::generate(&client.env);
    stellar_asset.mint(&fee_source, &10000);
    token_client.approve(&fee_source, &contract_id, &10000, &(client.env.ledger().sequence() + 100));
    client.distribute(&token_addr, &fee_source, &10000); // lp_share = 5000 to alice (100 shares)

    // Partial exit: alice withdraws half, keeps the rewards earned before exit.
    assert_eq!(client.pending_rewards(&token_addr, &alice), 5000);
    client.unstake(&token_addr, &alice, &50);
    assert_eq!(client.pending_rewards(&token_addr, &alice), 5000);
    assert_eq!(client.claim(&token_addr, &alice), 5000);
    assert_eq!(token_client.balance(&alice), 950 + 5000);
    assert_eq!(client.pending_rewards(&token_addr, &alice), 0);
}

#[test]
fn test_claim_rewards_are_proportional_to_shares() {
    let (_, token_addr, token_client, stellar_asset, contract_id, client) = setup();
    let alice = Address::generate(&client.env);
    let bob = Address::generate(&client.env);
    stellar_asset.mint(&alice, &1000);
    stellar_asset.mint(&bob, &2000);
    token_client.approve(&alice, &contract_id, &1000, &(client.env.ledger().sequence() + 100));
    token_client.approve(&bob, &contract_id, &2000, &(client.env.ledger().sequence() + 100));

    client.stake(&token_addr, &alice, &100);
    client.stake(&token_addr, &bob, &300); // alice 1/4, bob 3/4

    let fee_source = Address::generate(&client.env);
    stellar_asset.mint(&fee_source, &10000);
    token_client.approve(&fee_source, &contract_id, &10000, &(client.env.ledger().sequence() + 100));
    client.distribute(&token_addr, &fee_source, &10000); // lp_share = 5000

    assert_eq!(client.claim(&token_addr, &alice), 1250);
    assert_eq!(client.claim(&token_addr, &bob), 3750);
    assert_eq!(token_client.balance(&contract_id), 0);
}

#[test]
fn test_double_distribute_accrues_to_pending() {
    let (_, token_addr, token_client, stellar_asset, contract_id, client) = setup();
    let alice = Address::generate(&client.env);
    stellar_asset.mint(&alice, &1000);
    token_client.approve(&alice, &contract_id, &1000, &(client.env.ledger().sequence() + 100));
    client.stake(&token_addr, &alice, &100);

    let fee_source = Address::generate(&client.env);
    for _ in 0..2 {
        stellar_asset.mint(&fee_source, &10000);
        token_client.approve(&fee_source, &contract_id, &10000, &(client.env.ledger().sequence() + 100));
        client.distribute(&token_addr, &fee_source, &10000);
    }
    // Two distributions of 5000 LP each → 10000 total, delta index accumulates.
    assert_eq!(client.claim(&token_addr, &alice), 10000);
}
