import { Router, Request, Response } from "express";
import { authenticateToken } from "../../Auth/auth.middleware";
import { requireAdmin } from "../../Gateway/middleware/rbac.middleware";
import { agentMetricsService } from "../agentMetrics.service";
import { AgentType, ExecutionStatus } from "../agentExecutionMetrics.entity";
import { PromptVersion } from "../registry/PromptVersion.entity";
import { durableExecutor } from "../planner/DurableExecutor";
import { durableOperationService } from "../../Reliability/DurableOperationService";
import { OperationStatus } from "../../Reliability/DurableOperation.entity";
import AppDataSource from "../../config/Datasource";

const router = Router();

/**
 * GET /api/admin/reliability/operations
 * Get all durable operations for monitoring
 */
router.get(
  "/reliability/operations",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { status, category, limit, offset } = req.query;
      const [operations, total] = await durableOperationService.getAllOperations({
        status: status as OperationStatus,
        category: category as string,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });

      return res.status(200).json({
        success: true,
        data: operations,
        total,
      });
    } catch (error) {
      console.error("Error fetching durable operations:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch operations",
      });
    }
  }
);

/**
 * POST /api/admin/reliability/operations/:id/replay
 * Manually replay a failed operation
 */
router.post(
  "/reliability/operations/:id/replay",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await durableOperationService.replay(id);
      return res.status(200).json({
        success: true,
        message: `Operation ${id} replayed`,
      });
    } catch (error) {
      console.error("Error replaying operation:", error);
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to replay operation",
      });
    }
  }
);

/**
 * GET /api/admin/agents/executions/active
 * Get active (running/failed/paused) durable executions
 * Requires admin role
 */
router.get(
  "/executions/active",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const executions = await durableExecutor.getActiveExecutions();
      return res.status(200).json({
        success: true,
        data: executions,
      });
    } catch (error) {
      console.error("Error fetching active executions:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch active executions",
      });
    }
  }
);

/**
 * POST /api/admin/agents/executions/:id/retry/:step
 * Manually retry a failed step
 * Requires admin role
 */
router.post(
  "/executions/:id/retry/:step",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { id, step } = req.params;
      await durableExecutor.repairRetryStep(id, parseInt(step, 10));
      return res.status(200).json({
        success: true,
        message: `Retrying step ${step} for execution ${id}`,
      });
    } catch (error) {
      console.error("Error retrying step:", error);
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to retry step",
      });
    }
  }
);

/**
 * POST /api/admin/agents/executions/:id/skip/:step
 * Skip a failed step
 * Requires admin role
 */
router.post(
  "/executions/:id/skip/:step",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { id, step } = req.params;
      const { resultOverride } = req.body;
      await durableExecutor.repairSkipStep(id, parseInt(step, 10), resultOverride);
      return res.status(200).json({
        success: true,
        message: `Skipped step ${step} for execution ${id}`,
      });
    } catch (error) {
      console.error("Error skipping step:", error);
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to skip step",
      });
    }
  }
);

/**
 * POST /api/admin/agents/executions/:id/update/:step
 * Update step payload and retry
 * Requires admin role
 */
router.post(
  "/executions/:id/update/:step",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { id, step } = req.params;
      const { newPayload } = req.body;
      await durableExecutor.repairUpdateAndRetry(id, parseInt(step, 10), newPayload);
      return res.status(200).json({
        success: true,
        message: `Updated and retrying step ${step} for execution ${id}`,
      });
    } catch (error) {
      console.error("Error updating and retrying step:", error);
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to update and retry step",
      });
    }
  }
);

/**
 * POST /api/admin/agents/executions/:id/approve
 * Approve a pending execution or step
 * Requires admin role
 */
router.post(
  "/executions/:id/approve",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const adminId = (req as any).user?.id;
      
      await durableExecutor.resumeExecution(id, adminId);
      
      return res.status(200).json({
        success: true,
        message: `Execution ${id} approved and resumed`,
      });
    } catch (error) {
      console.error("Error approving execution:", error);
      return res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to approve execution",
      });
    }
  }
);

/**
 * GET /api/admin/agents/metrics
 * Get aggregated agent execution metrics
 * Requires admin role
 */
router.get(
  "/metrics",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { agentType, userId, status, startDate, endDate, limit, offset } =
        req.query;

      const metrics = await agentMetricsService.getAggregatedMetrics({
        agentType: agentType as AgentType,
        userId: userId as string,
        status: status as ExecutionStatus,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });

      return res.status(200).json({
        success: true,
        data: metrics,
      });
    } catch (error) {
      console.error("Error fetching agent metrics:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch agent metrics",
      });
    }
  }
);

/**
 * GET /api/admin/agents/metrics/daily
 * Get daily execution counts for charts
 * Requires admin role
 */
router.get(
  "/metrics/daily",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { days } = req.query;
      const daysNum = days ? parseInt(days as string, 10) : 7;

      const dailyCounts =
        await agentMetricsService.getDailyExecutionCounts(daysNum);

      return res.status(200).json({
        success: true,
        data: dailyCounts,
      });
    } catch (error) {
      console.error("Error fetching daily metrics:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch daily metrics",
      });
    }
  }
);

/**
 * GET /api/admin/agents/metrics/time-series
 * Get execution metrics by time period
 * Requires admin role
 */
router.get(
  "/metrics/time-series",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { hours } = req.query;
      const hoursNum = hours ? parseInt(hours as string, 10) : 24;

      const metrics =
        await agentMetricsService.getMetricsByTimePeriod(hoursNum);

      return res.status(200).json({
        success: true,
        data: metrics,
        total: metrics.length,
      });
    } catch (error) {
      console.error("Error fetching time series metrics:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch time series metrics",
      });
    }
  }
);

/**
 * GET /api/admin/agents/prompts
 * Get all prompt versions with performance metrics
 * Requires admin role
 */
router.get(
  "/prompts",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const promptPerformance =
        await agentMetricsService.getPromptPerformanceMetrics();

      return res.status(200).json({
        success: true,
        data: promptPerformance,
      });
    } catch (error) {
      console.error("Error fetching prompt metrics:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch prompt metrics",
      });
    }
  }
);

/**
 * PUT /api/admin/agents/prompts/:promptId
 * Update a prompt version
 * Requires admin role
 */
router.put(
  "/prompts/:promptId",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { promptId } = req.params;
      const { name, content, version, isActive, weight } = req.body;

      const promptRepository = AppDataSource.getRepository(PromptVersion);
      const prompt = await promptRepository.findOne({
        where: { id: promptId as string },
      });

      if (!prompt) {
        return res.status(404).json({
          success: false,
          message: "Prompt not found",
        });
      }

      // Update fields if provided
      if (name !== undefined) prompt.name = name;
      if (content !== undefined) prompt.content = content;
      if (version !== undefined) prompt.version = version;
      if (isActive !== undefined) prompt.isActive = isActive;
      if (weight !== undefined) prompt.weight = weight;

      const updatedPrompt = await promptRepository.save(prompt);

      return res.status(200).json({
        success: true,
        data: updatedPrompt,
        message: "Prompt updated successfully",
      });
    } catch (error) {
      console.error("Error updating prompt:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update prompt",
      });
    }
  }
);

/**
 * POST /api/admin/agents/prompts
 * Create a new prompt version
 * Requires admin role
 */
router.post(
  "/prompts",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { name, type, content, version, isActive, weight } = req.body;

      if (!name || !type || !content || !version) {
        return res.status(400).json({
          success: false,
          message: "name, type, content, and version are required",
        });
      }

      const promptRepository = AppDataSource.getRepository(PromptVersion);
      const prompt = promptRepository.create({
        name,
        type,
        content,
        version,
        isActive: isActive ?? false,
        weight: weight ?? 50,
      });

      const savedPrompt = await promptRepository.save(prompt);

      return res.status(201).json({
        success: true,
        data: savedPrompt,
        message: "Prompt created successfully",
      });
    } catch (error) {
      console.error("Error creating prompt:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to create prompt",
      });
    }
  }
);

/**
 * GET /api/admin/agents/tools
 * Get all agent tools with their status
 * Requires admin role
 */
router.get(
  "/tools",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const tools = await agentMetricsService.getAgentTools();

      return res.status(200).json({
        success: true,
        data: tools,
        total: tools.length,
      });
    } catch (error) {
      console.error("Error fetching agent tools:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch agent tools",
      });
    }
  }
);

/**
 * PUT /api/admin/agents/tools/:toolId/toggle
 * Toggle agent tool active status
 * Requires admin role
 */
router.put(
  "/tools/:toolId/toggle",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { toolId } = req.params;
      const { isActive } = req.body;

      if (typeof isActive !== "boolean") {
        return res.status(400).json({
          success: false,
          message: "isActive boolean is required",
        });
      }

      const tool = await agentMetricsService.toggleTool(
        toolId as string,
        isActive
      );

      if (!tool) {
        return res.status(404).json({
          success: false,
          message: "Tool not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: tool,
        message: `Tool ${isActive ? "enabled" : "disabled"} successfully`,
      });
    } catch (error) {
      console.error("Error toggling tool:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to toggle tool",
      });
    }
  }
);

/**
 * GET /api/admin/agents/performance
 * Get agent performance summary
 * Requires admin role
 */
router.get(
  "/performance",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { hours = 24 } = req.query;
      const hoursNum = parseInt(hours as string, 10);

      const startDate = new Date(Date.now() - hoursNum * 60 * 60 * 1000);

      const metrics = await agentMetricsService.getAggregatedMetrics({
        startDate,
      });

      // Get performance breakdown by agent type
      const agentTypes = Object.values(AgentType);
      const performanceByAgent: Record<
        string,
        {
          count: number;
          successRate: number;
          avgTime: number;
        }
      > = {};

      for (const agentType of agentTypes) {
        const typeMetrics = await agentMetricsService.getAggregatedMetrics({
          agentType,
          startDate,
        });
        performanceByAgent[agentType] = {
          count: typeMetrics.totalExecutions,
          successRate: typeMetrics.successRate,
          avgTime: typeMetrics.averageExecutionTimeMs,
        };
      }

      return res.status(200).json({
        success: true,
        data: {
          summary: {
            totalExecutions: metrics.totalExecutions,
            successRate: metrics.successRate,
            averageExecutionTimeMs: metrics.averageExecutionTimeMs,
            period: `${hoursNum} hours`,
          },
          byAgentType: performanceByAgent,
          byStatus: metrics.executionsByStatus,
        },
      });
    } catch (error) {
      console.error("Error fetching performance:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch performance data",
      });
    }
  }
);

export default router;
