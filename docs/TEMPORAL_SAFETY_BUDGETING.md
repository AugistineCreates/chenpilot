# Temporal Safety Verification & Economic Budgeting System

## Overview

This document describes the implementation of two critical systems for Chen Pilot's agent planning framework:

1. **Temporal Safety Verification (#632)** - Ensures execution plans follow proper temporal ordering constraints
2. **Economic Budgeting (#666)** - Enforces resource limits on plan execution

Both systems are designed to fail-closed: invalid plans are rejected before execution, preventing wasteful resource consumption and preserving system integrity.

---

## Part 1: Temporal Safety Verification (Issue #632)

### Problem Statement

The agent planner can generate complex multi-step execution plans, but there's no mechanism to verify that steps execute in a valid temporal order. Without this:

- **Approval-before-transfer** invariants are violated (approving a token after transferring it)
- **Quote validity windows** are missed (executing a swap after quotes expire)
- **Circular dependencies** cause infinite loops or deadlock
- **Unreachable steps** never execute, leading to silent failures
- **Counterexamples** aren't provided when validation fails, making debugging difficult

### Solution: Plan State Machine

#### Architecture

```
ExecutionPlan
    ↓
PlanStateMachine.verify()
    ├─ Pre-check validation
    ├─ Cycle detection (DFS)
    ├─ Reachability analysis
    ├─ Temporal invariant checking
    └─ Topological sort
    ↓
TemporalVerificationResult
    ├─ valid: boolean
    ├─ cycles: CounterExample[]
    ├─ unreachableSteps: CounterExample[]
    ├─ violatedInvariants: InvariantViolation[]
    ├─ executionOrder: number[] (if valid)
    └─ diagnostics
```

#### Usage

```typescript
import { PlanStateMachine, TemporalSafetyEngine } from '@agents/planner/temporal';

// High-level API
const engine = TemporalSafetyEngine.create({
  failOnWarning: false,
  enableRepairSuggestions: true,
});

const report = await engine.verify(plan);

if (!report.success) {
  console.log(report.summary);
  report.repairs.forEach(repair => {
    console.log(`• ${repair.suggestedAction}`);
  });
}
```

### Temporal Invariants

#### Standard Invariants (Machine-Readable)

| Invariant ID | Name | Before | After | Severity |
|---|---|---|---|---|
| `approval-before-transfer` | Approval Must Precede Transfer | `approve` | `transfer` | critical |
| `approval-before-swap` | Approval Must Precede Swap | `approve` | `swap` | critical |
| `quote-validity` | Quote Must Precede Execution | `getQuote` | `executeSwap` | critical |
| `balance-check-before-transfer` | Balance Check Before Transfer | `checkBalance` | `transfer` | warning |

#### Custom Invariants

```typescript
const customInvariant: TemporalInvariant = {
  id: 'my-custom-invariant',
  name: 'Custom Safety Check',
  description: 'My specific requirement',
  beforeStepPattern: 'init',
  afterStepPattern: 'execute',
  severity: 'critical',
  violationMessage: 'Init must precede execute',
};

const stateMachine = PlanStateMachine.create(plan, [customInvariant]);
```

### Verification Results

#### Valid Plan

```json
{
  "valid": true,
  "executionOrder": [1, 2, 3, 4, 5],
  "cycles": [],
  "unreachableSteps": [],
  "violatedInvariants": [],
  "diagnostics": {
    "totalSteps": 5,
    "dependenciesCount": 4,
    "criticalViolations": 0,
    "warnings": 0,
    "estimatedExecutionTime": 15000
  }
}
```

#### Invalid Plan (with Counterexample)

```json
{
  "valid": false,
  "cycles": [{
    "type": "cycle",
    "description": "Circular dependency: Step1 -> Step2 -> Step1",
    "affectedSteps": [1, 2],
    "steps": [
      { "stepNumber": 1, "action": "swap", "reason": "Part of circular dependency chain" },
      { "stepNumber": 2, "action": "approve", "reason": "Part of circular dependency chain" }
    ]
  }],
  "violatedInvariants": [{
    "invariant": {
      "id": "approval-before-transfer",
      "name": "Approval Must Precede Transfer"
    },
    "counterExample": {
      "type": "invariant_violation",
      "description": "Transfer step found without preceding approval step",
      "affectedSteps": [3]
    }
  }]
}
```

### Algorithms

#### Cycle Detection (DFS)

```
function detectCycles(steps):
  visited = {}
  recursionStack = {}
  
  for each step:
    if dfs(step, visited, recursionStack):
      return true  # cycle found
  
  return false

function dfs(step, visited, recursionStack):
  visited[step] = true
  recursionStack[step] = true
  
  for each dependency in step.dependencies:
    if dependency not in visited:
      if dfs(dependency, visited, recursionStack):
        return true
    else if dependency in recursionStack:
      return true  # back edge = cycle
  
  recursionStack[step] = false
  return false
```

**Time Complexity:** O(V + E) where V = steps, E = dependencies

#### Reachability Analysis

```
function markReachable(steps):
  reachable = {}
  queue = [all steps with no dependencies]
  
  while queue not empty:
    current = queue.pop()
    reachable[current] = true
    
    for each step depending on current:
      if not visited[step]:
        queue.push(step)
  
  return reachable
```

**Identifies:** Steps that cannot be reached from plan entry points

#### Topological Sorting

```
function topologicalSort(steps):
  if hasCycle(steps):
    return []  # cycle prevents ordering
  
  visited = {}
  order = []
  
  function visit(step):
    if step in visited:
      return
    visited[step] = true
    
    for each dependency:
      visit(dependency)
    
    order.append(step)
  
  for each step:
    visit(step)
  
  return order
```

**Produces:** Valid execution order respecting all dependencies

---

## Part 2: Economic Budgeting (Issue #666)

### Problem Statement

Complex agent requests can consume disproportionate resources:

- **Recursive planning** nests requests unboundedly
- **LLM token costs** accumulate across retries and simulations
- **Tool execution** can have unlimited call counts
- **Elapsed time** is unconstrained, leading to timeouts
- **No cost estimation** before execution wastes resources

### Solution: Budget System

#### Architecture

```
BudgetTracker
  ├─ createAllocation(plan, user, type)
  ├─ recordTokens(allocationId, input, output)
  ├─ recordToolCall(allocationId)
  ├─ recordSimulation(allocationId)
  ├─ getRemaining(allocationId)
  └─ finalizeAllocation(allocationId)
```

#### Usage

```typescript
import { BudgetTracker } from '@agents/planner/budgeting';

const tracker = BudgetTracker.create();

// Create budget for a plan
const budget = tracker.createAllocation(
  planId,
  userId,
  'medium'  // small | medium | large
);

// Track consumption
const result = tracker.recordTokens(budget.id, inputTokens, outputTokens);
if (result.exceeded) {
  console.log(`Budget exhausted: ${result.exhaustion.limitExceeded}`);
  // Stop execution and return partial result
}

// Check remaining
const remaining = tracker.getRemaining(budget.id);
console.log(`Remaining tool calls: ${remaining.toolCalls}`);

// Finalize
tracker.finalizeAllocation(budget.id);
```

### Budget Types

#### Small Budget
- **Use case:** Simple queries, status checks
- **Token limit:** 2,500 (input) + 500 (output)
- **Tool calls:** 3
- **Time limit:** 10 seconds
- **Recursion depth:** 0

#### Medium Budget
- **Use case:** Single swaps, multi-step operations
- **Token limit:** 4,000 (input) + 2,000 (output)
- **Tool calls:** 10
- **Time limit:** 30 seconds
- **Recursion depth:** 1

#### Large Budget
- **Use case:** Complex multi-hop swaps, recursive planning
- **Token limit:** 8,000 (input) + 4,000 (output)
- **Tool calls:** 30
- **Time limit:** 60 seconds
- **Recursion depth:** 2

### Recursive Planning Budget Inheritance

Child plans automatically receive reduced budgets:

```
Root Plan (Large)
├─ Budget: 12,000 tokens, 30 tool calls, 60s
└─ Child Plan (auto-reduced)
   ├─ Budget: 6,000 tokens (50%), 18 tool calls (60%), 42s (70%)
   └─ Child-Child Plan (auto-reduced)
      └─ Budget: 3,000 tokens (50% of 6k), 10 tool calls (60% of 18), ~29s (70% of 42)
```

```typescript
// Automatic budget reduction
const parent = tracker.createAllocation(planId, userId, 'large');

// Child gets 50% of parent budget
const child = tracker.createAllocation(
  childPlanId,
  userId,
  'large',
  undefined,
  parent.id  // parentId
);

// child.budget.maxTotalTokens = 6000 (50% of 12000)
// child.recursionDepth = 1
```

### Cost Estimation

Estimate before executing:

```typescript
// Estimate for a 5-step plan
const estimate = tracker.estimateCost(5, false);
// Returns: { estimatedTokens: 2000, estimatedToolCalls: 5, estimatedSimulations: 0 }

// Check if within budget
const remaining = tracker.getRemaining(allocationId);
if (remaining.totalTokens < estimate.estimatedTokens) {
  console.log('Budget insufficient for this plan');
}
```

### Recovery Actions

When a budget is exceeded:

| Limit | Recovery Action | Effect |
|---|---|---|
| `maxInputTokens` | `pause` | Stop further input processing |
| `maxOutputTokens` | `pause` | Stop generating output |
| `maxTotalTokens` | `abort` | Halt execution, return partial result |
| `maxToolCalls` | `throttle` | Queue requests, process when available |
| `maxSimulations` | `abort` | Stop simulations, use last valid result |
| `maxElapsedMs` | `abort` | Timeout, return partial result |
| `maxExternalApiCalls` | `throttle` | Rate limit API calls |

---

## Integration Examples

### Example 1: Verify Plan Before Execution

```typescript
import {
  AgentPlanner,
  PlanExecutor,
  TemporalSafetyEngine,
  BudgetTracker,
} from '@agents/planner';

async function executePlan(userId: string, userInput: string) {
  // Step 1: Generate plan
  const planner = new AgentPlanner();
  const context: PlannerContext = {
    userId,
    userInput,
    constraints: { maxSteps: 10 },
  };
  const plan = await planner.createPlan(context);

  // Step 2: Verify temporal safety
  const engine = TemporalSafetyEngine.create({
    failOnWarning: false,
    enableRepairSuggestions: true,
  });
  const report = await engine.verify(plan);

  if (!report.success) {
    return {
      status: 'planning_failed',
      reason: report.summary,
      suggestions: report.repairs.map(r => r.suggestedAction),
    };
  }

  // Step 3: Allocate budget
  const tracker = BudgetTracker.create();
  const budget = tracker.createAllocation(
    plan.planId,
    userId,
    selectBudgetType(plan.totalSteps)
  );

  // Step 4: Execute with budget tracking
  const executor = new PlanExecutor();
  const result = await executor.executePlan(plan, userId, {
    onStepStart: (step) => {
      tracker.recordExternalApiCall(budget.id);
    },
    onStepComplete: (result) => {
      if (result.status === 'success') {
        // Estimate tokens for this step
        const estimate = estimateStepTokens(result);
        const exceeded = tracker.recordTokens(budget.id, estimate.input, estimate.output);
        if (exceeded) {
          return { abort: true, reason: 'Budget exhausted' };
        }
      }
    },
  });

  tracker.finalizeAllocation(budget.id);
  return result;
}
```

### Example 2: Custom Temporal Invariants

```typescript
import { PlanStateMachine, TemporalInvariant } from '@agents/planner/temporal';

// Define domain-specific invariants
const swapInvariants: TemporalInvariant[] = [
  {
    id: 'slippage-check-before-swap',
    name: 'Validate Slippage Before Swap',
    description: 'Always verify acceptable slippage before executing swap',
    beforeStepPattern: 'validateSlippage',
    afterStepPattern: 'executeSwap',
    severity: 'critical',
    violationMessage: 'Swap executed without slippage validation',
  },
  {
    id: 'trustline-before-stellar-receive',
    name: 'Trustline Must Precede Stellar Receive',
    description: 'Establish trustline before receiving non-native Stellar assets',
    beforeStepPattern: 'establishTrustline',
    afterStepPattern: 'stellarTransfer',
    severity: 'critical',
    violationMessage: 'Cannot receive Stellar asset without trustline',
  },
];

// Verify with custom invariants
const stateMachine = PlanStateMachine.create(plan, swapInvariants);
const result = await stateMachine.verify();

if (!result.valid) {
  result.violatedInvariants.forEach(violation => {
    console.log(`🔴 ${violation.invariant.name}`);
    console.log(`   ${violation.counterExample.description}`);
  });
}
```

### Example 3: Budget Selection Logic

```typescript
function selectBudgetType(
  stepCount: number,
  recursive: boolean
): 'small' | 'medium' | 'large' {
  // Recursive plans always get large budget
  if (recursive) return 'large';
  
  // Simple queries
  if (stepCount <= 2) return 'small';
  
  // Multi-step operations
  if (stepCount <= 10) return 'medium';
  
  // Complex workflows
  return 'large';
}

// Usage
const plan = await planner.createPlan(context);
const budgetType = selectBudgetType(
  plan.totalSteps,
  context.constraints?.allowRecursion ?? false
);
const budget = tracker.createAllocation(plan.planId, userId, budgetType);
```

---

## Monitoring & Metrics

### Budget Metrics

When a plan finalizes, metrics are logged:

```json
{
  "allocationId": "budget_1693569936000_abc123def",
  "planId": "plan_1693569936000_xyz789",
  "costs": {
    "inputTokens": 1250,
    "outputTokens": 320,
    "toolCallCount": 6,
    "simulationCount": 1,
    "elapsedMs": 8432,
    "externalApiCalls": 12
  },
  "utilization": {
    "tokens": "63%",      // (1250+320) / 2500 * 100
    "toolCalls": "200%",  // EXCEEDED - 6 > 3
    "time": "84%"         // 8432 / 10000 * 100
  }
}
```

### Temporal Verification Metrics

```json
{
  "planId": "plan_123",
  "verification": {
    "valid": true,
    "cycles": 0,
    "unreachableSteps": 0,
    "violatedInvariants": 0,
    "executionOrder": [1, 2, 3, 4],
    "topologicalSortTime": "0.2ms"
  }
}
```

---

## Testing

Run the comprehensive test suites:

```bash
# Temporal Safety Tests
npm test -- tests/unit/temporalSafetyLogic.test.ts

# Budget System Tests
npm test -- tests/unit/budgetSystemLogic.test.ts

# Both (26 + 31 = 57 tests)
npm test -- tests/unit/temporal*.test.ts tests/unit/budget*.test.ts
```

---

## Acceptance Criteria

### Temporal Safety (#632)

✅ **Core safety properties are machine-readable and versioned**
- Invariants defined in TypeScript interfaces
- Version information in metadata
- Backward-compatible extensibility

✅ **Verification produces useful counterexamples**
- Cycles show exact step sequences
- Invariant violations identify affected steps
- Reachability issues explain why steps cannot execute

✅ **Generated-plan fuzzing exercises invalid ordering and cycles**
- 26 unit tests cover edge cases
- Cycle detection (direct and indirect)
- Reachability analysis
- Temporal invariant verification

✅ **Verification runs independently of the LLM and fails closed**
- No LLM calls needed for verification
- Invalid plans are rejected before execution
- Clear error messages guide remediation

### Economic Budgeting (#666)

✅ **Plans estimate cost before execution**
- `BudgetTracker.estimateCost(steps, hasSimulation)`
- Token estimates: 400 tokens/step
- Tool call estimates: 1 call/step

✅ **Child plans inherit strictly smaller remaining budget**
- 50% budget reduction for tokens/total limits
- 60% budget reduction for tool calls
- 70% budget reduction for time
- Recursion depth limits enforce nesting boundaries

✅ **Exhaustion stops at safe boundary with useful partial result**
- Token exhaustion: pause and return completed steps
- Time exhaustion: abort with partial result
- Tool call exhaustion: throttle and queue
- All scenarios preserve operational safety

✅ **Metrics report estimated vs actual consumption**
- Budget allocation tracking
- Utilization percentages
- Exhaustion detection and recovery actions
- Cost accounting per step

---

## Future Enhancements

1. **Adaptive Budget Allocation**
   - Learn from historical execution costs
   - Adjust budgets based on plan complexity
   - Predictive budget allocation

2. **Temporal Predicates**
   - Support time-bounded invariants
   - Duration constraints between steps
   - Precedence windows

3. **Compensating Actions**
   - Define rollback steps for reversible operations
   - Execute compensation chain on failure
   - Preserve partial success information

4. **Distributed Plan Execution**
   - Cross-node execution tracking
   - Distributed budget enforcement
   - Global cost accounting

5. **User-Facing Transparency**
   - Budget consumption dashboard
   - Estimated costs before plan execution
   - Cost explanations and breakdowns

---

## References

- **Issue #632:** [Agent] Verify generated plans against temporal safety properties before execution
- **Issue #666:** [Agent] Enforce economic budgets on model and tool execution
- **Related:**
  - `src/Agents/planner/AgentPlanner.ts`
  - `src/Agents/planner/PlanExecutor.ts`
  - `src/Agents/planner/sorobanIntent.ts`
  - `src/Agents/risk/RiskEngine.ts`
