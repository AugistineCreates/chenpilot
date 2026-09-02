import { toolRegistry } from "../registry/ToolRegistry";
import { ToolResult } from "../registry/ToolMetadata";
import { ExecutionPlan, PlanStep } from "./AgentPlanner";
import { HashedPlan, planHashService } from "./planHash";
import { policyEnforcer } from "../policy/PolicyEnforcer";
import { durableExecutor } from "./DurableExecutor";
import { capabilityManager } from "../capability/CapabilityManager";
import { CapabilityGrant } from "../capability/types";
import logger from "../../config/logger";
import { QuoteExpiredError } from "../../domain/quotes/errors";

export interface ExecutionResult {
  planId: string;
  executionId?: string;
  status: "success" | "partial" | "failed" | "running";
  completedSteps: number;
  totalSteps: number;
  stepResults: StepResult[];
  error?: string;
  duration: number;
}

export interface StepResult {
  stepNumber: number;
  action: string;
  status: "success" | "failed" | "skipped";
  result?: ToolResult;
  subPlanResult?: ExecutionResult;
  error?: string;
  duration: number;
  timestamp: string;
}

export interface ExecutionOptions {
  stopOnError?: boolean;
  dryRun?: boolean;
  timeout?: number;
  onStepComplete?: (result: StepResult) => void;
  onStepStart?: (step: PlanStep) => void;
  verifyHash?: boolean;
  publicKey?: string;
  strictMode?: boolean;
  durable?: boolean;
  /** Capability grant to enforce for this execution */
  capabilityGrant?: CapabilityGrant | string;
  /** Sub-plan ID if this execution is a delegated sub-plan */
  subPlanId?: string;
  /** If true, every tool execution strictly requires a valid capability grant */
  requireGrant?: boolean;
  /** Specialist agent name */
  targetAgent?: string;
}

export class PlanExecutor {
  private readonly DEFAULT_TIMEOUT = 60000;

  async executePlan(
    plan: ExecutionPlan,
    userId: string,
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult> {
    if (!plan || !plan.steps || !Array.isArray(plan.steps)) {
      throw new Error("Invalid plan: steps must be an array");
    }

    const startTime = Date.now();
    const shouldVerifyHash =
      options.verifyHash !== undefined
        ? options.verifyHash
        : (plan as HashedPlan).planHash !== undefined;

    logger.info("Starting plan execution", {
      planId: plan.planId,
      userId,
      totalSteps: plan.totalSteps,
      dryRun: options.dryRun || false,
      hashVerification: shouldVerifyHash,
      durable: options.durable || false,
    });

    // Verify plan hash before execution if enabled or in strict mode
    if (shouldVerifyHash || options.strictMode) {
      const verificationResult = this.verifyPlanIntegrity(
        plan as HashedPlan,
        options
      );
      if (!verificationResult.valid) {
        throw new Error(
          `Plan verification failed: ${verificationResult.errors.join(", ")}`
        );
      }
    }

    // Use durable execution if explicitly requested and not in dryRun mode
    if (options.durable === true && !options.dryRun) {
      const execution = await durableExecutor.startExecution(plan, userId);
      return {
        planId: plan.planId,
        executionId: execution.id,
        status: "running",
        completedSteps: 0,
        totalSteps: plan.totalSteps,
        stepResults: [],
        duration: 0,
      };
    }

    const stepResults: StepResult[] = [];
    let completedSteps = 0;

    try {
      for (const step of plan.steps) {
        const elapsed = Date.now() - startTime;
        const timeout = options.timeout || this.DEFAULT_TIMEOUT;
        if (elapsed > timeout) {
          throw new Error(`Execution timeout after ${elapsed}ms`);
        }

        const stepResult = await this.executeStep(
          step,
          userId,
          plan.planId,
          options
        );
        stepResults.push(stepResult);

        if (stepResult.status === "success") {
          completedSteps++;
        } else if (
          stepResult.status === "failed" &&
          options.stopOnError !== false
        ) {
          break;
        }

        if (options.onStepComplete) {
          options.onStepComplete(stepResult);
        }
      }

      const duration = Date.now() - startTime;
      const status = this.determineExecutionStatus(
        completedSteps,
        plan.totalSteps
      );

      return {
        planId: plan.planId,
        status,
        completedSteps,
        totalSteps: plan.totalSteps,
        stepResults,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      return {
        planId: plan.planId,
        status: "failed",
        completedSteps,
        totalSteps: plan.totalSteps,
        stepResults,
        error: errorMessage,
        duration,
      };
    }
  }

  /**
   * Execute a delegated sub-plan by strictly attenuating the parent capability grant
   */
  async executeSubPlan(
    subPlan: ExecutionPlan,
    parentGrant: CapabilityGrant | string,
    userId: string,
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult> {
    const parent =
      typeof parentGrant === "string"
        ? capabilityManager.deserializeGrant(parentGrant)
        : parentGrant;

    // Attenuate parent grant for the delegated sub-plan
    const subPlanGrant = capabilityManager.attenuateGrant({
      parentGrant: parent,
      subPlanId: subPlan.planId,
      targetAgent: options.targetAgent,
    });

    return await this.executePlan(subPlan, userId, {
      ...options,
      capabilityGrant: subPlanGrant,
      subPlanId: subPlan.planId,
    });
  }

  private async executeStep(
    step: PlanStep,
    userId: string,
    planId: string,
    options: ExecutionOptions
  ): Promise<StepResult> {
    const startTime = Date.now();

    if (options.onStepStart) {
      options.onStepStart(step);
    }

    try {
      if (options.dryRun) {
        return {
          stepNumber: step.stepNumber,
          action: step.action,
          status: "success",
          result: {
            action: step.action,
            status: "success",
            message: "Dry run - not executed",
            data: { dryRun: true },
          },
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      const activeGrant = step.capabilityGrant || options.capabilityGrant;
      const targetAgent = step.delegatedAgent || options.targetAgent;

      // Delegated sub-plan execution path
      if (step.subPlan) {
        logger.info("Executing delegated sub-plan for step", {
          stepNumber: step.stepNumber,
          subPlanId: step.subPlan.planId,
          planId,
          targetAgent,
        });

        let subPlanGrant: CapabilityGrant | undefined;
        if (activeGrant) {
          const parent =
            typeof activeGrant === "string"
              ? capabilityManager.deserializeGrant(activeGrant)
              : activeGrant;

          subPlanGrant = capabilityManager.attenuateGrant({
            parentGrant: parent,
            subPlanId: step.subPlan.planId,
            stepNumber: step.stepNumber,
            targetAgent,
          });
        }

        const subPlanResult = await this.executePlan(step.subPlan, userId, {
          ...options,
          capabilityGrant: subPlanGrant,
          subPlanId: step.subPlan.planId,
          targetAgent,
        });

        return {
          stepNumber: step.stepNumber,
          action: step.action,
          status: subPlanResult.status === "success" ? "success" : "failed",
          subPlanResult,
          error: subPlanResult.error,
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      // Hard policy gate — LLM output is untrusted; every step must pass before execution
      const policy = await policyEnforcer.enforce({
        userId,
        action: step.action,
        payload: step.payload,
        grant: activeGrant,
        planId,
        subPlanId: options.subPlanId,
        stepNumber: step.stepNumber,
        targetAgent,
      });
      if (!policy.allowed) {
        return {
          stepNumber: step.stepNumber,
          action: step.action,
          status: "failed",
          error: `Policy denied: ${policy.reason}`,
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      // Quote commitment deadline gate — fail-closed before tool dispatch
      const stepDeadline = step.payload?.deadline as number | undefined;
      if (stepDeadline && Math.floor(Date.now() / 1000) > stepDeadline) {
        const err = new QuoteExpiredError(stepDeadline);
        logger.warn("Step rejected: quote commitment expired", {
          stepNumber: step.stepNumber,
          action: step.action,
          deadline: new Date(stepDeadline * 1000).toISOString(),
        });
        return {
          stepNumber: step.stepNumber,
          action: step.action,
          status: "failed",
          error: err.message,
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      const result = await toolRegistry.executeTool(
        step.action,
        step.payload,
        userId,
        {
          grant: activeGrant,
          context: {
            planId,
            subPlanId: options.subPlanId,
            stepNumber: step.stepNumber,
            targetAgent,
          },
          requireGrant: options.requireGrant,
        }
      );

      return {
        stepNumber: step.stepNumber,
        action: step.action,
        status: "success",
        result,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.error("Step execution failed", {
        stepNumber: step.stepNumber,
        action: step.action,
        error: errorMessage,
      });

      return {
        stepNumber: step.stepNumber,
        action: step.action,
        status: "failed",
        error: errorMessage,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  private determineExecutionStatus(
    completedSteps: number,
    totalSteps: number
  ): "success" | "partial" | "failed" {
    if (totalSteps === 0) return "failed";
    if (completedSteps === totalSteps) return "success";
    if (completedSteps > 0) return "partial";
    return "failed";
  }

  /**
   * Verify plan integrity before execution
   */
  private verifyPlanIntegrity(
    plan: HashedPlan,
    options: ExecutionOptions
  ): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if plan has hash
    if (!plan.planHash) {
      errors.push("Plan is missing required hash field");
      return { valid: false, errors, warnings };
    }

    // Verify hash matches plan content
    const hashValid = planHashService.verifyPlanHash(plan);
    if (!hashValid) {
      errors.push("Plan hash mismatch: plan hash mismatch detected");
      logger.error("Plan hash verification failed", {
        planId: plan.planId,
        expectedHash: plan.planHash,
        computedHash: planHashService.generatePlanHash(plan),
      });
    }

    // Verify signature if public key provided
    if (options.publicKey && plan.signature) {
      const signatureValid = planHashService.verifySignature(
        plan.planHash,
        plan.signature,
        options.publicKey
      );

      if (!signatureValid) {
        errors.push("Invalid plan signature");
        logger.error("Plan signature verification failed", {
          planId: plan.planId,
          signedBy: plan.signedBy,
        });
      }
    } else if (options.publicKey && !plan.signature) {
      errors.push("Invalid plan signature: plan is missing required signature");
    } else if (plan.signature && !options.publicKey) {
      warnings.push(
        "Plan has signature but no public key provided for verification"
      );
    }

    // Strict mode validations
    if (options.strictMode) {
      if (plan.steps.length === 0) {
        errors.push("Plan has no steps");
      }

      if (plan.steps.some((s) => s.stepNumber <= 0)) {
        errors.push("Step numbers must be positive integers starting from 1");
      }

      const stepNumbers = plan.steps.map((s) => s.stepNumber);
      const duplicates = stepNumbers.filter(
        (num, idx) => stepNumbers.indexOf(num) !== idx
      );
      if (duplicates.length > 0) {
        errors.push(`Duplicate step numbers: ${duplicates.join(", ")}`);
      }
    }

    if (warnings.length > 0) {
      logger.warn("Plan verification warnings", {
        planId: plan.planId,
        warnings,
      });
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  async rollback(
    plan: ExecutionPlan,
    executionResult: ExecutionResult
  ): Promise<void> {
    logger.info("Starting rollback", {
      planId: plan.planId,
      completedSteps: executionResult.completedSteps,
    });
  }
}

export const planExecutor = new PlanExecutor();
