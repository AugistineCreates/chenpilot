import { Router, Request, Response } from "express";
import { authenticateToken } from "../../Auth/auth.middleware";
import { requireAdmin } from "../../Gateway/middleware/rbac.middleware";
import { agentMetricsService } from "../agentMetrics.service";
import { AgentType, ExecutionStatus } from "../agentExecutionMetrics.entity";
import { PromptVersion } from "../registry/PromptVersion.entity";
import { promptRolloutService } from "../registry/PromptRolloutService";
import AppDataSource from "../../config/Datasource";

const router = Router();

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
      if (req.body.compatibility !== undefined)
        prompt.compatibility = req.body.compatibility;
      if (req.body.rolloutPolicy !== undefined)
        prompt.rolloutPolicy = req.body.rolloutPolicy;
      if (req.body.rollbackVersionId !== undefined)
        prompt.rollbackVersionId = req.body.rollbackVersionId;

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
 * POST /api/admin/agents/prompts/:promptId/activate
 * Activate a prompt version with safety checks
 * Requires admin role
 */
router.post(
  "/prompts/:promptId/activate",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { promptId } = req.params;
      const { rollbackVersionId } = req.body;

      await promptRolloutService.activateWithPolicy(
        promptId,
        rollbackVersionId
      );

      return res.status(200).json({
        success: true,
        message: "Prompt version activated safely",
      });
    } catch (error) {
      console.error("Error activating prompt rollout:", error);
      return res.status(400).json({
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to activate prompt",
      });
    }
  }
);

/**
 * POST /api/admin/agents/prompts/:promptId/validate
 * Validate prompt compatibility
 * Requires admin role
 */
router.get(
  "/prompts/:promptId/validate",
  authenticateToken,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const { promptId } = req.params;
      const validation =
        await promptRolloutService.validateCompatibility(promptId);

      return res.status(200).json({
        success: true,
        data: validation,
      });
    } catch (error) {
      console.error("Error validating prompt:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to validate prompt",
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
