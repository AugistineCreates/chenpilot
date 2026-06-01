import { MoreThan } from "typeorm";
import AppDataSource from "../config/Datasource";
import {
  AgentExecutionMetrics,
  AgentType,
  ExecutionStatus,
} from "./agentExecutionMetrics.entity";
import { PromptVersion, PromptMetric } from "./registry/PromptVersion.entity";
import { AgentTool } from "./tools/agent-tool.entity";

export interface MetricsQueryParams {
  agentType?: AgentType;
  userId?: string;
  status?: ExecutionStatus;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface AggregatedMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  partialExecutions: number;
  averageExecutionTimeMs: number;
  totalExecutionTimeMs: number;
  successRate: number;
  averageStepsCompleted: number;
  executionsByAgentType: Record<string, number>;
  executionsByStatus: Record<string, number>;
  toolPerformance: Record<
    string,
    { successRate: number; avgTime: number; count: number }
  >;
  recentExecutions: AgentExecutionMetrics[];
  periodStart: Date;
  periodEnd: Date;
}

export interface PromptPerformanceMetrics {
  promptId: string;
  promptName: string;
  promptType: string;
  version: string;
  totalExecutions: number;
  successRate: number;
  averageResponseTime: number;
  isActive: boolean;
}

class AgentMetricsService {
  private metricsRepository = AppDataSource.getRepository(
    AgentExecutionMetrics
  );
  private promptVersionRepository = AppDataSource.getRepository(PromptVersion);
  private promptMetricRepository = AppDataSource.getRepository(PromptMetric);
  private agentToolRepository = AppDataSource.getRepository(AgentTool);

  /**
   * Record an agent execution metric
   */
  async recordExecution(
    data: Partial<AgentExecutionMetrics>
  ): Promise<AgentExecutionMetrics> {
    const metric = this.metricsRepository.create(data);
    return this.metricsRepository.save(metric);
  }

  /**
   * Get aggregated metrics for admin dashboard
   */
  async getAggregatedMetrics(
    params: MetricsQueryParams = {}
  ): Promise<AggregatedMetrics> {
    const {
      agentType,
      userId,
      status,
      startDate,
      endDate,
      limit = 50,
      offset = 0,
    } = params;

    // Build query builder
    const queryBuilder = this.metricsRepository.createQueryBuilder("metrics");

    if (agentType) {
      queryBuilder.andWhere("metrics.agentType = :agentType", { agentType });
    }
    if (userId) {
      queryBuilder.andWhere("metrics.userId = :userId", { userId });
    }
    if (status) {
      queryBuilder.andWhere("metrics.status = :status", { status });
    }
    if (startDate) {
      queryBuilder.andWhere("metrics.createdAt >= :startDate", {
        startDate,
      });
    }
    if (endDate) {
      queryBuilder.andWhere("metrics.createdAt <= :endDate", { endDate });
    }

    // Get total count
    const totalExecutions = await queryBuilder.getCount();

    // Get counts by status
    const statusCounts = await queryBuilder
      .clone()
      .select("metrics.status", "status")
      .addSelect("COUNT(*)", "count")
      .groupBy("metrics.status")
      .getRawMany();

    const executionsByStatus: Record<string, number> = {};
    let successfulExecutions = 0;
    let failedExecutions = 0;
    let partialExecutions = 0;

    statusCounts.forEach((row) => {
      executionsByStatus[row.status] = parseInt(row.count, 10);
      if (row.status === ExecutionStatus.SUCCESS) {
        successfulExecutions = parseInt(row.count, 10);
      } else if (row.status === ExecutionStatus.FAILED) {
        failedExecutions = parseInt(row.count, 10);
      } else if (row.status === ExecutionStatus.PARTIAL) {
        partialExecutions = parseInt(row.count, 10);
      }
    });

    // Get counts by agent type
    const agentTypeCounts = await queryBuilder
      .clone()
      .select("metrics.agentType", "agentType")
      .addSelect("COUNT(*)", "count")
      .groupBy("metrics.agentType")
      .getRawMany();

    const executionsByAgentType: Record<string, number> = {};
    agentTypeCounts.forEach((row) => {
      executionsByAgentType[row.agentType] = parseInt(row.count, 10);
    });

    // Get average execution time
    const avgTimeResult = await queryBuilder
      .clone()
      .select("AVG(metrics.executionTimeMs)", "avgTime")
      .getRawOne();

    const totalTimeResult = await queryBuilder
      .clone()
      .select("SUM(metrics.executionTimeMs)", "totalTime")
      .getRawOne();

    // Get average steps completed
    const avgStepsResult = await queryBuilder
      .clone()
      .select("AVG(metrics.stepsCompleted)", "avgSteps")
      .getRawOne();

    // Get tool-specific performance
    const toolPerformanceRaw = await queryBuilder
      .clone()
      .select("metrics.outputMetadata->>'lastTool'", "tool")
      .addSelect("COUNT(*)", "count")
      .addSelect("AVG(metrics.executionTimeMs)", "avgTime")
      .addSelect(
        "COUNT(CASE WHEN metrics.status = 'success' THEN 1 END)::float / COUNT(*)",
        "successRate"
      )
      .where("metrics.outputMetadata->>'lastTool' IS NOT NULL")
      .groupBy("tool")
      .getRawMany();

    const toolPerformance: Record<
      string,
      { successRate: number; avgTime: number; count: number }
    > = {};
    toolPerformanceRaw.forEach((row) => {
      toolPerformance[row.tool] = {
        successRate: parseFloat(row.successRate) * 100,
        avgTime: parseFloat(row.avgTime),
        count: parseInt(row.count, 10),
      };
    });

    // Get recent executions
    const recentExecutions = await queryBuilder
      .orderBy("metrics.createdAt", "DESC")
      .skip(offset)
      .take(limit)
      .getMany();

    // Calculate period
    const periodStart = startDate || new Date(Date.now() - 24 * 60 * 60 * 1000);
    const periodEnd = endDate || new Date();

    return {
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      partialExecutions,
      averageExecutionTimeMs: parseFloat(avgTimeResult?.avgTime || "0"),
      totalExecutionTimeMs: parseInt(totalTimeResult?.totalTime || "0", 10),
      successRate:
        totalExecutions > 0
          ? (successfulExecutions / totalExecutions) * 100
          : 0,
      averageStepsCompleted: parseFloat(avgStepsResult?.avgSteps || "0"),
      executionsByAgentType,
      executionsByStatus,
      toolPerformance,
      recentExecutions,
      periodStart,
      periodEnd,
    };
  }

  /**
   * Get performance metrics for each prompt version
   */
  async getPromptPerformanceMetrics(): Promise<PromptPerformanceMetrics[]> {
    const prompts = await this.promptVersionRepository.find();

    const metrics: PromptPerformanceMetrics[] = [];

    for (const prompt of prompts) {
      const promptMetrics = await this.promptMetricRepository
        .createQueryBuilder("pm")
        .where("pm.promptVersionId = :promptId", { promptId: prompt.id })
        .getMany();

      const totalExecutions = promptMetrics.length;
      const successfulExecutions = promptMetrics.filter(
        (m) => m.success
      ).length;
      const responseTimes = promptMetrics
        .filter((m) => m.responseTime)
        .map((m) => m.responseTime!);

      const averageResponseTime =
        responseTimes.length > 0
          ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
          : 0;

      metrics.push({
        promptId: prompt.id,
        promptName: prompt.name,
        promptType: prompt.type,
        version: prompt.version,
        totalExecutions,
        successRate:
          totalExecutions > 0
            ? (successfulExecutions / totalExecutions) * 100
            : 0,
        averageResponseTime,
        isActive: prompt.isActive,
      });
    }

    return metrics;
  }

  /**
   * Get list of all agent tools with their status
   */
  async getAgentTools(): Promise<AgentTool[]> {
    return this.agentToolRepository.find({
      order: { name: "ASC" },
    });
  }

  /**
   * Toggle agent tool active status
   */
  async toggleTool(
    toolId: string,
    isActive: boolean
  ): Promise<AgentTool | null> {
    const tool = await this.agentToolRepository.findOne({
      where: { id: toolId },
    });

    if (!tool) {
      return null;
    }

    tool.isActive = isActive;
    return this.agentToolRepository.save(tool);
  }

  /**
   * Get execution metrics by time period
   */
  async getMetricsByTimePeriod(
    hours: number = 24
  ): Promise<AgentExecutionMetrics[]> {
    const startDate = new Date(Date.now() - hours * 60 * 60 * 1000);

    return this.metricsRepository.find({
      where: {
        createdAt: MoreThan(startDate),
      },
      order: { createdAt: "DESC" },
      take: 1000,
    });
  }

  /**
   * Get daily execution counts for charts
   */
  async getDailyExecutionCounts(
    days: number = 7
  ): Promise<{ date: string; count: number }[]> {
    const results: { date: string; count: string }[] =
      await this.metricsRepository
        .createQueryBuilder("metrics")
        .select("DATE(metrics.createdAt)", "date")
        .addSelect("COUNT(*)", "count")
        .where("metrics.createdAt >= :startDate", {
          startDate: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
        })
        .groupBy("DATE(metrics.createdAt)")
        .orderBy("date", "ASC")
        .getRawMany();

    return results.map((r) => ({
      date: r.date,
      count: parseInt(r.count, 10),
    }));
  }
}

export const agentMetricsService = new AgentMetricsService();
