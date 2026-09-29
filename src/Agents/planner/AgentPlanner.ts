// chenpilot/src/Agents/planner/AgentPlanner.ts
import { agentLLM } from "../agent";
import { toolRegistry } from "../registry/ToolRegistry";
import { WorkflowPlan, WorkflowStep, CompensationType } from "../types";
import { parseSorobanIntent } from "./sorobanIntent";
import { HashedPlan, planHashService } from "./planHash";
import {
  toolAuthorizationService,
  ToolAuthority,
} from "../policy/ToolAuthorizationService";
import { riskEngine, RiskEngine } from "../risk/RiskEngine";
import { TrustLevel, ContextProvenance } from "../context/TrustZone";
import { AgentContextBuilder } from "../context/AgentContextBuilder";
import {
  securityAuditor,
  SecurityEventType,
} from "../../Security/promptIsolation/SecurityAuditor";
import logger from "../../config/logger";
import { RiskLevel } from "../../Auth/userPreferences.entity";

export interface PlannerContext {
  userId: string;
  userInput: string;
  contextTrustLevel?: TrustLevel;
  provenance?: ContextProvenance;
  contextBuilder?: AgentContextBuilder;
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
  /** Whether this step can be rolled back automatically */
  compensationType?: CompensationType;
  /** Action to execute for rollback */
  rollbackActionName?: string;
  /** Payload for the rollback action */
  rollbackPayload?: Record<string, unknown>;
  /** Attenuated capability grant bound to this step */
  capabilityGrant?: import("../capability/types").CapabilityGrant | string;
  /** Optional delegated sub-plan */
  subPlan?: ExecutionPlan;
  /** Designated specialist agent for delegation */
  delegatedAgent?: string;
}

export interface ExecutionPlan {
  planId: string;
  parentPlanId?: string;
  steps: PlanStep[];
  totalSteps: number;
  estimatedDuration: number;
  riskLevel: "low" | "medium" | "high";
  requiresApproval: boolean;
  summary: string;
  /** Attenuated capability grant for the plan */
  capabilityGrant?: import("../capability/types").CapabilityGrant | string;
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
      if (context.userInput === null || context.userInput === undefined) {
        throw new Error("User input is required");
      }

      if (typeof context.userInput === "string" && !context.userInput.trim()) {
        return this.createHashedPlan({
          planId: `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          steps: [],
          totalSteps: 0,
          estimatedDuration: 0,
          riskLevel: "low",
          requiresApproval: false,
          summary: "Plan for empty input",
        });
      }

      const sorobanPlan = parseSorobanIntent(context.userInput);
      if (sorobanPlan) {
        return this.createHashedPlan(
          this.convertToExecutionPlan(sorobanPlan, context)
        );
      }

      // Pre-compute tool authority strictly outside the model response
      const toolAuthority = toolAuthorizationService.computeToolAuthority({
        userId: context.userId,
        contextTrustLevel:
          context.contextTrustLevel ?? TrustLevel.AUTHENTICATED_USER,
        userPreferences: context.userPreferences,
        explicitAllowedTools: context.constraints?.allowedTools,
      });

      const workflowPlan = await this.analyzeWithLLM(context, toolAuthority);

      // Post-model authorization gate: verify all steps against computed tool authority
      const authResult = toolAuthorizationService.authorizePlan(
        workflowPlan,
        toolAuthority
      );
      if (!authResult.authorized) {
        securityAuditor.logSecurityEvent({
          eventType: SecurityEventType.UNAUTHORIZED_TOOL_REJECTED,
          provenance: context.provenance ?? ContextProvenance.USER_INPUT,
          trustLevel:
            context.contextTrustLevel ?? TrustLevel.AUTHENTICATED_USER,
          rawPayload: JSON.stringify(workflowPlan),
          threatCategory: "UNAUTHORIZED_TOOL_SELECTION",
          userId: context.userId,
          action: authResult.unauthorizedSteps.map((s) => s.action).join(", "),
        });
        throw new Error(
          `Plan authorization failed: ${authResult.errors.join(", ")}`
        );
      }

      const executionPlan = this.convertToExecutionPlan(workflowPlan, context);
      const validation = this.validatePlan(executionPlan, context);

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

  private async analyzeWithLLM(
    context: PlannerContext,
    toolAuthority?: ToolAuthority
  ): Promise<WorkflowPlan> {
    const allTools = toolRegistry.getToolMetadata();
    const authorizedTools = toolAuthority
      ? toolAuthorizationService.filterAuthorizedToolMetadata(
          allTools,
          toolAuthority
        )
      : allTools;

    const prompt = this.buildPlannerPrompt(
      authorizedTools,
      context.userPreferences
    );

    let response: unknown;
    if (context.contextBuilder) {
      response = await agentLLM.callLLMWithContext(
        context.userId,
        context.contextBuilder,
        { asJson: true }
      );
    } else {
      response = await agentLLM.callLLM(
        context.userId,
        prompt,
        context.userInput,
        true
      );
    }

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
    const steps: PlanStep[] = (workflowPlan.workflow || []).map(
      (step, index) => {
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
      }
    );

    const riskLevel = this.assessRiskLevel(steps);

    return {
      planId,
      steps,
      totalSteps: steps.length,
      estimatedDuration: steps.length * 3000,
      riskLevel,
      requiresApproval:
        riskLevel === "high" ||
        steps.length > 3 ||
        steps.some((s) => s.requiresApproval),
      summary: `Plan for "${context.userInput}"`,
    };
  }

  private isHighRiskAction(step: WorkflowStep): boolean {
    if (!step || !step.action) return false;
    const action = step.action.toLowerCase();
    const canonical = toolAuthorizationService.normalizeAction(action);

    if (HIGH_RISK_ACTIONS.has(action) || HIGH_RISK_ACTIONS.has(canonical)) {
      const payload = step.payload || {};
      const rawAmount = payload.amount;
      if (typeof rawAmount === "string" && parseFloat(rawAmount) > 1000)
        return true;
      if (typeof rawAmount === "number" && rawAmount > 1000) return true;
      return true; // Default high risk for these actions
    }
    return false;
  }

  private generateStepDescription(step: WorkflowStep): string {
    return `Execute ${step?.action || "unknown"}`;
  }

  private assessRiskLevel(steps: PlanStep[]): "low" | "medium" | "high" {
    if (steps.length === 0) return "low";
    if (steps.length >= 5) return "high";
    if (steps.length === 1 && !this.isHighRiskAction(steps[0])) return "low";

    if (steps.length >= this.HIGH_RISK_THRESHOLD) {
      return "high";
    }

    if (steps.length >= 2) {
      return "medium";
    }

    return "low";
  }

  private validatePlan(
    plan: ExecutionPlan,
    context: PlannerContext
  ): PlanValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (
      plan.totalSteps === 0 &&
      context.userInput &&
      context.userInput.trim().length > 0
    ) {
      errors.push("Plan has no steps");
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Create a hashed plan with integrity verification.
   * The plan signing key is consumed via SecretBuffer for minimal retention.
   */
  private createHashedPlan(plan: ExecutionPlan): HashedPlan {
    // Generate hash for the plan
    const planHash = planHashService.generatePlanHash(plan);

    // Create hashed plan
    const hashedPlan: HashedPlan = {
      ...plan,
      planHash,
    };

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