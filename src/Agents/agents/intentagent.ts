// chenpilot/src/Agents/agents/intentagent.ts
import { validateQuery } from "../validationService";
import { executionAgent } from "./exectutionagent";
import { agentLLM } from "../agent";
import { promptGenerator } from "../registry/PromptGenerator";
import { toolAutoDiscovery } from "../registry/ToolAutoDiscovery";
import { WorkflowPlan, WorkflowStep } from "../types";
import { memoryStore } from "../memory/memory";
import { parseSorobanIntent } from "../planner/sorobanIntent";
import logger from "../../config/logger";
import { randomUUID } from "crypto";
import { userPreferencesService } from "../../Auth/userPreferences.service";
import { RiskLevel } from "../../Auth/userPreferences.entity";
import { experimentService } from "../experiment/experiment.service";
import { ExperimentType } from "../experiment/experiment.entity";

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

    // Fetch user preferences and include in context
    let userPreferences;
    try {
      userPreferences =
        await userPreferencesService.getPreferencesForAgent(userId);
      logger.debug("User preferences loaded", {
        userId,
        riskLevel: userPreferences.riskLevel,
      });
    } catch (error) {
      logger.warn("Failed to load user preferences, using defaults", {
        userId,
        error,
      });
    }

    const workflow = await this.planWorkflow(
      input,
      userId,
      traceId,
      userPreferences
    );
    logger.info("Workflow planned", { traceId, workflow, userId });
    if (!workflow.workflow.length) {
      logger.warn("Empty workflow", { traceId, userId });
      return { success: false, error: "Could not determine workflow" };
    }
    return executionAgent.run(workflow, userId, input, traceId);
  }

  private async planWorkflow(
    input: string,
    userId: string,
    traceId: string,
    userPreferences?: {
      riskLevel: RiskLevel;
      preferredAssets: string[];
      autoApproveSmallTransactions: boolean;
      smallTransactionThreshold: number;
      defaultSlippage: number | null;
    }
  ): Promise<WorkflowPlan> {
    const startTime = Date.now();
    let promptVersionId: string | undefined;
    let experimentId: string | undefined;
    let variantId: string | undefined;

    try {
      const sorobanWorkflow = parseSorobanIntent(input);
      if (sorobanWorkflow) {
        logger.info("Soroban workflow detected", { traceId, userId });
        memoryStore.add(userId, `User: ${input}`);
        return sorobanWorkflow;
      }

      // Check for active experiments
      const activeExperiments = await experimentService.getActiveExperiments(
        ExperimentType.AB_PROMPT
      );
      let selectedPrompt;

      if (activeExperiments.length > 0) {
        const experiment = activeExperiments[0];
        experimentId = experiment.id;
        variantId =
          (await experimentService.selectVariant(experimentId, userId)) ||
          undefined;

        const variant = experiment.variants.find((v) => v.id === variantId);
        if (variant?.promptVersionId) {
          selectedPrompt = await AppDataSource.getRepository(
            PromptVersion
          ).findOne({ where: { id: variant.promptVersionId } });
        }
      }

      const promptVersion =
        selectedPrompt || (await promptGenerator.generateIntentPrompt());
      promptVersionId = (promptVersion as Record<string, unknown>).id as string;

      // Build user preferences context for the prompt
      const userConstraints = userPreferences
        ? `\n\nUSER_CONSTRAINTS:\n- Risk Level: ${userPreferences.riskLevel}\n- Preferred Assets: ${userPreferences.preferredAssets.join(", ")}\n- Auto-approve small transactions (< ${userPreferences.smallTransactionThreshold}): ${userPreferences.autoApproveSmallTransactions ? "enabled" : "disabled"}\n- Default Slippage: ${userPreferences.defaultSlippage ?? "0.5"}%\n\nIMPORTANT: You MUST respect these user constraints when generating the workflow.`
        : "";

      const prompt = (
        typeof promptVersion === "string" ? promptVersion : promptVersion
      )
        .replace("{{USER_INPUT}}", input)
        .replace("{{USER_ID}}", userId)
        .replace("{{USER_CONSTRAINTS}}", userConstraints);

      const parsed = await agentLLM.callLLM(
        userId,
        prompt,
        "",
        true,
        undefined,
        traceId
      );
      const steps: WorkflowStep[] = Array.isArray(
        (parsed as Record<string, unknown>)?.workflow
      )
        ? ((parsed as Record<string, unknown>).workflow as WorkflowStep[])
        : [];

      if (promptVersionId) {
        const { promptVersionService } =
          await import("../registry/PromptVersionService");
        await promptVersionService.trackMetric(
          promptVersionId,
          steps.length > 0,
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
            success: steps.length > 0,
            responseTimeMs: Date.now() - startTime,
            metrics: { stepsCount: steps.length },
          });
        }
      }

      memoryStore.add(userId, `User: ${input}`);
      return { workflow: steps };
    } catch (err) {
      logger.error("LLM workflow parsing failed", {
        traceId,
        error: err,
        userId,
      });
      return { workflow: [] };
    }
  }
}

export const intentAgent = new IntentAgent();
