import { AppDataSource } from "../../config/Datasource";
import { PromptVersion, PromptMetric } from "./PromptVersion.entity";
import { promptRolloutService } from "./PromptRolloutService";

export class PromptVersionService {
  private promptRepo = AppDataSource.getRepository(PromptVersion);
  private metricRepo = AppDataSource.getRepository(PromptMetric);

  async selectPrompt(type: string): Promise<PromptVersion | null> {
    const activePrompts = await this.promptRepo.find({
      where: { type, isActive: true },
    });

    if (activePrompts.length === 0) return null;

    // Evaluate rollback for active prompts periodically or on selection
    for (const prompt of activePrompts) {
      const rolledBack = await promptRolloutService.evaluateRollback(prompt.id);
      if (rolledBack) {
        // Refresh active prompts if a rollback occurred
        return this.selectPrompt(type);
      }
    }

    if (activePrompts.length === 1) return activePrompts[0];

    const totalWeight = activePrompts.reduce((sum, p) => sum + p.weight, 0);
    let random = Math.random() * totalWeight;

    for (const prompt of activePrompts) {
      random -= prompt.weight;
      if (random <= 0) return prompt;
    }

    return activePrompts[0];
  }

  async trackMetric(
    promptVersionId: string,
    success: boolean,
    userId?: string,
    responseTime?: number,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.metricRepo.save({
      promptVersionId,
      userId,
      success,
      responseTime,
      metadata,
    });
  }

  async getMetrics(promptVersionId: string) {
    const metrics = await this.metricRepo.find({ where: { promptVersionId } });
    const total = metrics.length;
    const successful = metrics.filter((m) => m.success).length;
    const avgResponseTime =
      metrics.reduce((sum, m) => sum + (m.responseTime || 0), 0) / total || 0;

    return {
      total,
      successful,
      successRate: total > 0 ? successful / total : 0,
      avgResponseTime,
    };
  }
}

export const promptVersionService = new PromptVersionService();
