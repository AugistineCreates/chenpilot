//! Configuration for differential fuzz campaigns.
//! Supports bounded CI runs and extended nightly campaigns via environment variables.

use std::env;

#[derive(Clone, Debug)]
pub struct FuzzConfig {
    /// Whether running in extended nightly mode or bounded CI mode.
    pub is_extended: bool,
    /// Number of distinct campaign runs (each with a different seed).
    pub runs: usize,
    /// Number of operations/transitions to execute in each campaign run.
    pub steps_per_run: usize,
    /// Specific seed override for reproducing a reported failure.
    pub fixed_seed: Option<u64>,
}

impl Default for FuzzConfig {
    fn default() -> Self {
        Self::from_env()
    }
}

impl FuzzConfig {
    /// Load fuzzing configuration from environment variables.
    ///
    /// - `FUZZ_MODE`: "extended" for nightly runs, defaults to "bounded" for CI.
    /// - `EXTENDED_FUZZ`: "1" or "true" sets extended mode.
    /// - `FUZZ_RUNS`: overrides number of test runs.
    /// - `FUZZ_STEPS`: overrides steps per test run.
    /// - `FUZZ_SEED`: overrides seed for single deterministic reproduction.
    pub fn from_env() -> Self {
        let is_extended = env::var("FUZZ_MODE").map(|v| v.eq_ignore_ascii_case("extended")).unwrap_or(false)
            || env::var("EXTENDED_FUZZ").map(|v| v == "1" || v.eq_ignore_ascii_case("true")).unwrap_or(false);

        let default_runs = if is_extended { 200 } else { 20 };
        let default_steps = if is_extended { 80 } else { 25 };

        let runs = env::var("FUZZ_RUNS")
            .ok()
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(default_runs);

        let steps_per_run = env::var("FUZZ_STEPS")
            .ok()
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(default_steps);

        let fixed_seed = env::var("FUZZ_SEED")
            .ok()
            .and_then(|s| s.parse::<u64>().ok());

        Self {
            is_extended,
            runs,
            steps_per_run,
            fixed_seed,
        }
    }

    /// Helper to get the list of seeds to execute.
    pub fn seed_list(&self, base_seed: u64) -> Vec<u64> {
        if let Some(seed) = self.fixed_seed {
            return vec![seed];
        }
        (0..self.runs).map(|i| base_seed.wrapping_add(i as u64 * 10007 + 1)).collect()
    }
}
