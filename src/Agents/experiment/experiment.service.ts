import AppDataSource from "../../config/Datasource";
import {
  Experiment,
  ExperimentStatus,
  ExperimentMetric,
  ExperimentType,
} from "./experiment.entity";
import { PromptVersion } from "../registry/PromptVersion.entity";

export class ExperimentService {
  private experimentRepo = AppDataSource.getRepository(Experiment);
  private metricRepo = AppDataSource.getRepository(ExperimentMetric);
  private promptRepo = AppDataSource.getRepository(PromptVersion);

  async createExperiment(data: Partial<Experiment>): Promise<Experiment> {
    const experiment = this.experimentRepo.create(data);
    return await this.experimentRepo.save(experiment);
  }

  async getActiveExperiments(type?: ExperimentType): Promise<Experiment[]> {
    const where: { status: ExperimentStatus; type?: ExperimentType } = {
      status: ExperimentStatus.ACTIVE,
    };
    if (type) where.type = type;
    return await this.experimentRepo.find({ where });
  }

  /**
   * Select a variant for a user based on active experiments
   */
  async selectVariant(
    experimentId: string,
    userId: string
  ): Promise<string | null> {
    const experiment = await this.experimentRepo.findOne({
      where: { id: experimentId, status: ExperimentStatus.ACTIVE },
    });
    if (!experiment) return null;

    // Simple hash-based assignment for stickiness
    const hash = this.hashCode(userId + experimentId);
    const bucket = Math.abs(hash % 100);

    let cumulativeWeight = 0;
    for (const variant of experiment.variants) {
      cumulativeWeight += variant.weight;
      if (bucket < cumulativeWeight) {
        return variant.id;
      }
    }

    return experiment.variants[0].id;
  }

  async recordMetric(data: Partial<ExperimentMetric>): Promise<void> {
    const metric = this.metricRepo.create(data);
    await this.metricRepo.save(metric);
  }

  async getExperimentResults(experimentId: string) {
    const experiment = await this.experimentRepo.findOne({
      where: { id: experimentId },
    });
    if (!experiment) throw new Error("Experiment not found");

    const metrics = await this.metricRepo.find({ where: { experimentId } });

    const results = experiment.variants.map((variant) => {
      const variantMetrics = metrics.filter((m) => m.variantId === variant.id);
      const total = variantMetrics.length;
      const successful = variantMetrics.filter((m) => m.success).length;
      const avgResponseTime =
        total > 0
          ? variantMetrics.reduce(
              (sum, m) => sum + (m.responseTimeMs || 0),
              0
            ) / total
          : 0;

      return {
        variantId: variant.id,
        variantName: variant.name,
        total,
        successRate: total > 0 ? (successful / total) * 100 : 0,
        avgResponseTime,
      };
    });

    return {
      experimentId,
      name: experiment.name,
      status: experiment.status,
      results,
    };
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32bit integer
    }
    return hash;
  }
}

export const experimentService = new ExperimentService();
