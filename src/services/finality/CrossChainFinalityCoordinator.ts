import {
  ConfidenceLevel,
  FinalityAssessment,
  FinalityEvidence,
  FinalityStage,
  ReversalRule,
} from "./types";
import { ChainFinalityRegistry, chainFinalityRegistry } from "./ChainFinalityRegistry";

export interface CrossChainStep {
  stepId: string;
  chainId: string;
  description: string;
  dependsOn?: string[]; // IDs of predecessor steps that must satisfy finality requirements
  /**
   * Specified required confidence for this step before dependent steps can proceed.
   * If omitted, defaults to CANONICAL_IRREVERSIBLE.
   */
  requiredConfidenceLevel?: ConfidenceLevel;
  requiredStage?: FinalityStage;
  /** Explicit compensatory action to trigger if this step or its dependencies are reversed */
  compensatoryAction?: string;
  timeoutMs?: number;
}

export interface CrossChainPlan {
  planId: string;
  name: string;
  steps: CrossChainStep[];
  /** Minimum plan-wide safety policy. Steps cannot accept weaker finality than this policy */
  minConfidencePolicy?: ConfidenceLevel;
  maxWaitTimeoutMs?: number;
}

export interface StepExecutionState {
  step: CrossChainStep;
  status: "WAITING_DEPENDENCY" | "IN_PROGRESS" | "PRE_FINAL_WAITING" | "SATISFIED" | "REVERSED" | "TIMED_OUT";
  latestAssessment?: FinalityAssessment;
  previousEvidence?: FinalityEvidence;
  startedAt?: number;
  satisfiedAt?: number;
  reversedAt?: number;
  reversalReason?: string;
  executedCompensatoryActions: string[];
}

export interface PlanExecutionStatus {
  planId: string;
  status: "IN_PROGRESS" | "SATISFIED" | "REVERSED" | "TIMED_OUT";
  stepStates: Record<string, StepExecutionState>;
  reversalDetails?: {
    reversingStepId: string;
    rule: ReversalRule;
    reason: string;
  };
}

/**
 * Coordinates cross-chain plan execution across heterogeneous networks.
 * Ensures dependent steps wait for the STRONGEST required finality state
 * before proceeding, monitors pre-final states for explicit reversal triggers,
 * and handles delayed settlement timeouts.
 */
export class CrossChainFinalityCoordinator {
  private registry: ChainFinalityRegistry;

  constructor(registry: ChainFinalityRegistry = chainFinalityRegistry) {
    this.registry = registry;
  }

  /**
   * Computes the strongest required confidence level for a given step.
   * Resolves the maximum between the step's declared confidence requirement
   * and the plan's minimum confidence policy.
   */
  computeStrongestRequiredConfidence(
    step: CrossChainStep,
    plan: CrossChainPlan
  ): ConfidenceLevel {
    const stepRequirement = step.requiredConfidenceLevel ?? ConfidenceLevel.CANONICAL_IRREVERSIBLE;
    const planPolicy = plan.minConfidencePolicy ?? ConfidenceLevel.NONE;
    return Math.max(stepRequirement, planPolicy);
  }

  /**
   * Initializes state tracking for a new plan execution.
   */
  initializePlanState(plan: CrossChainPlan): PlanExecutionStatus {
    const stepStates: Record<string, StepExecutionState> = {};
    for (const step of plan.steps) {
      stepStates[step.stepId] = {
        step,
        status: (step.dependsOn && step.dependsOn.length > 0) ? "WAITING_DEPENDENCY" : "IN_PROGRESS",
        executedCompensatoryActions: [],
      };
    }
    return {
      planId: plan.planId,
      status: "IN_PROGRESS",
      stepStates,
    };
  }

  /**
   * Updates a step with new observation evidence and evaluates whether
   * the step satisfies the strongest required state or triggers a reversal.
   */
  recordStepEvidence(
    plan: CrossChainPlan,
    planState: PlanExecutionStatus,
    stepId: string,
    rawEvidence: unknown
  ): FinalityAssessment {
    const stepState = planState.stepStates[stepId];
    if (!stepState) {
      throw new Error(`Step ${stepId} not found in plan state`);
    }

    const adapter = this.registry.requireAdapter(stepState.step.chainId);
    const parsedEvidence = adapter.declareEvidence(rawEvidence);
    const assessment = adapter.evaluateFinality(parsedEvidence, stepState.previousEvidence);

    stepState.previousEvidence = parsedEvidence;
    stepState.latestAssessment = assessment;

    // 1. Check for Reversal in pre-final state
    if (assessment.isReversed) {
      stepState.status = "REVERSED";
      stepState.reversedAt = Date.now();
      stepState.reversalReason = assessment.reversalReason;

      planState.status = "REVERSED";
      if (assessment.triggeredReversalRule) {
        planState.reversalDetails = {
          reversingStepId: stepId,
          rule: assessment.triggeredReversalRule,
          reason: assessment.reversalReason || "Pre-final reversal triggered",
        };
      }

      // Execute compensatory actions for this step and preceding pre-final steps
      this.executeRollbackForPlan(planState, stepId, assessment.reversalReason);
      return assessment;
    }

    // 2. Evaluate if strongest required confidence is satisfied
    const requiredConfidence = this.computeStrongestRequiredConfidence(
      stepState.step,
      plan
    );

    if (adapter.isStrongerOrEqualTo(assessment.confidenceLevel, requiredConfidence)) {
      stepState.status = "SATISFIED";
      stepState.satisfiedAt = Date.now();
    } else {
      stepState.status = assessment.isPreFinal ? "PRE_FINAL_WAITING" : "IN_PROGRESS";
    }

    // 3. Update waiting status for dependent steps
    this.refreshDependencyStates(plan, planState);

    return assessment;
  }

  /**
   * Verifies if a dependent step is eligible to execute.
   * A dependent step is eligible IF AND ONLY IF all preceding steps
   * it depends on have met their STRONGEST required finality states.
   */
  isStepEligibleToExecute(
    plan: CrossChainPlan,
    planState: PlanExecutionStatus,
    stepId: string
  ): { eligible: boolean; blockedBy?: string; reason?: string } {
    if (planState.status === "REVERSED") {
      return { eligible: false, reason: "Plan is reversed due to a pre-final trigger." };
    }
    if (planState.status === "TIMED_OUT") {
      return { eligible: false, reason: "Plan timed out waiting for delayed settlement." };
    }

    const stepState = planState.stepStates[stepId];
    if (!stepState) {
      return { eligible: false, reason: `Unknown step ${stepId}` };
    }

    const dependencies = stepState.step.dependsOn || [];
    for (const depId of dependencies) {
      const depState = planState.stepStates[depId];
      if (!depState || depState.status !== "SATISFIED") {
        const requiredConfidence = depState
          ? this.computeStrongestRequiredConfidence(depState.step, plan)
          : ConfidenceLevel.CANONICAL_IRREVERSIBLE;
        return {
          eligible: false,
          blockedBy: depId,
          reason: `Step ${stepId} blocked: prerequisite ${depId} has not reached required confidence level ${ConfidenceLevel[requiredConfidence]} (current: ${depState?.latestAssessment?.confidenceLevel !== undefined ? ConfidenceLevel[depState.latestAssessment.confidenceLevel] : "NONE"})`,
        };
      }
    }

    return { eligible: true };
  }

  /**
   * Refreshes dependent step statuses after an evidence update.
   */
  private refreshDependencyStates(
    plan: CrossChainPlan,
    planState: PlanExecutionStatus
  ): void {
    let allSatisfied = true;

    for (const step of plan.steps) {
      const state = planState.stepStates[step.stepId];
      if (state.status === "WAITING_DEPENDENCY") {
        const check = this.isStepEligibleToExecute(plan, planState, step.stepId);
        if (check.eligible) {
          state.status = "IN_PROGRESS";
          state.startedAt = Date.now();
        }
      }
      if (state.status !== "SATISFIED") {
        allSatisfied = false;
      }
    }

    if (allSatisfied && planState.status === "IN_PROGRESS") {
      planState.status = "SATISFIED";
    }
  }

  /**
   * Handles delayed settlement checks against timeout policies.
   */
  checkDelayedSettlementTimeout(
    plan: CrossChainPlan,
    planState: PlanExecutionStatus,
    stepId: string,
    elapsedMs: number
  ): boolean {
    const stepState = planState.stepStates[stepId];
    if (!stepState) return false;

    const timeout = stepState.step.timeoutMs ?? plan.maxWaitTimeoutMs ?? 300_000;
    if (elapsedMs > timeout && stepState.status !== "SATISFIED") {
      stepState.status = "TIMED_OUT";
      planState.status = "TIMED_OUT";
      this.executeRollbackForPlan(
        planState,
        stepId,
        `Settlement timeout: step ${stepId} exceeded timeout budget of ${timeout}ms (elapsed: ${elapsedMs}ms)`
      );
      return true;
    }
    return false;
  }

  /**
   * Executes compensatory actions for all affected steps when a pre-final
   * state is reversed or times out.
   */
  private executeRollbackForPlan(
    planState: PlanExecutionStatus,
    triggerStepId: string,
    reason?: string
  ): void {
    for (const [stepId, state] of Object.entries(planState.stepStates)) {
      if (state.status === "SATISFIED" || state.status === "PRE_FINAL_WAITING" || stepId === triggerStepId) {
        const action = state.step.compensatoryAction || "default_abort_and_refund";
        if (!state.executedCompensatoryActions.includes(action)) {
          state.executedCompensatoryActions.push(action);
        }
      }
    }
  }
}

export const crossChainFinalityCoordinator = new CrossChainFinalityCoordinator();
