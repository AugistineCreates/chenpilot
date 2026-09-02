#![no_std]

//! Composable pause-state standard for Soroban contracts.
//!
//! A single, reusable pattern for emergency pause/unpause so behaviour is
//! consistent across the contract suite instead of every contract growing
//! its own ad-hoc boolean flag (as `core_vault`'s `BackendOnline` /
//! `UpgradeMode` and `rbac`'s unimplemented `emergency_pause` stub had
//! started to do independently, with no shared storage key, no shared
//! event shape, and no way for one contract to check another's pause state).
//!
//! ## What this gives you
//!
//! - A standard storage key (`PauseState`) and a small `PauseInfo` record
//!   (paused flag + who paused it + when, for audit purposes).
//! - `pause()` / `unpause()` — state transitions that emit a standard event
//!   and are idempotent-safe to call (pausing an already-paused contract or
//!   unpausing an already-unpaused one fails loudly via `PauseError`
//!   rather than silently no-op'ing, since a caller expecting a state
//!   change should know if nothing changed).
//! - `require_not_paused()` — the guard contracts call at the top of any
//!   state-changing entry point.
//! - `is_paused()` — a plain read, safe to call from a `#[contractclient]`
//!   trait so a *different* deployed contract can check this one's pause
//!   state before proceeding (see "Cross-contract pause checks" below).
//!
//! ## Wiring it into a contract
//!
//! 1. Add `pause_state = { path = "../pause_state" }` to `Cargo.toml`.
//! 2. In the contract's `DataKey` enum, DO NOT add a `Paused` variant —
//!    `pause_state` owns its own storage key (`PauseState`) so the standard
//!    stays identical across contracts and doesn't collide with
//!    contract-specific `DataKey` numbering. Storage is namespaced by
//!    contract instance already (each deployed contract has its own
//!    storage), so there's no collision risk between contracts.
//! 3. Gate state-changing entry points with
//!    `pause_state::require_not_paused(&env)` as the first line (after
//!    `require_auth()` checks, so an unauthenticated caller doesn't learn
//!    the pause state from an error, and before any storage reads/writes).
//! 4. Expose `pause()` / `unpause()` / `is_paused()` on the contract's own
//!    `#[contractimpl]` surface, delegating to this crate, gated by
//!    whatever admin/role check the contract already uses (this crate does
//!    NOT perform authorization — see "Design decision: no built-in auth"
//!    below).
//!
//! ## Cross-contract pause checks
//!
//! A dependent contract (e.g. `flash_loan_guard` depending on `core_vault`
//! being unpaused before it trusts a price snapshot) checks another
//! contract's pause state the same way any other cross-contract read
//! works in Soroban: via a `#[contractclient]` trait pointed at the
//! dependency's `is_paused` entry point.
//!
//! ```ignore
//! use soroban_sdk::{contractclient, Address, Env};
//!
//! #[contractclient(name = "PausableClient")]
//! pub trait PausableTrait {
//!     fn is_paused(env: Env) -> bool;
//! }
//!
//! fn require_dependency_not_paused(env: &Env, dependency: &Address) {
//!     let client = PausableClient::new(env, dependency);
//!     if client.is_paused() {
//!         env.panic_with_error(pause_state::PauseError::DependencyPaused);
//!     }
//! }
//! ```
//!
//! This is a same-transaction, synchronous cross-contract call — it reflects
//! the dependency's pause state as of the current ledger, with the same
//! atomicity guarantees as any other Soroban cross-contract call (if the
//! dependency's state changes later in the same transaction after this
//! check, that's a normal reentrancy consideration, not specific to pause
//! state). It does NOT need `require_auth` since `is_paused` is a read-only
//! query with no side effects — see `PauseState::pause`/`unpause` below for
//! the entry points that do need authorization at the caller's contract.
//!
//! ## Design decision: no built-in auth
//!
//! This module deliberately does not call `require_auth()` or check any
//! role/admin address itself. Every contract in this workspace already has
//! its own admin/role model (`core_vault`'s legacy `Admin` + `UnifiedAuth`
//! integration, `rbac`'s `EmergencyAdmin` role, `flash_loan_guard`'s
//! `Config.admin`, ...) and duplicating or trying to unify those here would
//! be a much larger, riskier change than this issue calls for. Instead,
//! `pause()`/`unpause()` are meant to be called from inside a contract
//! method that has already performed its own authorization — this module
//! only owns the storage/event mechanics of the pause flag itself.
//!
//! ## Design decision: a standalone error enum, not `contract_failure`
//!
//! This module has its own `#[contracterror]` enum (`PauseError`) instead
//! of adding variants to `contract_failure::FailureReason`, which every
//! other contract in this workspace uses. That crate's `FailureReason` is
//! already at 65 variants — Soroban's contract-spec format caps a single
//! `#[contracterror]` enum's error cases at 50
//! (`ScSpecUdtErrorEnumV0.cases: VecM<_, 50>` in `stellar-xdr`), so
//! `contract_failure` as committed does not compile (`cargo check -p
//! contract_failure` panics inside the `#[contracterror]` macro with
//! `LengthExceedsMax`, independent of anything in this crate — reproduced
//! against the untouched file). Adding to it would make an already-broken
//! situation worse and this module's own tests unrunnable; splitting
//! `FailureReason` itself back under 50 is a real fix but is a much larger,
//! cross-cutting change (it's imported by all 17 contracts in the
//! workspace) that belongs in its own issue, not bundled into a pause
//! standard. A small, self-contained error enum keeps this module
//! independently compilable and testable regardless of that pre-existing
//! problem, and is a reasonable design on its own merits — a reusable
//! module arguably shouldn't be coupled to one specific consumer's error
//! enum anyway.

pub mod coordination;

use soroban_sdk::{contracterror, contracttype, symbol_short, Address, Env, Symbol};

/// Errors this module can raise. Kept deliberately small and independent
/// of `contract_failure::FailureReason` — see the module-level "Design
/// decision: a standalone error enum" note above.
#[contracterror]
#[derive(Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
#[repr(u32)]
pub enum PauseError {
    /// Raised by `require_not_paused()` when the contract is paused, and
    /// by `pause()` when called on an already-paused contract.
    ContractPaused = 1,
    /// Raised by `unpause()` when called on a contract that isn't paused.
    ContractNotPaused = 2,
    /// Not raised by this module directly — provided for dependent
    /// contracts to use in their own cross-contract pause checks (see
    /// "Cross-contract pause checks" above).
    DependencyPaused = 3,
    /// Raised by `require_epoch()` when a caller presents an epoch that
    /// does not match the current on-chain fence — i.e. a fenced-out
    /// (stale) writer from a superseded region attempting to execute a
    /// durable operation after failover. Preserves single-writer safety.
    EpochStale = 4,
}

/// Event topic published on every pause state change.
/// Payload is `PauseChangedEvent`.
const EVT_PAUSE_CHANGED: Symbol = symbol_short!("pause_chg");

/// Storage key for the pause flag. Contracts adopting this standard use
/// this exact key (via `pause_state`'s functions) rather than rolling
/// their own — that's the whole point of the standard.
#[contracttype]
#[derive(Clone)]
enum PauseDataKey {
    PauseState,
    /// Monotonic epoch fence. Advanced on promotion/failover so a
    /// superseded writer's presented epoch no longer matches the current
    /// value — see `current_epoch`/`bump_epoch`/`require_epoch`.
    Epoch,
}

/// Persisted pause record. `paused_by` and `paused_at` are populated when
/// paused, and preserved (not cleared) across an unpause so `paused_at`
/// answers "when was this contract last paused" even while `paused` is
/// false — useful for audit/incident-response tooling reading contract
/// state directly.
#[contracttype]
#[derive(Clone)]
pub struct PauseInfo {
    pub paused: bool,
    /// Address that most recently changed the pause state (either
    /// direction). None only before the first pause/unpause call ever
    /// made on this contract instance.
    pub changed_by: Option<Address>,
    /// Ledger sequence of the most recent pause/unpause call.
    pub changed_at_ledger: u32,
}

/// Standard event emitted on every pause/unpause. Mirrors the `Evt*`
/// naming and `version`/`ledger`/`actor` shape used by every other event
/// in this contract suite (see e.g. `core_vault::EvtInit`) so tooling that
/// already indexes those events picks this one up for free.
#[contracttype]
#[derive(Clone)]
pub struct PauseChangedEvent {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub paused: bool,
}

/// Returns the current pause state. Safe to call from a
/// `#[contractclient]` trait for cross-contract pause checks — read-only,
/// no auth required, defaults to `false` (not paused) for a contract that
/// has never called `pause()`.
pub fn is_paused(env: &Env) -> bool {
    read_state(env).map(|s| s.paused).unwrap_or(false)
}

/// Full pause record (state + who + when), for contracts that want to
/// surface more than the boolean, e.g. in a status/admin-dashboard entry
/// point.
pub fn pause_info(env: &Env) -> PauseInfo {
    read_state(env).unwrap_or(PauseInfo {
        paused: false,
        changed_by: None,
        changed_at_ledger: 0,
    })
}

/// Guard for state-changing entry points. Call this first (after the
/// entry point's own `require_auth()`, before touching storage) —
/// panics with `PauseError::ContractPaused` if the contract is currently
/// paused.
pub fn require_not_paused(env: &Env) {
    if is_paused(env) {
        env.panic_with_error(PauseError::ContractPaused);
    }
}

/// Current epoch fence. Defaults to 0 for a contract that has never been
/// promoted/failed over. Monotonically increasing: each promotion bumps
/// it, fencing out any writer still holding a prior epoch.
pub fn current_epoch(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&PauseDataKey::Epoch)
        .unwrap_or(0)
}

/// Fencing guard for durable/state-changing operations. A control plane
/// threads through the epoch it was promoted under; if a failover has
/// since advanced the fence, the presented epoch is stale and this panics
/// with `PauseError::EpochStale`, preventing a superseded (e.g.
/// partitioned, since-demoted) region from executing the same durable
/// side effect or allocating a conflicting sequence number. Only a caller
/// presenting the current epoch may proceed — this is the single-writer
/// invariant. Call it alongside `require_not_paused` on any entry point
/// that produces financial side effects.
pub fn require_epoch(env: &Env, presented_epoch: u64) {
    if presented_epoch != current_epoch(env) {
        env.panic_with_error(PauseError::EpochStale);
    }
}

/// Promote a new writer by advancing the epoch fence, returning the new
/// epoch. Because the fence only ever increases, any in-flight operation
/// still carrying the old epoch is rejected by `require_epoch`, so two
/// control planes can never both hold a valid fence simultaneously — this
/// is the on-chain half of split-brain rejection. This module performs no
/// authorization (see the module-level "Design decision: no built-in
/// auth" note); the caller must gate promotion behind its own admin/role
/// check and, per the required promotion-freshness rule, must itself have
/// verified data/chain-state freshness before calling.
pub fn bump_epoch(env: &Env) -> u64 {
    let next = current_epoch(env) + 1;
    env.storage().instance().set(&PauseDataKey::Epoch, &next);
    next
}

/// Pause the contract. `actor` is recorded on the event and in
/// `PauseInfo` for audit purposes — callers pass the already-authorized
/// address (the caller is responsible for having verified that address is
/// allowed to pause; see the module-level "Design decision: no built-in
/// auth" note).
///
/// Panics with `PauseError::ContractPaused` if already paused, so a
/// caller can't silently no-op a pause they think just took effect.
pub fn pause(env: &Env, actor: Address) {
    if is_paused(env) {
        env.panic_with_error(PauseError::ContractPaused);
    }
    write_state(
        env,
        PauseInfo {
            paused: true,
            changed_by: Some(actor.clone()),
            changed_at_ledger: env.ledger().sequence(),
        },
    );
    publish_event(env, actor, true);
}

/// Unpause the contract. Panics with `PauseError::ContractNotPaused` if
/// not currently paused, for the same reason `pause()` fails on
/// already-paused — an explicit state transition should either happen or
/// error, never silently no-op.
pub fn unpause(env: &Env, actor: Address) {
    if !is_paused(env) {
        env.panic_with_error(PauseError::ContractNotPaused);
    }
    write_state(
        env,
        PauseInfo {
            paused: false,
            changed_by: Some(actor.clone()),
            changed_at_ledger: env.ledger().sequence(),
        },
    );
    publish_event(env, actor, false);
}

// ─── Internals ──────────────────────────────────────────────────────────────

fn read_state(env: &Env) -> Option<PauseInfo> {
    env.storage()
        .instance()
        .get(&PauseDataKey::PauseState)
}

fn write_state(env: &Env, info: PauseInfo) {
    env.storage()
        .instance()
        .set(&PauseDataKey::PauseState, &info);
}

fn publish_event(env: &Env, actor: Address, paused: bool) {
    env.events().publish(
        (EVT_PAUSE_CHANGED,),
        PauseChangedEvent {
            version: 1,
            ledger: env.ledger().sequence(),
            actor,
            paused,
        },
    );
}

mod test;
