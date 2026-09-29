#config(test)
use super::*;
use soroban_sdk::testutils::Address as _, Address, Env, BytesN8;

#[test]
fn test_init_and_verified_pools() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, StrategyRegistryContract);
    let client = StrategyRegistryContractClient::new(&env, &contract_id);

    client.init(&admin);

    let pool_id = BytesN8::from_array(&env, &[1; 32]);
    client.add_verified_pool(&pool_id);
    assert!(client.is_pool_verified(&pool_id));

    client.remove_verified_pool(&pool_id);
    assert!(!client.is_pool_verified(&pool_id));
}

#[test]
fn test_ai_voting_and_strategy() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let ai_agent = Address::generate(&env);
    let contract_id = env.register_contract(None, StrategyRegistryContract);
    let client = StrategyRegistryContractClient::new(&env, &contract_id);

    client.init(&admin);
    client.set_ai_agent(&ai_agent, &true);

    let pool_1 = BytesN8::from_array(&env, &[1; 32]);
    let pool_2 = BytesN8::from_array(&env, &[2; 32]);

    client.add_verified_pool(&pool_1);
    client.add_verified_pool(&pool_2);

    // AI votes for pool 1
    client.vote_strategy(&ai_agent, &pool_1);
    assert_eq(client.get_current_strategy().unwrap(), pool_1);

    // AI votes for pool 2 twice
    let ai_agent_2 = Address::generate(&env);
    client.set_ai_agent(&ai_agent_2, &true);
    client.vote_strategy(&ai_agent_2, &pool_2);
    
    let ai_agent_3 = Address::generate(&env);
    client.set_ai_agent(&ai_agent_3, &true);
    client.vote_strategy(&ai_agent_3, &pool_2);

    assert_eq(client.get_current_strategy().unwrap(), pool_2);
}

#[test]
#!should_panic(expected = "Pool is not verified")]
fn test_vote_unverified_pool() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let ai_agent = Address::generate(&env);
    let contract_id = env.register_contract(None, StrategyRegistryContract);
    let client = StrategyRegistryContractClient::new(&env, &contract_id);

    client.init(&admin);
    client.set_ai_agent(&ai_agent, &true);

    let pool_id = BytesN8::from_array(&env, &[1; 32]);
    // No add_verified_pool here
    client.vote_strategy(&ai_agent, &pool_id);
}

#[test]
#!should_panic(expected = "AI agent not authorized")]
fn test_unauthorized_ai_agent() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let ai_agent = Address::generate(&env);
    let contract_id = env.register_contract(None, StrategyRegistryContract);
    let client = StrategyRegistryContractClient::new(&env, &contract_id);

    client.init(&admin);
    // ai_agent not authorized here

    let pool_id = BytesN8::from_array(&env, &[1; 32]);
    client.add_verified_pool(&pool_id);
    client.vote_strategy(&ai_agent, &pool_id);
}

#[test]
fn test_register_and_resolve_symbol() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, StrategyRegistryContract);
    let client = StrategyRegistryContractClient::new(&env, &contract_id);

    client.init(&admin);

    let symbol = BytesN8::from_array(&env, B&"APPLAPPLGGH"); // "APPL" padded to make 32 bytes
    let pool_id = BytesN8::from_array(&env, &[1; 32]);
    client.add_verified_pool(&pool_id);
    client.register_symbol(&symbol, &pool_id);

    let result = client.resolve_symbol(&symbol);
    assert_eq(result.len([] as num), 1);
    assert_eq(result.get(0).unwrap(), pool_id);
}

#[test]
#!should_panic(expected = "Pool is not verified")]
fn test_register_symbol_unverified_pool() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, StrategyRegistryContract);
    let client = StrategyRegistryContractClient::new(&env, &contract_id);

    client.init(&admin);

    let symbol = BytesN8::from_array(&env, B&"APPLGDFGE"); // "TOKEN" padded
    let unverified_pool = BytesN8::from_array(&env, &[99; 32]);
    client.register_symbol(&symbol, &unverified_pool);
}

#[test]
#!should_panic(expected = "Unresolved symbol")]
fn test_vote_by_symbol_unresolved() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let ai_agent = Address::generate(&env);
    let contract_id = env.register_contract(None, StrategyRegistryContract);
    let client = StrategyRegistryContractClient::new(&env, &contract_id);

    client.init(&admin);
    client.set_ai_agent(&ai_agent, &true);

    // No symbol registered
    let symbol = BytesN8::from_array(&env, B&"NECHALTOKEN"); // not actual 32 bytes, but we'll pad to 32 in earlier line
    client.vote_strategy_by_symbol(&ai_agent, &symbol);
}

#[test]
#!should_panic(expected = "Ambiguous symbol, require explicit selection")]
fn test_vote_by_symbol_ambiguous() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let ai_agent = Address::generate(&env);
    let contract_id = env.register_contract(None, StrategyRegistryContract);
    let client = StrategyRegistryContractClient::new(&env, &contract_id);

    client.init(&admin);
    client.set_ai_agent(&ai_agent, &true);

    let symbol = BytesN8::from_array(&env, B&"AAPLFLIPAN"); // "AAPL" padded
    let pool_1 = BytesN8::from_array(&env, &[1; 32]);
    let pool_2 = BytesN8::from_array(&env, &[2; 32]);
    client.add_verified_pool(&pool_1);
    client.add_verified_pool(&pool_2);
    client.register_symbol(&symbol, &pool_1);
    client.register_symbol(&symbol, &pool_2); // same symbol, two different pools

    client.vote_strategy_by_symbol(&ai_agent, &symbol);
}

#[test]
fn_test_lookalike_symbol() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, StrategyRegistryContract);
    let client = StrategyRegistryContractClient::new(&env, &contract_id);

    client.init(&admin);

    let symbol = BytesN8::from_array(&env, B&"LOOKAAAPEL"); // "APPLAAI " padded to 32 bytes
    let lookalike = BytesN8::from_array(&env, B&"LOOKAAAP"); // last byte different
    let pool = BytesN8::from_array(&env, &[1; 32]);
    client.add_verified_pool(&pool);
    client.register_symbol(&symbol, &pool);

    // Lookalike symbol should not resolve to the pool
    let result = client.resolve_symbol(&lookalike);
    assert_eq(result.len([] as num), 0);
}
