# Performance Budget Changelog & Governance

This document maintains an immutable, reviewed ledger of all performance budget baseline adjustments across Chen Pilot's critical execution paths.

## Governance Policy

Any modification to thresholds in `tests/performance/config/performanceBaselines.ts` MUST include:

1. **Change Entry** in this changelog.
2. **Commit SHA & Pull Request / Issue Reference**.
3. **Author & Reviewer**.
4. **Target Critical Path & Metric**.
5. **Old Budget vs New Budget**.
6. **Detailed Architectural / Algorithmic Rationale** explaining why the adjustment is justified and how tail latencies (P95/P99) and resource usage were evaluated.
7. **Empirical Benchmark Evidence** before and after the change.

---

## Changelog Entries

### [1.0.0] - 2026-08-30

- **Issue Reference**: #688
- **Author**: `cythecode` (<114140933+cythecode@users.noreply.github.com>)
- **Status**: APPROVED
- **Paths Initialized**:
  - `agentPlanning.simple` (Mean: 25ms, P95: 50ms, P99: 100ms, Max CPU: 30ms, Max Heap Delta: 10MB)
  - `agentPlanning.sorobanIntent` (Mean: 20ms, P95: 40ms, P99: 80ms, Max CPU: 25ms, Max Heap Delta: 10MB)
  - `agentPlanning.complex` (Mean: 40ms, P95: 80ms, P99: 150ms, Max CPU: 50ms, Max Heap Delta: 15MB)
  - `agentPlanning.optimize` (Mean: 10ms, P95: 25ms, P99: 50ms, Max CPU: 15ms, Max Heap Delta: 5MB)
  - `agentPlanning.validate` (Mean: 10ms, P95: 25ms, P99: 50ms, Max CPU: 15ms, Max Heap Delta: 5MB)
  - `agentExecution.singleStep` (Mean: 30ms, P95: 60ms, P99: 100ms, Max CPU: 40ms, Max Heap Delta: 10MB)
  - `agentExecution.multiStep` (Mean: 80ms, P95: 150ms, P99: 250ms, Max CPU: 100ms, Max Heap Delta: 20MB)
  - `simulation.sorobanSimple` (Mean: 30ms, P95: 60ms, P99: 100ms, Max CPU: 40ms, Max Heap Delta: 10MB)
  - `simulation.sorobanComplex` (Mean: 50ms, P95: 100ms, P99: 180ms, Max CPU: 60ms, Max Heap Delta: 15MB)
  - `simulation.simulationEngineRequest` (Mean: 40ms, P95: 80ms, P99: 150ms, Max CPU: 50ms, Max Heap Delta: 12MB)
  - `decoding.primitiveScVal` (Mean: 5ms, P95: 15ms, P99: 30ms, Max CPU: 10ms, Max Heap Delta: 3MB)
  - `decoding.complexNestedScVal` (Mean: 15ms, P95: 35ms, P99: 70ms, Max CPU: 20ms, Max Heap Delta: 8MB)
  - `decoding.simulationReturnValue` (Mean: 10ms, P95: 25ms, P99: 50ms, Max CPU: 15ms, Max Heap Delta: 5MB)
  - `decoding.contractEvent` (Mean: 12ms, P95: 30ms, P99: 60ms, Max CPU: 18ms, Max Heap Delta: 5MB)
  - `transactionConstruction.sorobanUnsignedTx` (Mean: 25ms, P95: 50ms, P99: 90ms, Max CPU: 30ms, Max Heap Delta: 8MB)
  - `transactionConstruction.footprintSignedTx` (Mean: 35ms, P95: 70ms, P99: 120ms, Max CPU: 45ms, Max Heap Delta: 12MB)
  - `transactionConstruction.multiOperationTx` (Mean: 30ms, P95: 60ms, P99: 100ms, Max CPU: 35ms, Max Heap Delta: 10MB)
  - `transactionConstruction.swapEnvelope` (Mean: 40ms, P95: 80ms, P99: 140ms, Max CPU: 50ms, Max Heap Delta: 12MB)
- **Rationale**: Initial establishment of regression budgets for all 4 critical execution paths as mandated by Issue #688. Budgets were set based on empirical microbenchmarking with 20 iterations and 3 warmup runs to prevent cold JIT distortion and enforce tight tail latency bounds.
