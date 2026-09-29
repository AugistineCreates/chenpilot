# Differential Fuzzing Between Soroban Contracts and Reference Models

## Overview

Issue #636 introduces automated state-machine differential fuzzing between high-value Soroban smart contracts and independent pure-Rust reference models.

Traditional example-based tests and basic unit tests often fail to discover edge cases arising from long sequences of dependent operations, subtle accounting divergence across rounding/dust accumulation, or unexpected timing/state-transition edge conditions. By executing arbitrary sequences of state-machine operations in lockstep against both the live contract and a simple, specification-derived reference model, differential fuzzing detects any divergence in state transitions, returned values, accounting, and security invariants.

---

## Architecture

The differential fuzzing framework consists of:

1. **`diff_fuzz_engine` (`contracts/diff_fuzz_engine`)**:
   - **Deterministic PRNG**: A 64-bit SplitMix64/XorShift PRNG ensuring bit-exact reproducible sequences across all operating systems and architectures.
   - **Trace & Ledger State Preservation**: Captures the exact sequence of transitions, inputs, outputs, error messages, and Soroban ledger snapshots (sequence numbers, block timestamps).
   - **Automatic Minimization (Shrinking)**: When an invariant violation or transition divergence is found, an automated delta-debugging minimizer prunes unnecessary operations to return the minimal reproducing sequence.
   - **Diagnostic Error Reporting**: Outputs comprehensive reports including the exact seed, CLI reproduction command (`FUZZ_SEED=<seed> ...`), ledger state, contract state, reference model state, full trace, and minimized trace.
   - **Campaign Modes**: Configurable for bounded runs in CI and extended campaigns in nightly jobs.

2. **State-Machine Fuzzers and Independent Reference Models**:
   - **Vault Contract (`core_vault`)**:
     - *Reference Model*: Tracks pure-Rust balances, backend online/offline flags, emergency pause states, and 48-hour challenge period force-exit records.
     - *Operations*: `SetBackendOnline`, `Pause`, `Unpause`, `Deposit`, `Withdraw`, `RequestForceExit`, `CompleteForceExit`, `AdvanceTime`.
     - *Invariants*: Non-negative balances, solvency (vault token balance matches sum of user deposits), pause enforcement, backend availability constraints, and mutual exclusivity of completed force-exits.
   - **Fee Distribution Contract (`fee_distribution`)**:
     - *Reference Model*: Implements exact independent fee splitting across treasury, AI agent pool, and LP stakers with high-precision cumulative reward indices.
     - *Operations*: `Stake`, `Unstake`, `Distribute`, `Claim`, `UpdateConfig`.
     - *Invariants*: Total staked shares exact match, per-user shares exact match, staker pending rewards match within bounded rounding dust (`MAX_DUST`), solvency (contract holds all staked funds and pending pool residuals), and strict non-overclaiming.
   - **Strategy Registry Contract (`strategy_registry`)**:
     - *Reference Model*: Tracks agent authorizations, pool verification, vote tallies, insertion-order pool registration, and current winning strategy.
     - *Operations*: `SetAiAgent`, `AddVerifiedPool`, `RemoveVerifiedPool`, `VoteStrategy`, `AdvanceLedger`.
     - *Invariants*: Verified pool status parity, winning strategy election exact parity, and strict caller authorization enforcement.
   - **Multi-Hop Swap Contract (`multi_hop_swap`)**:
     - *Reference Model*: Models arbitrary token paths across multiple liquidity pools with dynamic exchange rates and slippage limits.
     - *Operations*: `SetPoolRate`, `FundUser`, `ExecuteSwap`.
     - *Invariants*: Hop-by-hop amount calculation parity, exact slippage enforcement (transaction reverts atomically if any hop violates minimum output), caller net balance parity, and router balance cleanliness (zero stranded/leaked tokens).

---

## Acceptance Criteria Verification

### 1. Reproducible Seeds and Minimization on Failure
Every campaign run begins with a deterministic seed. If a failure occurs:
- The runner reports: `Reproducible Seed: <SEED> (Set FUZZ_SEED=<SEED> to reproduce)`
- The built-in minimizer (`diff_fuzz_engine::minimizer`) shrinks the failing sequence by systematically removing irrelevant transitions.
- The failure output displays both the original operation trace and the minimized reproducing trace.

### 2. Independent Reference Models
Reference models are implemented with standard Rust data structures (`HashMap`, integers, booleans) without importing internal contract storage keys, TTL mechanisms, or Soroban-specific state implementations.

### 3. CI and Nightly Campaign Execution
- **CI (Bounded Fuzzing)**:
  Runs automatically on every push and PR as part of the release gates via `cargo test --manifest-path contracts/Cargo.toml --workspace`.
  Executes bounded campaigns (20-25 iterations of 25 operations per contract) completing in seconds.
- **Nightly (Extended Campaigns)**:
  Configured in `.github/workflows/nightly-fuzz.yml` (runs daily at 02:00 UTC and via manual `workflow_dispatch`).
  Executes hundreds of campaigns with deep operation traces (80-100+ transitions per sequence).

### 4. Preservation of Operation Trace and Ledger State
Failure diagnostics include:
- Soroban ledger sequence number and timestamp at the moment of failure.
- Both contract storage state and reference model state.
- Complete step-by-step history showing the operation, inputs, model outcome, and contract outcome.

---

## Running the Fuzzers Locally

### Bounded Run (CI-Equivalent)
```bash
# Run all contract tests including differential fuzzers
cargo test --manifest-path contracts/Cargo.toml --workspace

# Or run only the differential fuzzers
npm run contracts:fuzz
```

### Extended Campaign
```bash
# Run extended differential fuzzing
FUZZ_MODE=extended cargo test --manifest-path contracts/Cargo.toml --workspace -- test_diff_fuzz --nocapture
```

### Reproducing a Specific Seed
```bash
FUZZ_SEED=1347582910 cargo test --manifest-path contracts/Cargo.toml --workspace -- test_diff_fuzz --nocapture
```
