//! # Protocol-Wide Conservation Invariants
//!
//! This crate implements end-to-end value-conservation invariants across contract
//! boundaries (issue #673). Individual contracts may balance internally while
//! cross-contract transfers, fees, and share accounting create or lose value at
//! the protocol level. The tests in `test_invariants` exercise composed call
//! sequences over `core_vault` (deposits / shares / locked force-exit funds),
//! `fee_distribution` (fee splits with rounding dust), and `multi_hop_swap`
//! (cross-contract transfers) against a single shared token ledger.
//!
//! ## Covered invariants
//!
//! * __INV-1 Ledger conservation__: the sum of tokens held across every protocol
//!   contract reconciles exactly with the minted supply — value is never created
//!   or destroyed outside an explicit mint.
//! * __INV-2 Share / deposit conservation__: the value accrued to users (their
//!   honest per-user claim) always equals the value physically held by the vault.
//! * __INV-3 Fee-split conservation__: `treasury + ai_agent + lp == amount`.
//!   The `lp_share` residual absorbs all basis-point rounding, so no fees are
//!   created or destroyed.
//! * __INV-4 Locked-funds conservation__: pending force-exit amounts are backed
//!   by vault balance and are only released once eligible. During the pending
//!   window a user has both a `Deposit` and a `ForceExit` recording the *same*
//!   tokens, so the honest claim is `max(deposit, force_exit)` per user — the
//!   pending window never double-counts a user, and `owned` is never inflated.
//! * __INV-5 Non-negativity & no value creation__: every accounting quantity
//!   stays `>= 0`; aggregate protocol balance never exceeds balance held.
//! * __INV-6 Rounding-dust bound__: fee dust (what basis-point division cannot
//!   split evenly) is non-negative and fully absorbed by the LP residual; swap
//!   truncation dust stays in the pool reserve, so dust never compounds into
//!   value creation or loss.
//!
//! A deterministic cross-contract fuzzer generates arbitrary valid call
//! sequences; any counterexample is reduced by delta-debugging to a minimized
//! transaction trace and reported in the failure message.
//!
//! CI (`release-gates.yml` contract-conservation job) runs these against every
//! release candidate.

#![no_std]
use soroban_sdk::{contract, contractimpl, Env};
use contract_failure::{fail, FailureReason};

/// A minimal type to anchor this crate's contract-free test harness.
/// The real behaviour lives in `test_invariants` (see module doc above).
#[contract]
pub struct ConservationProbeContract;

#[contractimpl]
impl ConservationProbeContract {
    /// No-op entrypoint retained so the crate builds as a Soroban cdylib.
    pub fn probe(env: Env) -> u32 {
        let ledger = env.ledger().sequence();
        if ledger == 0 {
            fail(&env, FailureReason::InvalidState);
        }
        ledger
    }
}

#[cfg(test)]
mod test_invariants;
