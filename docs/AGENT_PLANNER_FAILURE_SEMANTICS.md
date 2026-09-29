# AgentPlanner and PlanExecutor Failure Semantics

## Current behavior

`AgentPlanner` creates an `ExecutionPlan`; `PlanExecutor` executes its steps in order.
For a non-durable execution, the executor uses the following failure semantics:

1. Steps run sequentially.
2. A step returning a failed tool result stops execution by default. This is the
   default because `stopOnError` is enabled unless explicitly set to `false`.
3. Steps that completed before the failure are retained in `stepResults` and are
   counted in `completedSteps`.
4. The failed step is included in `stepResults` with `status: "failed"` and its
   error information.
5. A plan with no completed steps is reported as `failed`; a plan with at least
   one completed step and a later failure is reported as `partial`.
6. Remaining steps are not executed.

The result therefore provides partial completion reporting, but it does not
provide transactional rollback.

## Rollback, retry, and resume

Rollback is **not implemented**. Successful tools executed before a failure are
not automatically reversed, and `PlanExecutor` does not invoke a step's
optional `rollbackAction`.

The executor also does not automatically retry a failed step or resume a plan
from the failure point. A caller may make a new execution request, but that
request must explicitly determine which steps are safe to run again.

Durable execution returns a running execution record to the caller and persists
progress through the durable executor. It does not change the absence of
compensating rollback actions for already completed external operations.

## User-facing reporting requirements

Callers presenting an execution result should communicate:

- the plan status (`failed` or `partial`),
- the number of completed steps out of the total,
- each successful step before the failure,
- the failed step and its error, and
- that later steps were not attempted.

Because external blockchain and DeFi operations may already be irreversible,
consumers must not describe a partial result as an atomic transaction.

## Follow-up issue

**Follow-up issue: add compensating actions for multi-step plans.** Define and
validate compensation metadata for each reversible step, execute compensating
actions in reverse order after a later step fails, report compensation success
or failure separately, and preserve the current partial-completion information.
This should be implemented only with tool-specific idempotency and explicit
user/product approval for irreversible operations.
