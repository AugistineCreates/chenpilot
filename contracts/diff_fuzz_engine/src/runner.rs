//! Generic execution loop for state-machine differential fuzzers.

use crate::config::FuzzConfig;
use crate::minimizer::minimize_sequence;
use crate::prng::DeterministicPrng;
use crate::report::format_failure_report;
use crate::trace::{LedgerSnapshot, TraceHistory, TraceStep};
use std::fmt::Debug;

/// Trait defining a differential state machine between a Soroban contract harness and a reference model.
pub trait DifferentialStateMachine: Sized {
    type Op: Clone + Debug;
    type Model: Clone;
    type ContractHarness;

    /// Contract name for reporting.
    fn name(&self) -> &'static str;

    /// Initialize a fresh reference model and Soroban contract environment.
    fn setup(&self, prng: &mut DeterministicPrng) -> (Self::Model, Self::ContractHarness);

    /// Generate an arbitrary next operation given the current reference state.
    fn generate_op(&self, prng: &mut DeterministicPrng, model: &Self::Model) -> Self::Op;

    /// Apply the operation to the independent reference model.
    fn apply_model(&self, model: &mut Self::Model, op: &Self::Op) -> Result<String, String>;

    /// Apply the operation to the Soroban contract harness.
    fn apply_contract(&self, harness: &mut Self::ContractHarness, op: &Self::Op) -> Result<String, String>;

    /// Check state invariants between reference model and contract state after the transition.
    fn assert_invariants(&self, model: &Self::Model, harness: &Self::ContractHarness, op: &Self::Op) -> Result<(), String>;

    /// Extract current Soroban ledger snapshot.
    fn ledger_state(&self, harness: &Self::ContractHarness) -> LedgerSnapshot;

    /// Format model state for diagnostics.
    fn format_model_state(&self, model: &Self::Model) -> String;

    /// Format contract state for diagnostics.
    fn format_contract_state(&self, harness: &Self::ContractHarness) -> String;
}

/// Executes the differential fuzzing campaign against the provided state machine.
pub fn run_fuzz_campaign<SM: DifferentialStateMachine>(sm: &SM, config: &FuzzConfig, base_seed: u64) {
    let seeds = config.seed_list(base_seed);

    for (run_idx, &seed) in seeds.iter().enumerate() {
        let mut prng = DeterministicPrng::new(seed);
        let (mut model, mut harness) = sm.setup(&mut prng);
        let mut history = TraceHistory::new();
        let mut executed_ops: Vec<SM::Op> = Vec::new();

        for step_idx in 1..=config.steps_per_run {
            let op = sm.generate_op(&mut prng, &model);
            executed_ops.push(op.clone());

            let model_res = sm.apply_model(&mut model, &op);
            let contract_res = sm.apply_contract(&mut harness, &op);
            let ledger = sm.ledger_state(&harness);

            let model_desc = match &model_res {
                Ok(v) => format!("Ok({})", v),
                Err(e) => format!("Err({})", e),
            };
            let contract_desc = match &contract_res {
                Ok(v) => format!("Ok({})", v),
                Err(e) => format!("Err({})", e),
            };

            history.record(TraceStep {
                step_index: step_idx,
                operation_desc: format!("{:?}", op),
                model_result: model_desc.clone(),
                contract_result: contract_desc.clone(),
                ledger_snapshot: ledger.clone(),
                model_state: sm.format_model_state(&model),
                contract_state: sm.format_contract_state(&harness),
            });

            // Check 1: Success / failure parity
            let mut divergence: Option<String> = None;
            match (&model_res, &contract_res) {
                (Ok(m_val), Ok(c_val)) => {
                    if !m_val.is_empty() && !c_val.is_empty() && m_val != c_val {
                        divergence = Some(format!(
                            "Value mismatch: model returned '{}', contract returned '{}'",
                            m_val, c_val
                        ));
                    }
                }
                (Ok(m_val), Err(c_err)) => {
                    divergence = Some(format!(
                        "Transition diverged: reference model succeeded with '{}', but contract failed with '{}'",
                        m_val, c_err
                    ));
                }
                (Err(m_err), Ok(c_val)) => {
                    divergence = Some(format!(
                        "Transition diverged: reference model failed with '{}', but contract succeeded with '{}'",
                        m_err, c_val
                    ));
                }
                (Err(_), Err(_)) => {
                    // Both rejected - operation was invalid in this state
                }
            }

            // Check 2: State invariant assertions
            if divergence.is_none() {
                if let Err(inv_err) = sm.assert_invariants(&model, &harness, &op) {
                    divergence = Some(format!("Invariant violation: {}", inv_err));
                }
            }

            if let Some(reason) = divergence {
                // Shrink the sequence to find the minimal reproducing sequence
                let minimized = minimize_sequence(&executed_ops, |candidate| {
                    let mut fresh_prng = DeterministicPrng::new(seed);
                    let (mut m, mut h) = sm.setup(&mut fresh_prng);
                    for cand_op in candidate {
                        let m_r = sm.apply_model(&mut m, cand_op);
                        let c_r = sm.apply_contract(&mut h, cand_op);
                        match (&m_r, &c_r) {
                            (Ok(mv), Ok(cv)) if !mv.is_empty() && !cv.is_empty() && mv != cv => return true,
                            (Ok(_), Err(_)) => return true,
                            (Err(_), Ok(_)) => return true,
                            _ => {}
                        }
                        if sm.assert_invariants(&m, &h, cand_op).is_err() {
                            return true;
                        }
                    }
                    false
                });

                let report = format_failure_report(
                    sm.name(),
                    seed,
                    step_idx,
                    &op,
                    &reason,
                    &ledger,
                    &sm.format_model_state(&model),
                    &sm.format_contract_state(&harness),
                    &history.steps,
                    &minimized,
                );

                eprintln!("{}", report);
                panic!("Differential fuzzing detected invariant violation in {}", sm.name());
            }
        }

        if config.is_extended && (run_idx + 1) % 50 == 0 {
            println!(
                "[{}] Completed campaign {}/{} runs successfully (seed: {})",
                sm.name(),
                run_idx + 1,
                seeds.len(),
                seed
            );
        }
    }
}
