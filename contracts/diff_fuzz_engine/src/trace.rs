//! Operation trace and ledger state preservation for differential fuzzing.

/// Snapshot of the Soroban ledger state at a given transition.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LedgerSnapshot {
    pub sequence: u32,
    pub timestamp: u64,
}

/// A recorded step in a fuzzing sequence.
#[derive(Clone, Debug)]
pub struct TraceStep {
    pub step_index: usize,
    pub operation_desc: String,
    pub model_result: String,
    pub contract_result: String,
    pub ledger_snapshot: LedgerSnapshot,
    pub model_state: String,
    pub contract_state: String,
}

/// History of executed transitions in a test campaign.
#[derive(Clone, Debug, Default)]
pub struct TraceHistory {
    pub steps: Vec<TraceStep>,
}

impl TraceHistory {
    pub fn new() -> Self {
        Self { steps: Vec::new() }
    }

    pub fn record(&mut self, step: TraceStep) {
        self.steps.push(step);
    }

    pub fn is_empty(&self) -> bool {
        self.steps.is_empty()
    }

    pub fn len(&self) -> usize {
        self.steps.len()
    }
}
