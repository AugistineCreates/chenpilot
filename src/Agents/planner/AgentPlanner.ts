// chenpilot/src/Agents/planner/AgentPlanner.ts
import { agentLLM } from "../agent";
import { toolRegistry } from "../registry/ToolRegistry";
import { WorkflowPlan, WorkflowStep } from "../types";
import { parseSorobanIntent } from "./sorobanIntent";
import { HashedPlan, planHashService } from "./planHash";
import logger from "../../config/logger";
import { RiskLevel } from "../../Auth/userPreferences.entity";

export interface PlannerContext {
  userId: string;
  userInput: string;
  availableBalance?: Record<string, number>;
  constraints?: PlannerConstraints;
  userPreferences?: {
    riskLevel: RiskLevel;
    preferredAssets: string[];
    autoApproveSmallTransactions: boolean;
    smallTransactionThreshold: number;
    defaultSlippage: number | null;
  };
}

export interface PlannerConstraints {
  maxSteps?: number;
  allowedTools?: string[];
  minSlippage?: number;
  maxSlippage?: number;
  timeout?: number;
}

export interface PlanStep extends WorkflowStep {
  stepNumber: number;
  description: string;
  dependencies?: number[];
  estimatedDuration?: number;
  rollbackAction?: WorkflowStep;
  requiresApproval?: boolean;
}

export interface ExecutionPlan {
  planId: string;
  steps: PlanStep[];
  totalSteps: number;
  estimatedDuration: number;
  riskLevel: "low" | "medium" | "high";
  requiresApproval: boolean;
  summary: string;
}

export interface PlanValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class AgentPlanner {
  private readonly MAX_STEPS = 10;
  private readonly HIGH_RISK_THRESHOLD = 5;

  async createPlan(context: PlannerContext): Promise<HashedPlan> {
    logger.info("Creating execution plan", {
      userId: context.userId,
      input: context.userInput,
    });

    try {
      const sorobanPlan = parseSorobanIntent(context.userInput);
      if (sorobanPlan) {
        return this.createHashedPlan(
          this.convertToExecutionPlan(sorobanPlan, context)
        );
      }

      const workflowPlan = await this.analyzeWithLLM(context);
      const executionPlan = this.convertToExecutionPlan(workflowPlan, context);
      const validation = this.validatePlan(executionPlan);

      if (!validation.valid) {
        throw new Error(`Invalid plan: ${validation.errors.join(", ")}`);
      }

      const hashedPlan = this.createHashedPlan(executionPlan);

      logger.info("Execution plan created successfully", {
        planId: hashedPlan.planId,
        totalSteps: hashedPlan.totalSteps,
        riskLevel: hashedPlan.riskLevel,
        planHash: hashedPlan.planHash,
      });

      return hashedPlan;
    } catch (error) {
      logger.error("Failed to create execution plan", {
        error,
        userId: context.userId,
      });
      throw error;
    }
  }

  private async analyzeWithLLM(context: PlannerContext): Promise<WorkflowPlan> {
    const availableTools = toolRegistry.getToolMetadata();
    const prompt = this.buildPlannerPrompt(
      availableTools,
      context.userPreferences
    );
    const response = await agentLLM.callLLM(
      context.userId,
      prompt,
      context.userInput,
      true
    );

    if (
      !(response as Record<string, unknown>)?.workflow ||
      !Array.isArray((response as Record<string, unknown>).workflow)
    ) {
      throw new Error("Invalid LLM response: missing workflow array");
    }

    return response as WorkflowPlan;
  }

  private buildPlannerPrompt(
    availableTools: Array<{ name: string; description: string }>,
    userPreferences?: PlannerContext["userPreferences"]
  ): string {
    const toolDescriptions = availableTools
      .map((tool) => `- ${tool.name}: ${tool.description}`)
      .join("\n");

    const riskWarning = userPreferences
      ? `\n\nIMPORTANT USER CONSTRAINTS:\n- User's risk tolerance: ${userPreferences.riskLevel}\n- Preferred assets: ${userPreferences.preferredAssets.join(", ")}\n- Auto-approve threshold: ${userPreferences.smallTransactionThreshold}\n- Default slippage: ${userPreferences.defaultSlippage ?? "0.5"}%\n\nThe agent MUST respect these constraints. Do not suggest operations that exceed the user's risk tolerance.`
      : "";

    return `You are a DeFi operation planner. Break down the user's request into executable steps.

Available Tools:
${toolDescriptions}${riskWarning}

Output JSON format:
{
  "workflow": [
    { "action": "tool_name", "payload": { "param": "value" } }
  ]
}`;
  }

  private convertToExecutionPlan(
    workflowPlan: WorkflowPlan,
    context: PlannerContext
  ): ExecutionPlan {
    const planId = `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const steps: PlanStep[] = workflowPlan.workflow.map((step, index) => {
      const isHighRisk = this.isHighRiskAction(step);
      return {
        stepNumber: index + 1,
        action: step.action,
        payload: step.payload,
        description: this.generateStepDescription(step),
        estimatedDuration: 3000,
        dependencies: [],
        requiresApproval: isHighRisk,
      };
    });

    const riskLevel = this.assessRiskLevel(steps);

    return {
      planId,
      steps,
      totalSteps: steps.length,
      estimatedDuration: steps.length * 3000,
      riskLevel,
      requiresApproval: riskLevel === "high" || steps.some(s => s.requiresApproval),
      summary: `Plan for "${context.userInput}"`,
    };
  }

  private isHighRiskAction(step: WorkflowStep): boolean {
    const highRiskActions = ["swap", "transfer", "withdraw", "approve"];
    if (highRiskActions.includes(step.action.toLowerCase())) {
      // Check for large amounts if available
      const amount = (step.payload as any)?.amount;
      if (amount && parseFloat(amount) > 1000) return true;
      return true; // Default high risk for these actions for now
    }
    return false;
  }

  private generateStepDescription(step: WorkflowStep): string {
    return `Execute ${step.action}`;
  }

  private assessRiskLevel(steps: PlanStep[]): "low" | "medium" | "high" {
    if (steps.length >= 5) return "high";
    if (steps.length >= 2) return "medium";
    return "low";
  }

  private validatePlan(plan: ExecutionPlan): PlanValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (plan.totalSteps === 0) {
      errors.push("Plan has no steps");
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Create a hashed plan with integrity verification
   */
  private createHashedPlan(plan: ExecutionPlan): HashedPlan {
    // Generate hash for the plan
    const planHash = planHashService.generatePlanHash(plan);

    // Create hashed plan
    const hashedPlan: HashedPlan = {
      ...plan,
      planHash,
    };

    // Optionally sign the plan if private key is available
    // This would be configured via environment variables in production
    const privateKey = process.env.PLAN_SIGNING_KEY;
    if (privateKey) {
      hashedPlan.signature = planHashService.signPlanHash(planHash, privateKey);
      hashedPlan.signedBy = "chenpilot-backend";
      hashedPlan.signedAt = new Date().toISOString();
    }

    return hashedPlan;
  }

  optimizePlan(plan: ExecutionPlan): ExecutionPlan {
    return plan;
  }
}

export const agentPlanner = new AgentPlanner();
