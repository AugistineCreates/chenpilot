#![cfg(test)]

use super::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Events as _, Ledger as _},
    Env, FromVal,
};

// ---------------------------------------------------------------------------
// Minimal contract wrapper — pause_state itself is a plain library crate
// (no #[contract] entry points), so tests exercise it through a thin
// wrapper contract, the same way a real adopting contract would.
// ---------------------------------------------------------------------------
#[contract]
pub struct PausableTestContract;

#[contractimpl]
impl PausableTestContract {
    pub fn pause(env: Env, actor: Address) {
        crate::pause(&env, actor);
    }

    pub fn unpause(env: Env, actor: Address) {
        crate::unpause(&env, actor);
    }

    pub fn is_paused(env: Env) -> bool {
        crate::is_paused(&env)
    }

    pub fn pause_info(env: Env) -> PauseInfo {
        crate::pause_info(&env)
    }

    pub fn require_not_paused(env: Env) {
        crate::require_not_paused(&env);
    }
}

fn setup(env: &Env) -> (Address, PausableTestContractClient<'_>) {
    let actor = Address::generate(env);
    let contract_id = env.register(PausableTestContract, ());
    let client = PausableTestContractClient::new(env, &contract_id);
    (actor, client)
}

// ---------------------------------------------------------------------------
// Default state
// ---------------------------------------------------------------------------

#[test]
fn test_defaults_to_not_paused() {
    let env = Env::default();
    let (_actor, client) = setup(&env);

    assert!(!client.is_paused());

    let info = client.pause_info();
    assert!(!info.paused);
    assert!(info.changed_by.is_none());
    assert_eq!(info.changed_at_ledger, 0);
}

#[test]
fn test_require_not_paused_passes_when_not_paused() {
    let env = Env::default();
    let (_actor, client) = setup(&env);

    // Should not panic.
    client.require_not_paused();
}

// ---------------------------------------------------------------------------
// Pause
// ---------------------------------------------------------------------------

#[test]
fn test_pause_sets_state() {
    let env = Env::default();
    env.mock_all_auths();
    let (actor, client) = setup(&env);

    client.pause(&actor);

    assert!(client.is_paused());
    let info = client.pause_info();
    assert!(info.paused);
    assert_eq!(info.changed_by, Some(actor));
}

#[test]
fn test_pause_records_actor_and_ledger() {
    let env = Env::default();
    env.mock_all_auths();
    let (actor, client) = setup(&env);

    env.ledger().set_sequence_number(150);
    client.pause(&actor);

    let info = client.pause_info();
    assert_eq!(info.changed_by, Some(actor));
    assert_eq!(info.changed_at_ledger, 150);
}

#[test]
#[should_panic]
fn test_double_pause_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (actor, client) = setup(&env);

    client.pause(&actor);
    client.pause(&actor); // already paused — must fail, not silently no-op
}

#[test]
#[should_panic]
fn test_require_not_paused_panics_when_paused() {
    let env = Env::default();
    env.mock_all_auths();
    let (actor, client) = setup(&env);

    client.pause(&actor);
    client.require_not_paused(); // must panic — contract is paused
}

// ---------------------------------------------------------------------------
// Unpause
// ---------------------------------------------------------------------------

#[test]
fn test_unpause_clears_state() {
    let env = Env::default();
    env.mock_all_auths();
    let (actor, client) = setup(&env);

    client.pause(&actor);
    assert!(client.is_paused());

    client.unpause(&actor);
    assert!(!client.is_paused());
}

#[test]
fn test_unpause_preserves_changed_by_and_ledger_from_the_unpause_call() {
    let env = Env::default();
    env.mock_all_auths();
    let (actor, client) = setup(&env);

    let pauser = Address::generate(&env);
    client.pause(&pauser);

    env.ledger().set_sequence_number(200);
    client.unpause(&actor);

    let info = client.pause_info();
    assert!(!info.paused);
    // changed_by / changed_at_ledger reflect the most recent transition
    // (the unpause), not the original pause.
    assert_eq!(info.changed_by, Some(actor));
    assert_eq!(info.changed_at_ledger, 200);
}

#[test]
#[should_panic]
fn test_double_unpause_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (actor, client) = setup(&env);

    client.unpause(&actor); // never paused — must fail, not silently no-op
}

#[test]
fn test_unpause_then_require_not_paused_passes() {
    let env = Env::default();
    env.mock_all_auths();
    let (actor, client) = setup(&env);

    client.pause(&actor);
    client.unpause(&actor);

    // Should not panic.
    client.require_not_paused();
}

// ---------------------------------------------------------------------------
// Pause / unpause cycle
// ---------------------------------------------------------------------------

#[test]
fn test_multiple_pause_unpause_cycles() {
    let env = Env::default();
    env.mock_all_auths();
    let (actor, client) = setup(&env);

    for _ in 0..3 {
        client.pause(&actor);
        assert!(client.is_paused());
        client.unpause(&actor);
        assert!(!client.is_paused());
    }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[test]
fn test_pause_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (actor, client) = setup(&env);

    client.pause(&actor);

    // env.events().all() reflects the most recent top-level invocation, so
    // this is checked right after the call it corresponds to (see rbac's
    // test_grant_emits_event for the same pattern elsewhere in this
    // workspace).
    let events = env.events().all();
    assert!(!events.is_empty(), "pause() should publish an event");
    let last = events.last().unwrap();
    let data = PauseChangedEvent::from_val(&env, &last.2);
    assert_eq!(data.version, 1);
    assert_eq!(data.actor, actor);
    assert!(data.paused);
}

#[test]
fn test_unpause_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (actor, client) = setup(&env);

    client.pause(&actor);
    client.unpause(&actor);

    let events = env.events().all();
    assert!(!events.is_empty(), "unpause() should publish an event");
    let last = events.last().unwrap();
    let data = PauseChangedEvent::from_val(&env, &last.2);
    assert_eq!(data.version, 1);
    assert_eq!(data.actor, actor);
    assert!(!data.paused);
}
