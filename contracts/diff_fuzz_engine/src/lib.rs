//! Core engine for differential fuzzing between Soroban smart contracts and independent reference models.
//!
//! Features:
//! - Deterministic PRNG for reproducible test sequences.
//! - Delta-debugging test-case reduction (shrinking) to find minimal failing operation traces.
//! - Comprehensive diagnostic failure reports preserving ledger state and operation history.
//! - Configurable bounded CI runs and extended nightly campaigns.

pub mod config;
pub mod minimizer;
pub mod prng;
pub mod report;
pub mod runner;
pub mod trace;

pub use config::FuzzConfig;
pub use minimizer::minimize_sequence;
pub use prng::DeterministicPrng;
pub use report::format_failure_report;
pub use runner::{run_fuzz_campaign, DifferentialStateMachine};
pub use trace::{LedgerSnapshot, TraceHistory, TraceStep};
