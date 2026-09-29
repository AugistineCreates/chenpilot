// chenpilot/src/Agents/agents/exectutionagent.ts
import { WorkflowPlan } from "../types";
import { toolRegistry } from "../registry/ToolRegistry";
import { ToolResult } from "../registry/ToolMetadata";
import { memoryStore } from "../memory/memory";
import { responseAgent } from "./responseagent";
import { policyEnforcer } from "../policy/PolicyEnforcer";
import logger from "../../config/logger";
import { withTimeout, TimeoutError } from "../../utils/timeout";
import config from "../../config/config";
import { randomUUID } from "crypto";
import { agentMetricsService } from "../agentMetrics.service";
import { AgentType, ExecutionStatus } from "../agentExecutionMetrics.entity";

export class ExecutionAgent {
  async run(
    plan: WorkflowPlan,
    userId: string,
    input: string,
    traceId?: string | number,
    timeoutMs?: number
  ) {
    const timeout =
      (typeof traceId === "number" ? traceId : timeoutMs) ||
      config.agent.timeouts.agentExecution;
    const actualTraceId = typeof traceId === "string" ? traceId : randomUUID();
    const startTime = Date.now();

    logger.info("Starting agent execution", {
      userId,
      timeout,
      stepCount: plan.workflow.length,
    });

    try {
      return await withTimeout(
        this.executeWorkflow(
          plan,
          userId,
          input,
          startTime,
          timeout,
          actualTraceId
        ),
        {
          timeoutMs: timeout,
          operation: `Agent execution for user ${userId}`,
          onTimeout: () => {
            logger.error("Agent execution timeout", {
              userId,
              timeout,
              elapsed: Date.now() - startTime,
            });
          },
        }
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        logger.error("Agent execution timed out", { userId, timeout });
        return {
          success: false,
          error: `Agent execution timed out after ${timeout}ms`,
        };
      }
      throw error;
    }
  }

  private async executeWorkflow(
    plan: WorkflowPlan,
    userId: string,
    input: string,
    startTime: number,
    totalTimeout: number,
    traceId: string
  ) {
    const results: ToolResult[] = [];

    for (const step of plan.workflow) {
      const elapsed = Date.now() - startTime;
      const remainingTime = totalTimeout - elapsed;

      if (remainingTime <= 0) {
        throw new TimeoutError(
          "Execution timeout reached before completing all steps",
          "workflow_execution",
          totalTimeout
        );
      }

      try {
        logger.info("Executing tool", {
          action: step.action,
          userId,
          remainingTime,
        });

        // Hard policy gate — LLM output is untrusted; every step must pass before execution
        const policy = await policyEnforcer.enforce({
          userId,
          action: step.action,
          payload: step.payload,
        });
        if (!policy.allowed) {
          logger.warn("Policy denied step in workflow", { userId, action: step.action, reason: policy.reason });
          results.push({
            action: step.action,
            status: "error",
            error: `Policy denied: ${policy.reason}`,
            data: { payload: step.payload },
          });
          continue;
        }

        const result = await toolRegistry.executeTool(
          step.action,
          step.payload,
          userId,
          Math.min(remainingTime, config.agent.timeouts.toolExecution)
        );
        logger.info("Tool execution completed", {
          traceId,
          action: step.action,
          status: result.status,
          userId,
        });
        results.push(result);
      } catch (error) {
        logger.error("Tool execution failed", {
          traceId,
          action: step.action,
          error,
          userId,
        });
        const errorResult: ToolResult = {
          action: step.action,
          status: "error",
          error:
            error instanceof Error ? error.message : "Unknown error occurred",
          data: { payload: step.payload },
        };
        results.push(errorResult);
      }
    }

    const summarizedResults = results.map((r) => ({
      action: r.action,
      status: r.status,
      error: r.error ?? null,
      payload: r.data?.payload
        ? JSON.stringify(r.data.payload).slice(0, 80) + "..."
        : undefined,
    }));

    memoryStore.add(userId, `LLM: ${JSON.stringify(summarizedResults)}`);
    const res = (await responseAgent.format(
      results,
      userId,
      input,
      traceId
    )) as { response: string };

    const duration = Date.now() - startTime;

    // Record metrics
    await agentMetricsService.recordExecution({
      agentType: AgentType.EXECUTION,
      userId,
      status: results.every((r) => r.status === "success")
        ? ExecutionStatus.SUCCESS
        : results.some((r) => r.status === "success")
          ? ExecutionStatus.PARTIAL
          : ExecutionStatus.FAILED,
      executionTimeMs: duration,
      stepsCompleted: results.filter((r) => r.status === "success").length,
      totalSteps: plan.workflow.length,
      sessionId: traceId,
      outputMetadata: {
        lastTool:
          results.length > 0 ? results[results.length - 1].action : null,
        toolCount: results.length,
      },
    });

    logger.info("Workflow execution completed", {
      userId,
      hasResponse: !!res?.response,
      duration: duration,
    });
    return { success: true, data: res?.response };
  }
}

export const executionAgent = new ExecutionAgent();
