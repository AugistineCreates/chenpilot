# Performance Regression Testing & Budget Suite

Automated performance benchmarking and regression budget enforcement for critical execution paths across Chen Pilot:

- **Planning Flow**: Intent parsing, Soroban intent extraction, multi-step planning, plan optimization, and plan validation.
- **Simulation Flow**: Soroban RPC simulation, resource/footprint extraction, `SimulationEngine` processing, and gas estimation.
- **Decoding Flow**: Primitive & complex nested ScVal decoding, simulation return value parsing, and contract event normalization.
- **Transaction Construction Flow**: Unsigned Soroban host function transaction building, footprint assembly with cryptographic signing, and multi-operation envelopes.

---

## Acceptance Criteria & Architecture

| Requirement                          | Implementation                                                                     | Location                                           |
| :----------------------------------- | :--------------------------------------------------------------------------------- | :------------------------------------------------- |
| **Fixed Datasets & Isolated Mocks**  | Deterministic frozen fixtures and mocked dependencies (LLM, RPC, DB)               | `tests/performance/fixtures/benchmarkDatasets.ts`  |
| **P95 / P99 & Resource Budgets**     | Strict budgets for P95, P99, mean, max latency, CPU time, and heap allocations     | `tests/performance/config/performanceBaselines.ts` |
| **Statistical Regression Detection** | Z-score statistical significance testing (p < 0.05) against baseline distributions | `tests/performance/utils/PerformanceTestRunner.ts` |
| **Per-Commit Trend Analysis**        | Retains JSON reports per commit SHA and generates trend markdown tables            | `tests/performance/utils/TrendRecorder.ts`         |
| **Budget Governance**                | Strict policy requiring documented rationale for threshold modifications           | `tests/performance/BUDGET_CHANGELOG.md`            |

---

## Directory Structure

```
tests/performance/
├── README.md                           # This documentation
├── BUDGET_CHANGELOG.md                 # Immutable ledger of budget modifications
├── fixtures/
│   └── benchmarkDatasets.ts           # Deterministic datasets for all 4 paths
├── config/
│   └── performanceBaselines.ts        # Regression budgets (latency, CPU, memory)
├── utils/
│   ├── PerformanceTestRunner.ts       # High-resolution runner with statistical engine
│   ├── TrendRecorder.ts               # Per-commit JSON persistence & trend markdown
│   └── BudgetValidator.ts             # Governance verification tool
├── agentPlanning.perf.test.ts         # Planning path benchmarks
├── agentExecution.perf.test.ts        # Execution flow benchmarks
├── simulation.perf.test.ts            # Simulation path benchmarks
├── decoding.perf.test.ts              # Decoding path benchmarks
├── transactionConstruction.perf.test.ts# Transaction construction benchmarks
└── regressionBudgets.perf.test.ts     # Governance & statistical engine tests
```

---

## Critical Path Regression Budgets

All budgets are defined in `config/performanceBaselines.ts`.

### 1. Planning Flow

| Operation                    | Mean  |  P95  |  P99  | Max CPU | Max Heap Delta |
| :--------------------------- | :---: | :---: | :---: | :-----: | :------------: |
| **Simple Plan Creation**     | 25ms  | 50ms  | 100ms |  30ms   |      10MB      |
| **Soroban Intent Parsing**   | 20ms  | 40ms  | 80ms  |  25ms   |      10MB      |
| **Complex Multi-Step Plan**  | 40ms  | 80ms  | 150ms |  50ms   |      15MB      |
| **Plan Optimization**        | 10ms  | 25ms  | 50ms  |  15ms   |      5MB       |
| **Plan Validation**          | 10ms  | 25ms  | 50ms  |  15ms   |      5MB       |
| **Concurrent Planning (x3)** | 100ms | 250ms | 400ms |  150ms  |      25MB      |

### 2. Simulation Flow

| Operation                       | Mean |  P95  |  P99  | Max CPU | Max Heap Delta |
| :------------------------------ | :--: | :---: | :---: | :-----: | :------------: |
| **Soroban Simple Call**         | 30ms | 60ms  | 100ms |  40ms   |      10MB      |
| **Soroban Complex + Footprint** | 50ms | 100ms | 180ms |  60ms   |      15MB      |
| **SimulationEngine Processing** | 40ms | 80ms  | 150ms |  50ms   |      12MB      |
| **Gas Estimation**              | 15ms | 30ms  | 60ms  |  20ms   |      5MB       |

### 3. Decoding Flow

| Operation                        | Mean | P95  | P99  | Max CPU | Max Heap Delta |
| :------------------------------- | :--: | :--: | :--: | :-----: | :------------: |
| **Primitive ScVals Batch**       | 5ms  | 15ms | 30ms |  10ms   |      3MB       |
| **Complex Nested ScVal**         | 15ms | 35ms | 70ms |  20ms   |      8MB       |
| **Simulation Return Value**      | 10ms | 25ms | 50ms |  15ms   |      5MB       |
| **Contract Event Normalization** | 12ms | 30ms | 60ms |  18ms   |      5MB       |

### 4. Transaction Construction Flow

| Operation                     | Mean | P95  |  P99  | Max CPU | Max Heap Delta |
| :---------------------------- | :--: | :--: | :---: | :-----: | :------------: |
| **Soroban Unsigned Tx**       | 25ms | 50ms | 90ms  |  30ms   |      8MB       |
| **Footprint Assembly & Sign** | 35ms | 70ms | 120ms |  45ms   |      12MB      |
| **Multi-Operation Envelope**  | 30ms | 60ms | 100ms |  35ms   |      10MB      |

---

## Running Benchmarks

### Run Full Performance Suite

```bash
npm run test:performance
```

_(Runs Jest under Node with `--expose-gc` and `--runInBand` for precise heap measurements)._

### Run Specific Critical Path Suite

```bash
# Planning
npm test -- tests/performance/agentPlanning.perf.test.ts

# Simulation
npm test -- tests/performance/simulation.perf.test.ts

# Decoding
npm test -- tests/performance/decoding.perf.test.ts

# Transaction Construction
npm test -- tests/performance/transactionConstruction.perf.test.ts
```

### Record Results & Generate Trend Report

```bash
npm run test:performance:record
```

---

## Statistical Regression Detection

The runner evaluates sample distributions against regression budgets using:

- **Percentile Slicing**: P50, P90, P95, P99 calculated over warm sample iterations.
- **CPU Time Tracking**: High-precision user and system CPU deltas (`process.cpuUsage`).
- **Memory Tracking**: Peak heap allocation deltas (`process.memoryUsage`).
- **Z-Score Significance**: Checks whether deviation from budget is statistically significant ($Z > 1.96, p < 0.05$).

---

## Budget Modification Governance

Baseline budget values in `config/performanceBaselines.ts` are strictly governed.

When proposing a budget change:

1. Update `tests/performance/config/performanceBaselines.ts`.
2. Add an entry to `tests/performance/BUDGET_CHANGELOG.md` detailing:
   - Issue / PR reference
   - Author & date
   - Path & metric modified
   - Old vs. new values
   - Technical rationale and before/after benchmark numbers
3. CI automatically runs `regressionBudgets.perf.test.ts` to ensure changelog completeness and consistency.
