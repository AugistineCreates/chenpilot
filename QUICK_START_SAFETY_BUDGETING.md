# Quick Start: Temporal Safety & Budgeting

## 5-Minute Overview

### What Problems Do These Solve?

**Temporal Safety:** Prevents invalid plan orderings
```
❌ WRONG: Transfer → Approve (token not approved yet!)
✅ RIGHT: Approve → Transfer (proper order)
```

**Budgeting:** Prevents resource exhaustion
```
❌ WRONG: Unlimited recursive planning → Token costs explode
✅ RIGHT: Limited budget → Child plans get 50% budget → Safe bounds
```

---

## Installation

Already included in Chen Pilot. Import and use:

```typescript
import { TemporalSafetyEngine, PlanStateMachine } from '@agents/planner/temporal';
import { BudgetTracker } from '@agents/planner/budgeting';
```

---

## Temporal Safety: 30-Second Version

```typescript
import { TemporalSafetyEngine } from '@agents/planner/temporal';

const engine = TemporalSafetyEngine.create();
const report = await engine.verify(plan);

if (report.success) {
  console.log('✅ Plan is safe to execute');
} else {
  console.log('❌', report.summary);
  report.repairs.forEach(r => console.log('  →', r.suggestedAction));
}
```

---

## Budgeting: 30-Second Version

```typescript
import { BudgetTracker } from '@agents/planner/budgeting';

const tracker = BudgetTracker.create();
const budget = tracker.createAllocation(planId, userId, 'medium');

// Track as you execute
tracker.recordTokens(budget.id, 100, 50);
tracker.recordToolCall(budget.id);

// Check remaining
const remaining = tracker.getRemaining(budget.id);
console.log(`Remaining: ${remaining.toolCalls} tool calls`);

// Done
tracker.finalizeAllocation(budget.id);
```

---

## Common Patterns

### Pattern 1: Verify Before Execution

```typescript
async function safePlanExecution(plan, userId) {
  // Verify it's safe
  const verification = await engine.verify(plan);
  if (!verification.success) {
    return { error: verification.summary };
  }

  // Execute
  return await executor.executePlan(plan, userId);
}
```

### Pattern 2: Budget-Aware Planning

```typescript
async function planWithBudget(userInput, userId) {
  // Create plan
  const plan = await planner.createPlan({ userId, userInput });

  // Pick appropriate budget
  const budgetType = plan.totalSteps <= 3 ? 'small' : 'medium';
  const budget = tracker.createAllocation(plan.planId, userId, budgetType);

  // Estimate vs budget
  const estimate = tracker.estimateCost(plan.totalSteps, false);
  if (estimate.estimatedTokens > budget.budget.maxTotalTokens) {
    return { error: 'Plan too expensive for allocated budget' };
  }

  // Execute safely
  return await executor.executePlan(plan, userId);
}
```

### Pattern 3: Recursive Planning with Budgets

```typescript
async function recursivePlanning(plan, userId, parentBudgetId) {
  // Child plan gets 50-70% of parent budget
  const childBudget = tracker.createAllocation(
    childPlanId,
    userId,
    'large',
    undefined,
    parentBudgetId  // automatic inheritance
  );

  // Execute child plan
  return await executor.executePlan(childPlan, userId);
}
```

---

## Budget Types at a Glance

| Type | Tokens | Tool Calls | Time | Use Case |
|------|--------|-----------|------|----------|
| small | 2.5K | 3 | 10s | Simple queries |
| medium | 6K | 10 | 30s | Single swaps |
| large | 12K | 30 | 60s | Complex multi-hop |

---

## Standard Temporal Invariants

These are automatically checked:

| Invariant | Means |
|-----------|-------|
| `approval-before-transfer` | Approve token before transferring it |
| `approval-before-swap` | Approve token before swapping it |
| `quote-validity` | Get quote, execute immediately (before expiry) |
| `balance-check-before-transfer` | Check balance before attempting transfer |

---

## When Verification Fails

**Error:** "Plan has circular dependency"
```
Fix: Check step dependencies, remove or rearrange one
```

**Error:** "Transfer step found without preceding approval"
```
Fix: Reorder steps so approval comes first
OR: Add dependency: transfer depends on approve
```

**Error:** "Step 3 is unreachable"
```
Fix: Check step 3's dependencies
  - Are they valid?
  - Do they form a cycle?
  - Can they be reached from the plan start?
```

---

## When Budget Exhausted

**Scenario:** Token limit exceeded mid-execution

```
Action: Return partial result with completed steps
User sees: "Execution stopped: Budget exhausted"
         "Completed 7 of 10 steps"
         "Estimated cost: 5000 tokens"
```

**Scenario:** Tool calls limit reached

```
Action: Queue request, process when slots available
User sees: Request throttled, not lost
```

**Scenario:** Time limit exceeded

```
Action: Abort execution immediately
User sees: "Execution timeout after 60 seconds"
         "Partial results: 5/10 steps completed"
```

---

## Monitoring Checklist

When a plan finishes, look for:

- ✅ Budget allocation ID for tracking
- ✅ Token utilization percentage
- ✅ Tool calls used vs budget
- ✅ Execution time vs limit
- ✅ Any recovery actions taken

Example log:
```
Budget finalized
├─ Allocation: budget_1693569936000_abc123def
├─ Costs: 1250 input tokens, 320 output tokens
├─ Tool calls: 6 / 3 (EXCEEDED)
├─ Time: 8432ms / 10000ms (84%)
└─ Status: Partial result returned
```

---

## Testing Your Integration

```bash
# Run temporal safety tests
npm test -- tests/unit/temporalSafetyLogic.test.ts

# Run budget system tests
npm test -- tests/unit/budgetSystemLogic.test.ts

# Both
npm test -- tests/unit/temporal*.test.ts tests/unit/budget*.test.ts
```

---

## Common Questions

**Q: Do I have to use both systems?**
A: No. Use either independently or together:
- Temporal safety alone: Just `engine.verify(plan)`
- Budgeting alone: Just `tracker.createAllocation(...)`
- Both: Verify first, then execute with budget

**Q: How are child budgets calculated?**
A: Child gets 50% of parent for tokens, 60% for tool calls, 70% for time.

**Q: What if my plan has custom temporal requirements?**
A: Define custom invariants and pass to `PlanStateMachine.create(plan, customInvariants)`

**Q: Can I increase budget limits?**
A: Yes, pass custom budget: `createAllocation(..., { maxToolCalls: 50 })`

**Q: How does it handle retries?**
A: Each retry uses same allocation. Budget exhaustion stops retries gracefully.

---

## Next Steps

1. **For now:** Review `docs/TEMPORAL_SAFETY_BUDGETING.md` for details
2. **For integration:** Talk to platform team about integration points
3. **For customization:** Define domain-specific temporal invariants
4. **For monitoring:** Set up alerts for budget exhaustion

---

## Quick Reference URLs

- Full Guide: `docs/TEMPORAL_SAFETY_BUDGETING.md`
- Implementation: `src/Agents/planner/temporal/`
- Budget Code: `src/Agents/planner/budgeting/`
- Tests: `tests/unit/temporal*.test.ts`, `tests/unit/budget*.test.ts`

---

**Questions?** Check the docs or ask the team that implemented this.

**Found a bug?** Create an issue with test case demonstrating the problem.
