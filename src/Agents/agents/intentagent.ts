// chenpilot/src/Agents/agents/intentagent.ts
import { validateQuery } from "../validationService";
import { agentPlanner } from "../planner/AgentPlanner";
import { planExecutor } from "../planner/PlanExecutor";
import { toolAutoDiscovery } from "../registry/ToolAutoDiscovery";
import logger from "../../config/logger";
import { randomUUID } from "crypto";
import { userPreferencesService } from "../../Auth/userPreferences.service";

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

    try {
      // Use the new durable planner and executor
      const plan = await agentPlanner.createPlan({
        userId,
        userInput: input,
        userPreferences,
      });

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
        error: error instanceof Error ? error.message : "Failed to process request",
      };
    }
  }
}

export const intentAgent = new IntentAgent();
