// chenpilot/src/Agents/planner/PlanExecutor.ts
import { toolRegistry } from "../registry/ToolRegistry";
import { ToolResult } from "../registry/ToolMetadata";
import { ExecutionPlan, PlanStep } from "./AgentPlanner";
import { HashedPlan, planHashService } from "./planHash";
import { durableExecutor } from "./DurableExecutor";
import { ExecutionStatus } from "./DurableExecution.entity";
import logger from "../../config/logger";

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
}

export class PlanExecutor {
  private readonly DEFAULT_TIMEOUT = 60000;

  async executePlan(
    plan: ExecutionPlan,
    userId: string,
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    logger.info("Starting plan execution", {
      planId: plan.planId,
      userId,
      totalSteps: plan.totalSteps,
      dryRun: options.dryRun || false,
      hashVerification: options.verifyHash || false,
      durable: options.durable || true,
    });

    // Verify plan hash before execution if enabled
    if (options.verifyHash !== false) {
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

    // Use durable execution by default unless dryRun is requested
    if (options.durable !== false && !options.dryRun) {
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

        const stepResult = await this.executeStep(step, userId, options);
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

  private async executeStep(
    step: PlanStep,
    userId: string,
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

      const result = await toolRegistry.executeTool(
        step.action,
        step.payload,
        userId
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
      errors.push("Plan hash mismatch! Plan may have been tampered with.");
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
