// chenpilot/src/Agents/agents/intentagent.ts
import { validateQuery } from "../validationService";
import { agentPlanner } from "../planner/AgentPlanner";
import { planExecutor } from "../planner/PlanExecutor";
import { toolAutoDiscovery } from "../registry/ToolAutoDiscovery";
import logger from "../../config/logger";
import { randomUUID } from "crypto";
import { userPreferencesService } from "../../Auth/userPreferences.service";
import { RiskLevel } from "../../Auth/userPreferences.entity";
import { experimentService } from "../experiment/experiment.service";
import { ExperimentType } from "../experiment/experiment.entity";
import { parseSorobanIntent } from "../planner/sorobanIntent";
import { memoryStore } from "../memory/memory";
import { AppDataSource } from "../../config/Datasource";
import { PromptVersion } from "../registry/PromptVersion.entity";

export class IntentAgent {
  private initialized = false;

  async handle(input: string, userId: string) {
    const traceId = randomUUID();
    logger.info("Intent agent started", { traceId, userId, input });

    if (!this.initialized) {
      await toolAutoDiscovery.initialize();
      this.initialized = true;
    }

    const isValid = await validateQuery(input, userId);
    if (!isValid) {
      logger.warn("Invalid request format", { traceId, userId });
      return { success: false, error: "Invalid request format" };
    }

    // Fetch user preferences
    let userPreferences;
    try {
      userPreferences =
        await userPreferencesService.getPreferencesForAgent(userId);
    } catch (error) {
      logger.warn("Failed to load user preferences, using defaults", {
        userId,
        error,
      });
    }

    const startTime = Date.now();
    let promptVersionId: string | undefined;
    let experimentId: string | undefined;
    let variantId: string | undefined;

    try {
      const sorobanWorkflow = parseSorobanIntent(input);
      if (sorobanWorkflow) {
        logger.info("Soroban workflow detected", { traceId, userId });
        memoryStore.add(userId, `User: ${input}`);
      }

      // Check for active experiments
      const activeExperiments = await experimentService.getActiveExperiments(
        ExperimentType.AB_PROMPT
      );

      if (activeExperiments.length > 0) {
        const experiment = activeExperiments[0];
        experimentId = experiment.id;
        variantId =
          (await experimentService.selectVariant(experimentId, userId)) ||
          undefined;

        const variant = experiment.variants?.find((v) => v.id === variantId);
        if (variant?.promptVersionId) {
          const selectedPrompt = await AppDataSource.getRepository(
            PromptVersion
          ).findOne({ where: { id: variant.promptVersionId } });
          if (selectedPrompt) {
            promptVersionId = selectedPrompt.id;
          }
        }
      }

      // Use the durable planner and executor
      const plan = await agentPlanner.createPlan({
        userId,
        userInput: input,
        userPreferences: userPreferences
          ? {
              riskLevel: userPreferences.riskLevel as RiskLevel,
              preferredAssets: userPreferences.preferredAssets,
              autoApproveSmallTransactions:
                userPreferences.autoApproveSmallTransactions,
              smallTransactionThreshold:
                userPreferences.smallTransactionThreshold,
              defaultSlippage: userPreferences.defaultSlippage,
            }
          : undefined,
      });

      if (promptVersionId) {
        const { promptVersionService } =
          await import("../registry/PromptVersionService");
        await promptVersionService.trackMetric(
          promptVersionId,
          plan.steps.length > 0,
          userId,
          Date.now() - startTime
        );

        // Record experiment metric if applicable
        if (experimentId && variantId) {
          await experimentService.recordMetric({
            experimentId,
            variantId,
            userId,
            traceId,
            success: plan.steps.length > 0,
            responseTimeMs: Date.now() - startTime,
            metrics: { stepsCount: plan.steps.length },
          });
        }
      }
      logger.info("Plan created", { traceId, planId: plan.planId, userId });

      const result = await planExecutor.executePlan(plan, userId, {
        durable: true,
      });

      return {
        success: true,
        data: {
          message: "Execution started",
          executionId: result.executionId,
          planId: result.planId,
          status: result.status,
        },
      };
    } catch (error) {
      logger.error("Failed to handle intent", { traceId, error, userId });
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to process request",
      };
    }
  }
}

export const intentAgent = new IntentAgent();
