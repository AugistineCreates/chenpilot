#![cfg(test)]

use super::*;
use soroban_sdk::testutils::storage::{Instance as _, Persistent as _};
use soroban_sdk::{contract, contractimpl, contracttype, testutils::Ledger, Address, Env};

const MIN_PERSISTENT_TTL: u32 = 500;
const MIN_TEMP_TTL: u32 = 100;
const MAX_TTL: u32 = 15_000;
const INSTANCE_THRESHOLD: u32 = 1_000;
const INSTANCE_EXTEND_TO: u32 = 10_000;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Balance(u32),
    Config,
    Nonce(u32),
}

impl PolicyKey for DataKey {
    fn policy(&self) -> KeyPolicy {
        match self {
            DataKey::Balance(_) => KeyPolicy::new(Durability::Persistent, 1_000, 10_000),
            DataKey::Config => KeyPolicy::new(Durability::Instance, 1_000, 10_000),
            DataKey::Nonce(_) => KeyPolicy::new(Durability::Temporary, 200, 500),
        }
    }
}

/// Every public entry point keeps the contract instance alive first.
fn keep_alive(env: &Env) {
    Store::new(env).bump_instance(INSTANCE_THRESHOLD, INSTANCE_EXTEND_TO);
}

#[contract]
struct Harness;

#[contractimpl]
impl Harness {
    pub fn put_balance(env: Env, id: u32, amount: i128) {
        keep_alive(&env);
        Store::new(&env).set(&DataKey::Balance(id), &amount);
    }
    pub fn balance(env: Env, id: u32) -> Option<i128> {
        keep_alive(&env);
        Store::new(&env).get(&DataKey::Balance(id))
    }
    pub fn put_config(env: Env, value: u32) {
        keep_alive(&env);
        Store::new(&env).set(&DataKey::Config, &value);
    }
    pub fn put_nonce(env: Env, id: u32) {
        keep_alive(&env);
        Store::new(&env).set(&DataKey::Nonce(id), &true);
    }
    pub fn nonce_used(env: Env, id: u32) -> Option<bool> {
        keep_alive(&env);
        Store::new(&env).get(&DataKey::Nonce(id))
    }
}

fn setup() -> (Env, Address) {
    let env = Env::default();
    env.ledger().with_mut(|li| {
        li.sequence_number = 1_000;
        li.min_persistent_entry_ttl = MIN_PERSISTENT_TTL;
        li.min_temp_entry_ttl = MIN_TEMP_TTL;
        li.max_entry_ttl = MAX_TTL;
    });
    let id = env.register(Harness, ());
    (env, id)
}

fn advance(env: &Env, ledgers: u32) {
    env.ledger().with_mut(|li| li.sequence_number += ledgers);
}

fn balance_ttl(env: &Env, contract: &Address, id: u32) -> u32 {
    env.as_contract(contract, || {
        env.storage().persistent().get_ttl(&DataKey::Balance(id))
    })
}

fn instance_ttl(env: &Env, contract: &Address) -> u32 {
    env.as_contract(contract, || env.storage().instance().get_ttl())
}

#[test]
fn persistent_write_sets_ttl_to_policy_extend_to() {
    let (env, id) = setup();
    HarnessClient::new(&env, &id).put_balance(&1, &50);
    assert_eq!(balance_ttl(&env, &id, 1), 10_000);
}

#[test]
fn instance_write_sets_ttl_to_policy_extend_to() {
    let (env, id) = setup();
    HarnessClient::new(&env, &id).put_config(&7);
    assert_eq!(instance_ttl(&env, &id), 10_000);
}

#[test]
fn read_below_threshold_renews_ttl() {
    let (env, id) = setup();
    let client = HarnessClient::new(&env, &id);
    client.put_balance(&1, &50);
    advance(&env, 9_500); // remaining 500, below threshold 1_000
    assert_eq!(client.balance(&1), Some(50));
    assert_eq!(balance_ttl(&env, &id, 1), 10_000);
}

#[test]
fn read_above_threshold_leaves_ttl_alone() {
    let (env, id) = setup();
    let client = HarnessClient::new(&env, &id);
    client.put_balance(&1, &50);
    advance(&env, 100); // remaining 9_900, above threshold
    assert_eq!(client.balance(&1), Some(50));
    assert_eq!(balance_ttl(&env, &id, 1), 9_900);
}

#[test]
fn expired_temporary_entry_behaves_as_deleted() {
    let (env, id) = setup();
    let client = HarnessClient::new(&env, &id);
    client.put_nonce(&1);
    assert_eq!(client.nonce_used(&1), Some(true));
    advance(&env, 501); // one ledger past extend_to = 500
    assert_eq!(client.nonce_used(&1), None);
}

#[test]
#[should_panic(expected = "archived")]
fn expired_persistent_entry_cannot_be_read_without_restore() {
    let (env, id) = setup();
    let client = HarnessClient::new(&env, &id);
    client.put_balance(&1, &50);
    advance(&env, 9_500);
    client.put_config(&0); // renews the instance so only the balance can expire
    advance(&env, 501); // one ledger past the balance's extend_to = 10_000
    assert!(instance_ttl(&env, &id) > 0); // the instance is still alive
    client.balance(&1);
}

#[test]
#[should_panic(expected = "archived")]
fn contract_instance_is_archived_when_never_bumped() {
    let (env, id) = setup();
    let client = HarnessClient::new(&env, &id);
    advance(&env, MIN_PERSISTENT_TTL + 1);
    client.put_config(&1); // the host refuses before the function body runs
}

#[test]
fn policy_validity_checks_ordering_and_network_max() {
    let ok = KeyPolicy::new(Durability::Persistent, 1_000, 10_000);
    assert!(ok.is_valid(15_000));
    assert!(!ok.is_valid(9_999)); // extend_to above network max
    assert!(!KeyPolicy::new(Durability::Persistent, 10_001, 10_000).is_valid(15_000));
}
