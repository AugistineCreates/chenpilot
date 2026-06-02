import { AppDataSource } from "../../config/Datasource";
import { DurableExecution, ExecutionStatus } from "./DurableExecution.entity";
import { DurableStep, StepStatus } from "./DurableStep.entity";
import { toolRegistry } from "../registry/ToolRegistry";
import { ExecutionPlan, PlanStep } from "./AgentPlanner";
import logger from "../../config/logger";
import { ToolResult } from "../registry/ToolMetadata";
import { getSocketManager, RealtimeEventType } from "../../Gateway/socketManager";

export interface DurableExecutionResult {
  executionId: string;
  status: ExecutionStatus;
  completedSteps: number;
  totalSteps: number;
  error?: string;
}

export class DurableExecutor {
  private executionRepo = AppDataSource.getRepository(DurableExecution);
  private stepRepo = AppDataSource.getRepository(DurableStep);

  /**
   * Starts a new durable execution from a plan
   */
  async startExecution(
    plan: ExecutionPlan,
    userId: string,
    context: Record<string, any> = {}
  ): Promise<DurableExecution> {
    const execution = new DurableExecution();
    execution.planId = plan.planId;
    execution.userId = userId;
    execution.status = ExecutionStatus.PENDING;
    execution.context = context;
    execution.currentStepNumber = 1;
    execution.riskLevel = plan.riskLevel;
    execution.requiresApproval = plan.requiresApproval;

    execution.steps = plan.steps.map((step) => {
      const durableStep = new DurableStep();
      durableStep.stepNumber = step.stepNumber;
      durableStep.action = step.action;
      durableStep.payload = step.payload;
      durableStep.status = StepStatus.PENDING;
      durableStep.maxRetries = 3; // Default
      durableStep.requiresApproval = !!step.requiresApproval; // Map from plan step
      return durableStep;
    });

    const savedExecution = await this.executionRepo.save(execution);
    
    // If the whole plan requires approval, don't start immediately
    if (execution.requiresApproval) {
      execution.status = ExecutionStatus.AWAITING_APPROVAL;
      await this.executionRepo.save(execution);
      this.emitUpdate(RealtimeEventType.AGENT_APPROVAL_REQUIRED, execution);
      logger.info("Durable execution awaiting plan-level approval", { executionId: execution.id });
      return savedExecution;
    }

    // Start execution asynchronously
    this.run(savedExecution.id).catch(err => {
      logger.error("Error in background execution", { executionId: savedExecution.id, error: err });
    });

    return savedExecution;
  }

  /**
   * Resumes a paused or failed execution
   */
  async resumeExecution(executionId: string, approvedBy?: string): Promise<void> {
    const execution = await this.executionRepo.findOne({
      where: { id: executionId },
      relations: ["steps"],
    });

    if (!execution) throw new Error("Execution not found");
    if (execution.status === ExecutionStatus.COMPLETED) return;

    // Handle approval resumption
    if (execution.status === ExecutionStatus.AWAITING_APPROVAL) {
      execution.approvedAt = new Date();
      execution.approvedBy = approvedBy;
      execution.status = ExecutionStatus.RUNNING;
      await this.executionRepo.save(execution);
    }

    // Check if current step needs approval
    const currentStep = execution.steps.find(s => s.stepNumber === execution.currentStepNumber);
    if (currentStep && currentStep.status === StepStatus.AWAITING_APPROVAL) {
      currentStep.approvedAt = new Date();
      currentStep.approvedBy = approvedBy;
      currentStep.status = StepStatus.PENDING;
      await this.stepRepo.save(currentStep);
    }

    execution.status = ExecutionStatus.RUNNING;
    await this.executionRepo.save(execution);

    await this.run(executionId);
  }

  /**
   * Main execution loop
   */
  private async run(executionId: string): Promise<void> {
    const execution = await this.executionRepo.findOne({
      where: { id: executionId },
      relations: ["steps"],
      order: { steps: { stepNumber: "ASC" } }
    });

    if (!execution) return;

    // Check plan-level approval
    if (execution.requiresApproval && !execution.approvedAt) {
      execution.status = ExecutionStatus.AWAITING_APPROVAL;
      await this.executionRepo.save(execution);
      this.emitUpdate(RealtimeEventType.AGENT_APPROVAL_REQUIRED, execution);
      return;
    }

    execution.status = ExecutionStatus.RUNNING;
    await this.executionRepo.save(execution);

    this.emitUpdate(RealtimeEventType.AGENT_EXECUTION_STARTED, execution);

    try {
      for (const step of execution.steps) {
        if (step.status === StepStatus.COMPLETED) continue;

        execution.currentStepNumber = step.stepNumber;
        await this.executionRepo.save(execution);

        // Check step-level approval
        if (step.requiresApproval && !step.approvedAt) {
          step.status = StepStatus.AWAITING_APPROVAL;
          await this.stepRepo.save(step);
          
          execution.status = ExecutionStatus.AWAITING_APPROVAL;
          await this.executionRepo.save(execution);
          
          this.emitUpdate(RealtimeEventType.AGENT_APPROVAL_REQUIRED, execution);
          logger.info("Execution suspended for step approval", { executionId, stepNumber: step.stepNumber });
          return;
        }

        const success = await this.executeStepWithRetries(step, execution.userId);
        
        if (success) {
          this.emitUpdate(RealtimeEventType.AGENT_STEP_COMPLETED, execution, step.result);
        } else {
          execution.status = ExecutionStatus.FAILED;
          execution.errorMessage = `Step ${step.stepNumber} (${step.action}) failed after ${step.retryCount} retries: ${step.error}`;
          await this.executionRepo.save(execution);
          
          this.emitUpdate(RealtimeEventType.AGENT_EXECUTION_FAILED, execution);
          return;
        }
      }

      execution.status = ExecutionStatus.COMPLETED;
      await this.executionRepo.save(execution);
      
      this.emitUpdate(RealtimeEventType.AGENT_EXECUTION_COMPLETED, execution);
      logger.info("Durable execution completed", { executionId: execution.id });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      execution.status = ExecutionStatus.FAILED;
      execution.errorMessage = errorMessage;
      await this.executionRepo.save(execution);
      
      this.emitUpdate(RealtimeEventType.AGENT_EXECUTION_FAILED, execution);
      logger.error("Durable execution failed", { executionId: execution.id, error: errorMessage });
    }
  }

  private emitUpdate(type: RealtimeEventType, execution: DurableExecution, result?: any) {
    try {
      const socketManager = getSocketManager();
      socketManager.getEventEmitter().emitAgentExecutionUpdate(type, {
        executionId: execution.id,
        planId: execution.planId,
        userId: execution.userId,
        status: execution.status,
        currentStep: execution.currentStepNumber,
        totalSteps: execution.steps.length,
        result,
        error: execution.errorMessage,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.warn("Failed to emit socket update", { error });
    }
  }

  private async executeStepWithRetries(
    step: DurableStep,
    userId: string
  ): Promise<boolean> {
    while (step.retryCount < step.maxRetries) {
      step.status = StepStatus.RUNNING;
      step.startedAt = new Date();
      await this.stepRepo.save(step);

      try {
        const result = await toolRegistry.executeTool(
          step.action,
          step.payload,
          userId
        );

        if (result.status === "success") {
          step.status = StepStatus.COMPLETED;
          step.result = result;
          step.completedAt = new Date();
          await this.stepRepo.save(step);
          return true;
        } else {
          throw new Error(result.error || "Tool execution returned failed status");
        }
      } catch (error) {
        step.retryCount++;
        step.error = error instanceof Error ? error.message : "Unknown error";
        step.status = StepStatus.FAILED;
        await this.stepRepo.save(step);
        
        logger.warn(`Step ${step.stepNumber} failed, attempt ${step.retryCount}/${step.maxRetries}`, {
          executionId: step.execution?.id,
          action: step.action,
          error: step.error
        });

        // Exponential backoff could be added here
        if (step.retryCount < step.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, step.retryCount) * 1000));
        }
      }
    }
    return false;
  }

  /**
   * Operator repair: Manual retry of a failed step
   */
  async repairRetryStep(executionId: string, stepNumber: number): Promise<void> {
    const step = await this.stepRepo.findOne({
      where: { execution: { id: executionId }, stepNumber },
      relations: ["execution"]
    });

    if (!step) throw new Error("Step not found");
    
    step.status = StepStatus.PENDING;
    step.retryCount = 0;
    step.error = undefined;
    await this.stepRepo.save(step);

    return this.resumeExecution(executionId);
  }

  /**
   * Operator repair: Skip a failed step
   */
  async repairSkipStep(executionId: string, stepNumber: number, resultOverride?: any): Promise<void> {
    const step = await this.stepRepo.findOne({
      where: { execution: { id: executionId }, stepNumber },
      relations: ["execution"]
    });

    if (!step) throw new Error("Step not found");

    step.status = StepStatus.COMPLETED;
    step.result = resultOverride || { skipped: true, manualIntervention: true };
    step.completedAt = new Date();
    await this.stepRepo.save(step);

    return this.resumeExecution(executionId);
  }

  /**
   * Operator repair: Update step payload and retry
   */
  async repairUpdateAndRetry(executionId: string, stepNumber: number, newPayload: any): Promise<void> {
    const step = await this.stepRepo.findOne({
      where: { execution: { id: executionId }, stepNumber },
      relations: ["execution"]
    });

    if (!step) throw new Error("Step not found");

    step.payload = newPayload;
    step.status = StepStatus.PENDING;
    step.retryCount = 0;
    step.error = undefined;
    await this.stepRepo.save(step);

    return this.resumeExecution(executionId);
  }

  /**
   * Get all active (running/failed/paused) executions for operator visibility
   */
  async getActiveExecutions(): Promise<DurableExecution[]> {
    return this.executionRepo.find({
      where: [
        { status: ExecutionStatus.RUNNING },
        { status: ExecutionStatus.FAILED },
        { status: ExecutionStatus.PAUSED }
      ],
      relations: ["steps"],
      order: { updatedAt: "DESC" }
    });
  }
}

export const durableExecutor = new DurableExecutor();
