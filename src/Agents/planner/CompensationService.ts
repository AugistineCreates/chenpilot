import { AppDataSource } from "../../config/Datasource";
import { DurableExecution, ExecutionStatus } from "./DurableExecution.entity";
import { DurableStep, StepStatus } from "./DurableStep.entity";
import { toolRegistry } from "../registry/ToolRegistry";
import logger from "../../config/logger";
import {
  CompensationType,
  CompensationOutcome,
  CompensationResult,
  CompensationPlan,
  FailureState,
  WorkflowStep,
} from "../types";
import { PlanStep } from "./AgentPlanner";

/**
 * Builds a CompensationPlan from a PlanStep.
 */
export function buildCompensationPlan(step: PlanStep): CompensationPlan {
  const action = step.action.toLowerCase();
  const payload = step.payload;

  // Determine reversibility based on action type
  const irreversibleActions = [
    "send",
    "transfer",
    "approve",
    "submit_transaction",
  ];
  const manualReviewActions = [
    "lend",
    "borrow",
    "repay",
    "withdraw",
    "add_liquidity",
    "remove_liquidity",
  ];

  const isIrreversible = irreversibleActions.some((a) =>
    action.includes(a)
  );
  const requiresManualReview = manualReviewActions.some((a) =>
    action.includes(a)
  );

  if (isIrreversible) {
    return {
      type: CompensationType.IRREVERSIBLE,
      rollbackAction: null,
      rollbackPayload: null,
      description: `Step '${step.action}' is irreversible and cannot be automatically compensated`,
    };
  }

  if (requiresManualReview) {
    return {
      type: CompensationType.REQUIRES_MANUAL_REVIEW,
      rollbackAction: null,
      rollbackPayload: null,
      description: `Step '${step.action}' requires manual review for compensation`,
      maxRetries: 1,
    };
  }

  // Build a reverse action for reversible steps (e.g., swap → reverse swap)
  const { rollbackAction, rollbackPayload, description } =
    buildRollbackAction(action, payload);

  return {
    type: CompensationType.REVERSIBLE,
    rollbackAction,
    rollbackPayload,
    description,
    maxRetries: 3,
  };
}

/**
 * Builds the rollback action and payload for a reversible step.
 */
function buildRollbackAction(
  action: string,
  payload: Record<string, unknown>
): { rollbackAction: string; rollbackPayload: Record<string, unknown>; description: string } {
  const lowerAction = action.toLowerCase();

  const isSwapLike =
    lowerAction.includes("swap") ||
    lowerAction.includes("path_payment") ||
    lowerAction.includes("dex");
  if (isSwapLike) {
    // Reverse the swap: swap back in the opposite direction
    const from = payload.from || payload.sendAsset;
    const to = payload.to || payload.destAsset;
    const amount = payload.amount || payload.sendAmount;
    return {
      rollbackAction: action,
      rollbackPayload: { from: to, to: from, amount },
      description: `Reverse swap: ${String(to)} → ${String(from)} (${String(amount)})`,
    };
  }

  if (lowerAction.includes("add_liquidity")) {
    // Remove the liquidity that was added
    return {
      rollbackAction: "remove_liquidity",
      rollbackPayload: {
        tokenA: payload.tokenA,
        tokenB: payload.tokenB,
        lpAmount: payload.amountA || 0, // Approximate LP amount
      },
      description: `Remove liquidity for ${String(payload.tokenA)}/${String(payload.tokenB)}`,
    };
  }

  // Generic rollback: re-invoke the same action with inverted semantics
  return {
    rollbackAction: action,
    rollbackPayload: { ...payload, _compensation: true },
    description: `Compensate step '${action}'`,
  };
}

/**
 * Service for executing and managing compensation of failed workflow steps.
 * Compensation is idempotent and resumable.
 */
export class CompensationService {
  private executionRepo = AppDataSource.getRepository(DurableExecution);
  private stepRepo = AppDataSource.getRepository(DurableStep);

  /**
   * Attempt to compensate all completed steps in reverse order.
   * Returns the classified FailureState.
   */
  async compensateFailedExecution(
    executionId: string,
    failedStepNumber: number
  ): Promise<FailureState> {
    const execution = await this.executionRepo.findOne({
      where: { id: executionId },
      relations: ["steps"],
    });

    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    // Mark execution as compensating
    execution.status = ExecutionStatus.COMPENSATING;
    await this.executionRepo.save(execution);

    // Get completed steps in reverse order (for rollback)
    const completedSteps = execution.steps
      .filter(
        (s) =>
          s.stepNumber < failedStepNumber &&
          s.status === StepStatus.COMPLETED
      )
      .sort((a, b) => b.stepNumber - a.stepNumber);

    const compensationResults: CompensationResult[] = [];
    let allCompensated = true;
    let anyStranded = false;
    let anyManualReview = false;

    for (const step of completedSteps) {
      const result = await this.compensateStep(execution.userId, step);
      compensationResults.push(result);

      if (result.outcome === CompensationOutcome.COMPENSATED) {
        step.status = StepStatus.COMPENSATED;
        step.compensationOutcome = CompensationOutcome.COMPENSATED;
        await this.stepRepo.save(step);
      } else if (result.outcome === CompensationOutcome.STRANDED) {
        allCompensated = false;
        anyStranded = true;
        step.compensationOutcome = CompensationOutcome.STRANDED;
        step.compensationError = result.error;
        await this.stepRepo.save(step);
      } else if (result.outcome === CompensationOutcome.MANUAL_REVIEW) {
        allCompensated = false;
        anyManualReview = true;
        step.compensationOutcome = CompensationOutcome.MANUAL_REVIEW;
        step.compensationError = result.error;
        await this.stepRepo.save(step);
      }
    }

    // Classify failure state
    let failureState: FailureState;
    if (allCompensated) {
      failureState = FailureState.RECOVERED;
    } else if (anyManualReview) {
      failureState = FailureState.MANUAL_REVIEW;
    } else {
      failureState = FailureState.STRANDED;
    }

    // Update execution with failure classification
    execution.failureState = failureState;
    execution.compensationSummary = {
      totalStepsCompensated: compensationResults.filter(
        (r) => r.outcome === CompensationOutcome.COMPENSATED
      ).length,
      totalStepsStranded: compensationResults.filter(
        (r) => r.outcome === CompensationOutcome.STRANDED
      ).length,
      totalStepsManualReview: compensationResults.filter(
        (r) => r.outcome === CompensationOutcome.MANUAL_REVIEW
      ).length,
      results: compensationResults,
    };

    // Set final status based on failure state
    if (failureState === FailureState.RECOVERED) {
      execution.status = ExecutionStatus.FAILED; // Failed but recovered
    } else {
      execution.status = ExecutionStatus.FAILED;
    }

    await this.executionRepo.save(execution);

    logger.info("Compensation completed", {
      executionId,
      failureState,
      totalResults: compensationResults.length,
    });

    return failureState;
  }

  /**
   * Compensate a single step. Idempotent — safe to retry.
   */
  private async compensateStep(
    userId: string,
    step: DurableStep
  ): Promise<CompensationResult> {
    const plan = this.buildPlanFromStep(step);
    const baseResult: CompensationResult = {
      stepNumber: step.stepNumber,
      outcome: CompensationOutcome.MANUAL_REVIEW,
      compensationPlan: plan,
      retryCount: 0,
      timestamp: new Date().toISOString(),
    };

    // Irreducible steps: cannot be compensated automatically
    if (plan.type === CompensationType.IRREVERSIBLE) {
      return {
        ...baseResult,
        outcome: CompensationOutcome.STRANDED,
        error: plan.description,
      };
    }

    // Manual review steps
    if (plan.type === CompensationType.REQUIRES_MANUAL_REVIEW) {
      return {
        ...baseResult,
        outcome: CompensationOutcome.MANUAL_REVIEW,
        error: plan.description,
      };
    }

    // Reversible steps: attempt the rollback action
    if (!plan.rollbackAction) {
      return {
        ...baseResult,
        outcome: CompensationOutcome.STRANDED,
        error: "No rollback action defined for reversible step",
      };
    }

    const maxRetries = plan.maxRetries ?? 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      step.status = StepStatus.COMPENSATING;
      step.compensationRetryCount = attempt;
      await this.stepRepo.save(step);

      try {
        const result = await toolRegistry.executeTool(
          plan.rollbackAction,
          plan.rollbackPayload ?? {},
          userId
        );

        if (result.status === "success") {
          logger.info("Step compensation succeeded", {
            stepNumber: step.stepNumber,
            action: plan.rollbackAction,
            attempt,
          });
          return {
            ...baseResult,
            outcome: CompensationOutcome.COMPENSATED,
            retryCount: attempt,
            timestamp: new Date().toISOString(),
          };
        }

        // Tool returned error status — treat as compensation failure
        const errorMsg = result.error || "Compensation tool returned error";

        logger.warn("Step compensation attempt failed", {
          stepNumber: step.stepNumber,
          attempt,
          error: errorMsg,
        });

        if (attempt === maxRetries - 1) {
          return {
            ...baseResult,
            outcome: CompensationOutcome.STRANDED,
            error: errorMsg,
            retryCount: attempt,
            timestamp: new Date().toISOString(),
          };
        }

        // Exponential backoff before retry
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt) * 1000)
        );
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Unknown compensation error";

        logger.warn("Step compensation attempt threw", {
          stepNumber: step.stepNumber,
          attempt,
          error: errorMsg,
        });

        if (attempt === maxRetries - 1) {
          return {
            ...baseResult,
            outcome: CompensationOutcome.STRANDED,
            error: errorMsg,
            retryCount: attempt,
            timestamp: new Date().toISOString(),
          };
        }

        // Exponential backoff before retry
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt) * 1000)
        );
      }
    }

    // Should not reach here, but safety fallback
    return {
      ...baseResult,
      outcome: CompensationOutcome.STRANDED,
      error: "Exhausted all compensation retries",
      retryCount: maxRetries,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Build a CompensationPlan from an existing DurableStep (for resume scenarios).
   */
  private buildPlanFromStep(step: DurableStep): CompensationPlan {
    return {
      type: step.compensationType || CompensationType.REVERSIBLE,
      rollbackAction: step.rollbackAction || null,
      rollbackPayload: step.rollbackPayload || null,
      description:
        step.compensationDescription ||
        `Compensate step ${step.stepNumber} (${step.action})`,
      maxRetries: step.maxCompensationRetries,
    };
  }

  /**
   * Resume compensation for an execution that was interrupted.
   * Idempotent — can be called multiple times safely.
   */
  async resumeCompensation(executionId: string): Promise<FailureState> {
    const execution = await this.executionRepo.findOne({
      where: { id: executionId },
      relations: ["steps"],
    });

    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    // Only resume if we're in a compensating state
    if (execution.status !== ExecutionStatus.COMPENSATING) {
      logger.info("Execution is not in compensating state, skipping", {
        executionId,
        status: execution.status,
      });
      return execution.failureState || FailureState.RECOVERED;
    }

    // Find the failed step
    const failedStep = execution.steps.find(
      (s) => s.status === StepStatus.FAILED
    );

    if (!failedStep) {
      // No failed step found — might have completed compensation
      return execution.failureState || FailureState.RECOVERED;
    }

    return this.compensateFailedExecution(executionId, failedStep.stepNumber);
  }

  /**
   * Build compensation plans for all steps in a plan (called at planning time).
   */
  buildCompensationPlans(steps: PlanStep[]): CompensationPlan[] {
    return steps.map((step) => buildCompensationPlan(step));
  }
}

export const compensationService = new CompensationService();
