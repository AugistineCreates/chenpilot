//! Diagnostic error formatting that preserves operation trace and ledger state.

use crate::trace::{LedgerSnapshot, TraceStep};
use std::fmt::Debug;

/// Formats a complete failure diagnostic report when differential fuzzing discovers an invariant violation.
pub fn format_failure_report<Op: Debug>(
    contract_name: &str,
    seed: u64,
    step_index: usize,
    failing_op: &Op,
    divergence_reason: &str,
    ledger: &LedgerSnapshot,
    model_state: &str,
    contract_state: &str,
    full_trace: &[TraceStep],
    minimized_ops: &[Op],
) -> String {
    let mut out = String::new();

    out.push_str("\n");
    out.push_str("================================================================================\n");
    out.push_str("               DIFFERENTIAL FUZZING FAILURE DETECTED\n");
    out.push_str("================================================================================\n");
    out.push_str(&format!("Contract:             {}\n", contract_name));
    out.push_str(&format!("Reproducible Seed:    {} (Set FUZZ_SEED={} to reproduce)\n", seed, seed));
    out.push_str(&format!("Failed at Transition: Step {}\n", step_index));
    out.push_str(&format!("Failing Operation:    {:?}\n", failing_op));
    out.push_str("--------------------------------------------------------------------------------\n");
    out.push_str("DIVERGENCE:\n");
    out.push_str(&format!("  {}\n", divergence_reason));
    out.push_str("--------------------------------------------------------------------------------\n");
    out.push_str("LEDGER STATE AT FAILURE:\n");
    out.push_str(&format!("  Sequence Number:    {}\n", ledger.sequence));
    out.push_str(&format!("  Timestamp (Unix):   {}\n", ledger.timestamp));
    out.push_str("--------------------------------------------------------------------------------\n");
    out.push_str("REFERENCE MODEL STATE:\n");
    for line in model_state.lines() {
        out.push_str(&format!("  {}\n", line));
    }
    out.push_str("--------------------------------------------------------------------------------\n");
    out.push_str("SOROBAN CONTRACT STATE:\n");
    for line in contract_state.lines() {
        out.push_str(&format!("  {}\n", line));
    }
    out.push_str("--------------------------------------------------------------------------------\n");
    out.push_str(&format!("ORIGINAL OPERATION TRACE (Length: {}):\n", full_trace.len()));
    for (i, step) in full_trace.iter().enumerate() {
        out.push_str(&format!(
            "  [{:03}] {} => Model: {}, Contract: {}\n",
            i + 1,
            step.operation_desc,
            step.model_result,
            step.contract_result
        ));
    }
    out.push_str("--------------------------------------------------------------------------------\n");
    out.push_str(&format!("MINIMIZED REPRODUCING SEQUENCE (Length: {}):\n", minimized_ops.len()));
    for (i, op) in minimized_ops.iter().enumerate() {
        out.push_str(&format!("  [{:03}] {:?}\n", i + 1, op));
    }
    out.push_str("================================================================================\n");

    out
}
