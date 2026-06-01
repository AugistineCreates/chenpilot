#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, vec, Env, Address, contract, contractimpl, token::{Client as TokenClient, StellarAssetClient}};

// Mock pool contract for testing
#[contract]
pub struct MockPool;

#[contractimpl]
impl MockPool {
    pub fn initialize(env: Env, numer: i128, denom: i128) {
        env.storage().instance().set(&symbol_short!("numer"), &numer);
        env.storage().instance().set(&symbol_short!("denom"), &denom);
    }

    pub fn swap(env: Env, to: Address, _token_in: Address, token_out: Address, amount_in: i128, min_amount_out: i128) -> i128 {
        let numer: i128 = env.storage().instance().get(&symbol_short!("numer")).unwrap_or(1);
        let denom: i128 = env.storage().instance().get(&symbol_short!("denom")).unwrap_or(1);
        let amount_out = amount_in * numer / denom;

        if amount_out < min_amount_out {
            panic!("slippage exceeded");
        }

        // Transfer tokens to recipient from pool
        TokenClient::new(&env, &token_out).transfer(&env.current_contract_address(), &to, &amount_out);

        amount_out
    }
}

#[test]
fn test_single_hop_swap() {
    let env = Env::default();
    env.mock_all_auths();

    // Deploy mock tokens
    let token_admin = Address::generate(&env);
    let token_a = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let token_b = env.register_stellar_asset_contract_v2(token_admin.clone()).address();

    // Deploy mock pool
    let pool_id = env.register(MockPool, ());
    let pool_client = MockPoolClient::new(&env, &pool_id);
    pool_client.initialize(&2, &1); // 1 A = 2 B

    // Pre-mint tokens to pool
    StellarAssetClient::new(&env, &token_b).mint(&pool_id, &1000);

    // Deploy multi-hop swap contract
    let multi_hop_id = env.register(MultiHopSwap, ());
    let multi_hop_client = MultiHopSwapClient::new(&env, &multi_hop_id);

    // Mint some tokens to caller
    let caller = Address::generate(&env);
    StellarAssetClient::new(&env, &token_a).mint(&caller, &100);

    // Execute single hop swap
    let hops = vec![&env, Hop {
        pool: pool_id,
        token_in: token_a.clone(),
        token_out: token_b.clone(),
        amount_in: 100,
        min_amount_out: 199,
    }];
    let results = multi_hop_client.swap(&caller, &hops);

    // Check results
    assert_eq!(results.len(), 1);
    assert_eq!(results.get(0).unwrap().amount_in, 100);
    assert_eq!(results.get(0).unwrap().amount_out, 200);

    // Check caller has received tokens
    assert_eq!(TokenClient::new(&env, &token_b).balance(&caller), 200);

    // Check last out
    assert_eq!(multi_hop_client.get_last_out(), Some(200));
}

#[test]
fn test_multi_hop_swap() {
    let env = Env::default();
    env.mock_all_auths();

    // Deploy mock tokens
    let token_admin = Address::generate(&env);
    let token_a = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let token_b = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let token_c = env.register_stellar_asset_contract_v2(token_admin.clone()).address();

    // Deploy mock pools
    let pool1_id = env.register(MockPool, ());
    let pool1_client = MockPoolClient::new(&env, &pool1_id);
    pool1_client.initialize(&2, &1); // A -> B: 1 A = 2 B
    StellarAssetClient::new(&env, &token_b).mint(&pool1_id, &1000); // Pre-mint B to pool 1

    let pool2_id = env.register(MockPool, ());
    let pool2_client = MockPoolClient::new(&env, &pool2_id);
    pool2_client.initialize(&3, &1); // B -> C: 1 B = 3 C
    StellarAssetClient::new(&env, &token_c).mint(&pool2_id, &2000); // Pre-mint C to pool 2

    // Deploy multi-hop swap contract
    let multi_hop_id = env.register(MultiHopSwap, ());
    let multi_hop_client = MultiHopSwapClient::new(&env, &multi_hop_id);

    // Mint some tokens to caller
    let caller = Address::generate(&env);
    StellarAssetClient::new(&env, &token_a).mint(&caller, &100);

    // Execute multi-hop swap
    let hops = vec![
        &env,
        Hop {
            pool: pool1_id,
            token_in: token_a.clone(),
            token_out: token_b.clone(),
            amount_in: 100,
            min_amount_out: 199,
        },
        Hop {
            pool: pool2_id,
            token_in: token_b,
            token_out: token_c.clone(),
            amount_in: 200,
            min_amount_out: 599,
        },
    ];
    let results = multi_hop_client.swap(&caller, &hops);

    // Check results
    assert_eq!(results.len(), 2);
    assert_eq!(results.get(0).unwrap().amount_out, 200);
    assert_eq!(results.get(1).unwrap().amount_out, 600);

    // Check caller has received tokens
    assert_eq!(TokenClient::new(&env, &token_c).balance(&caller), 600);
}

#[test]
#[should_panic(expected = "no hops provided")]
fn test_empty_hops() {
    let env = Env::default();
    env.mock_all_auths();

    let multi_hop_id = env.register(MultiHopSwap, ());
    let multi_hop_client = MultiHopSwapClient::new(&env, &multi_hop_id);
    let caller = Address::generate(&env);
    multi_hop_client.swap(&caller, &vec![&env]);
}

#[test]
#[should_panic(expected = "slippage exceeded")]
fn test_slippage_guard() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let token_a = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let token_b = env.register_stellar_asset_contract_v2(token_admin.clone()).address();

    let pool_id = env.register(MockPool, ());
    let pool_client = MockPoolClient::new(&env, &pool_id);
    pool_client.initialize(&1, &2); // 1 A = 0.5 B
    StellarAssetClient::new(&env, &token_b).mint(&pool_id, &1000);

    let multi_hop_id = env.register(MultiHopSwap, ());
    let multi_hop_client = MultiHopSwapClient::new(&env, &multi_hop_id);

    let caller = Address::generate(&env);
    StellarAssetClient::new(&env, &token_a).mint(&caller, &100);

    let hops = vec![&env, Hop {
        pool: pool_id,
        token_in: token_a,
        token_out: token_b,
        amount_in: 100,
        min_amount_out: 999, // Too high
    }];
    multi_hop_client.swap(&caller, &hops);
}
