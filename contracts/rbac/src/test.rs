#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Events};
use soroban_sdk::{symbol_short, vec, Env, Address, IntoVal, FromVal};

fn setup(env: &Env) -> (Address, RbacContractClient<'_>) {
    let admin = Address::generate(env);
    let id = env.register(RbacContract, ());
    let client = RbacContractClient::new(env, &id);
    client.init(&admin);
    (admin, client)
}

#[test]
fn test_grant_and_check_role() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, client) = setup(&env);
    let user = Address::generate(&env);

    assert!(!client.has_role(&user, &Role::OracleProvider));
    client.grant_role(&user, &Role::OracleProvider);
    assert!(client.has_role(&user, &Role::OracleProvider));
    // other roles unaffected
    assert!(!client.has_role(&user, &Role::AgentOperator));
}

#[test]
fn test_revoke_role() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, client) = setup(&env);
    let user = Address::generate(&env);

    client.grant_role(&user, &Role::AgentOperator);
    assert!(client.has_role(&user, &Role::AgentOperator));

    client.revoke_role(&user, &Role::AgentOperator);
    assert!(!client.has_role(&user, &Role::AgentOperator));
}

#[test]
fn test_grant_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, client) = setup(&env);
    let contract_id = client.address.clone();
    let user = Address::generate(&env);

    client.grant_role(&user, &Role::EmergencyAdmin);

    let events = env.events().all();
    let last = events.last().unwrap();
    assert_eq!(
        last.1,
        vec![&env, symbol_short!("rbac").into_val(&env), symbol_short!("role_grant").into_val(&env), contract_id.into_val(&env)]
    );
    let data = EvtRoleGranted::from_val(&env, &last.2);
    assert_eq!(data.version, 1);
    assert_eq!(data.to, user);
    assert_eq!(data.role, Role::EmergencyAdmin);
    assert_eq!(data.by, admin);
    assert_eq!(data.actor, admin);
}

#[test]
fn test_revoke_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, client) = setup(&env);
    let contract_id = client.address.clone();
    let user = Address::generate(&env);

    client.grant_role(&user, &Role::OracleProvider);
    client.revoke_role(&user, &Role::OracleProvider);

    let events = env.events().all();
    let last = events.last().unwrap();
    assert_eq!(
        last.1,
        vec![&env, symbol_short!("rbac").into_val(&env), symbol_short!("role_revoke").into_val(&env), contract_id.into_val(&env)]
    );
    let data = EvtRoleRevoked::from_val(&env, &last.2);
    assert_eq!(data.version, 1);
    assert_eq!(data.from, user);
    assert_eq!(data.role, Role::OracleProvider);
    assert_eq!(data.by, admin);
    assert_eq!(data.actor, admin);
}

#[test]
fn test_transfer_admin_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (old_admin, client) = setup(&env);
    let contract_id = client.address.clone();
    let new_admin = Address::generate(&env);

    client.transfer_admin(&new_admin);

    let events = env.events().all();
    let last = events.last().unwrap();
    assert_eq!(
        last.1,
        vec![&env, symbol_short!("rbac").into_val(&env), symbol_short!("adm_xfer").into_val(&env), contract_id.into_val(&env)]
    );
    let data = EvtAdminTransferred::from_val(&env, &last.2);
    assert_eq!(data.version, 1);
    assert_eq!(data.old_admin, old_admin);
    assert_eq!(data.new_admin, new_admin);
    assert_eq!(data.actor, old_admin);
}

#[test]
fn test_role_gated_actions_pass() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, client) = setup(&env);

    let oracle = Address::generate(&env);
    let operator = Address::generate(&env);
    let emergency = Address::generate(&env);

    client.grant_role(&oracle, &Role::OracleProvider);
    client.grant_role(&operator, &Role::AgentOperator);
    client.grant_role(&emergency, &Role::EmergencyAdmin);

    assert_eq!(client.submit_price(&oracle, &42), 42);
    assert_eq!(client.run_agent(&operator, &7), 7);
    client.emergency_pause(&emergency); // should not panic
}

#[test]
#[should_panic(expected = "unauthorized: missing role")]
fn test_submit_price_without_role() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, client) = setup(&env);
    let rando = Address::generate(&env);
    client.submit_price(&rando, &99);
}

#[test]
#[should_panic(expected = "unauthorized: missing role")]
fn test_run_agent_without_role() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, client) = setup(&env);
    let rando = Address::generate(&env);
    client.run_agent(&rando, &1);
}

#[test]
#[should_panic(expected = "unauthorized: missing role")]
fn test_emergency_pause_without_role() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, client) = setup(&env);
    let rando = Address::generate(&env);
    client.emergency_pause(&rando);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_init() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, client) = setup(&env);
    client.init(&admin);
}
