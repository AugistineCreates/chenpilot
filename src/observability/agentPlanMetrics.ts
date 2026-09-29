import logger from "../config/logger";

export interface LLMTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  provider: string;
  model: string;
}

export interface AgentPlanCostMetric extends LLMTokenUsage {
  correlationId: string;
  estimatedCostUsd: number;
  anomalous: boolean;
  recordedAt: string;
}

const DEFAULT_INPUT_COST_PER_MILLION = 0.8;
const DEFAULT_OUTPUT_COST_PER_MILLION = 4;
const DEFAULT_ANOMALY_MULTIPLIER = 3;

const metrics = new Map<string, AgentPlanCostMetric>();

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function calculateCost(usage: LLMTokenUsage): number {
  const inputRate = envNumber(
    "AGENT_LLM_INPUT_COST_PER_MILLION_USD",
    DEFAULT_INPUT_COST_PER_MILLION
  );
  const outputRate = envNumber(
    "AGENT_LLM_OUTPUT_COST_PER_MILLION_USD",
    DEFAULT_OUTPUT_COST_PER_MILLION
  );

  return (
    (usage.inputTokens / 1_000_000) * inputRate +
    (usage.outputTokens / 1_000_000) * outputRate
  );
}

export function recordLLMUsage(
  correlationId: string,
  usage: LLMTokenUsage
): AgentPlanCostMetric {
  const existing = metrics.get(correlationId);
  const combined: LLMTokenUsage = existing
    ? {
        inputTokens: existing.inputTokens + usage.inputTokens,
        outputTokens: existing.outputTokens + usage.outputTokens,
        totalTokens: existing.totalTokens + usage.totalTokens,
        provider: usage.provider,
        model: usage.model,
      }
    : usage;

  const typicalTokens = envNumber("AGENT_PLAN_TYPICAL_TOKENS", 4096);
  const anomalyMultiplier = envNumber(
    "AGENT_PLAN_TOKEN_ANOMALY_MULTIPLIER",
    DEFAULT_ANOMALY_MULTIPLIER
  );
  const anomalous = combined.totalTokens > typicalTokens * anomalyMultiplier;
  const metric: AgentPlanCostMetric = {
    correlationId,
    ...combined,
    estimatedCostUsd: calculateCost(combined),
    anomalous,
    recordedAt: new Date().toISOString(),
  };

  metrics.set(correlationId, metric);
  if (anomalous) {
    logger.warn("Agent plan token usage anomaly detected", {
      correlationId,
      totalTokens: metric.totalTokens,
      typicalTokens,
      anomalyMultiplier,
      estimatedCostUsd: metric.estimatedCostUsd,
    });
  }
  return metric;
}

export function recordPlanLLMUsage(
  planId: string,
  usage: LLMTokenUsage
): AgentPlanCostMetric {
  return recordLLMUsage(planId, usage);
}

export function getPlanCostMetric(
  planId: string
): AgentPlanCostMetric | undefined {
  return metrics.get(planId);
}

export function getAggregatedPlanCostMetrics(): {
  plans: number;
  totalTokens: number;
  totalCostUsd: number;
  anomalousPlans: number;
} {
  const values = Array.from(metrics.values());
  return {
    plans: values.length,
    totalTokens: values.reduce((total, metric) => total + metric.totalTokens, 0),
    totalCostUsd: values.reduce(
      (total, metric) => total + metric.estimatedCostUsd,
      0
    ),
    anomalousPlans: values.filter((metric) => metric.anomalous).length,
  };
}

export function clearPlanCostMetrics(): void {
  metrics.clear();
}
