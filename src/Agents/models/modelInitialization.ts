/**
 * Model Initialization
 * 
 * Initializes the model registry with certified models and fallback chains.
 * Loads model capabilities from configuration and optionally runs differential evaluation.
 */

import {
  ModelCapability,
  PlanVersion,
  OutputFormat,
  generateToolSchemaHash,
} from "./ModelCapability";
import { modelRegistry, SelectionStrategy } from "./ModelRegistry";
import { toolRegistry } from "../registry/ToolRegistry";
import { differentialEvaluator } from "./DifferentialEvaluator";
import config from "../../config/config";
import logger from "../../config/logger";

/**
 * Initialize model registry with certified models
 */
export function initializeModelRegistry(): void {
  logger.info("Initializing model registry");

  // Get all current tools for certification
  const allTools = toolRegistry.getAllTools();
  const certifiedToolSchemas = allTools.map(tool => ({
    toolName: tool.metadata.name,
    version: tool.metadata.version,
    schemaHash: generateToolSchemaHash(tool.metadata),
  }));

  // Register Claude 3.5 Haiku (primary model - fast, cost-effective)
  const claudeHaiku: ModelCapability = {
    modelId: "claude-3-5-haiku-20241022",
    displayName: "Claude 3.5 Haiku",
    provider: "anthropic",
    certifiedToolSchemas,
    supportedPlanVersions: [PlanVersion.V1_WORKFLOW, PlanVersion.V2_RISK_AWARE],
    supportedOutputFormats: [
      OutputFormat.JSON,
      OutputFormat.TYPED_JSON,
      OutputFormat.TEXT,
    ],
    safetyCompatibility: {
      assetTrustAware: true,
      riskEstimation: true,
      approvalAware: true,
      rbacAware: true,
      minSafetyConfidence: 0.85,
    },
    performance: {
      avgLatencyMs: 1200,
      p95LatencyMs: 2500,
      costPerKInput: 0.001,
      costPerKOutput: 0.005,
      maxTokens: 200000,
      qualityScore: 0.88,
    },
    certifiedAt: new Date(),
    certificationExpiry: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
    available: true,
    metadata: {
      conformanceTests: [],
      limitations: [
        "May occasionally misinterpret complex multi-step workflows",
        "Less contextual reasoning than larger models",
      ],
      recommendedFor: [
        "Standard DeFi operations",
        "Balance queries",
        "Simple swaps",
        "Cost-sensitive workloads",
      ],
    },
  };

  // Register Claude 3.5 Sonnet (fallback - higher quality)
  const claudeSonnet: ModelCapability = {
    modelId: "claude-3-5-sonnet-20241022",
    displayName: "Claude 3.5 Sonnet",
    provider: "anthropic",
    certifiedToolSchemas,
    supportedPlanVersions: [
      PlanVersion.V1_WORKFLOW,
      PlanVersion.V2_RISK_AWARE,
      PlanVersion.V3_PHASED,
    ],
    supportedOutputFormats: [
      OutputFormat.JSON,
      OutputFormat.TYPED_JSON,
      OutputFormat.STREAMING_JSON,
      OutputFormat.TEXT,
    ],
    safetyCompatibility: {
      assetTrustAware: true,
      riskEstimation: true,
      approvalAware: true,
      rbacAware: true,
      minSafetyConfidence: 0.92,
    },
    performance: {
      avgLatencyMs: 2000,
      p95LatencyMs: 4000,
      costPerKInput: 0.003,
      costPerKOutput: 0.015,
      maxTokens: 200000,
      qualityScore: 0.95,
    },
    certifiedAt: new Date(),
    certificationExpiry: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    available: true,
    metadata: {
      conformanceTests: [],
      limitations: ["Higher latency than Haiku", "Higher cost per request"],
      recommendedFor: [
        "Complex multi-step workflows",
        "High-risk operations requiring careful reasoning",
        "Edge cases and ambiguous requests",
        "Quality-sensitive workloads",
      ],
    },
  };

  // Register Claude 3 Opus (ultimate fallback - highest quality)
  const claudeOpus: ModelCapability = {
    modelId: "claude-3-opus-20240229",
    displayName: "Claude 3 Opus",
    provider: "anthropic",
    certifiedToolSchemas,
    supportedPlanVersions: [
      PlanVersion.V1_WORKFLOW,
      PlanVersion.V2_RISK_AWARE,
      PlanVersion.V3_PHASED,
    ],
    supportedOutputFormats: [
      OutputFormat.JSON,
      OutputFormat.TYPED_JSON,
      OutputFormat.STREAMING_JSON,
      OutputFormat.TEXT,
    ],
    safetyCompatibility: {
      assetTrustAware: true,
      riskEstimation: true,
      approvalAware: true,
      rbacAware: true,
      minSafetyConfidence: 0.95,
    },
    performance: {
      avgLatencyMs: 3500,
      p95LatencyMs: 7000,
      costPerKInput: 0.015,
      costPerKOutput: 0.075,
      maxTokens: 200000,
      qualityScore: 0.98,
    },
    certifiedAt: new Date(),
    certificationExpiry: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    available: true,
    metadata: {
      conformanceTests: [],
      limitations: [
        "Highest latency",
        "Highest cost",
        "May be overkill for simple operations",
      ],
      recommendedFor: [
        "Critical safety-sensitive operations",
        "Complex reasoning tasks",
        "When maximum quality is required",
        "Fallback of last resort",
      ],
    },
  };

  // Register models
  modelRegistry.register(claudeHaiku);
  modelRegistry.register(claudeSonnet);
  modelRegistry.register(claudeOpus);

  // Register fallback chain from configuration
  const primaryModel = config.models.primary;
  const fallbackModels = config.models.fallbacks;
  const strategy = parseSelectionStrategy(config.models.selectionStrategy);

  modelRegistry.registerFallbackChain("default", {
    primary: primaryModel,
    fallbacks: fallbackModels,
    strategy,
  });

  logger.info("Model registry initialized", {
    primary: primaryModel,
    fallbacks: fallbackModels,
    strategy,
    totalModels: modelRegistry.getStats().totalModels,
  });
}

/**
 * Parse selection strategy from config string
 */
function parseSelectionStrategy(strategy: string): SelectionStrategy {
  switch (strategy.toLowerCase()) {
    case "quality_first":
      return SelectionStrategy.QUALITY_FIRST;
    case "latency_first":
      return SelectionStrategy.LATENCY_FIRST;
    case "cost_first":
      return SelectionStrategy.COST_FIRST;
    case "balanced":
      return SelectionStrategy.BALANCED;
    default:
      logger.warn(`Unknown selection strategy '${strategy}', defaulting to quality_first`);
      return SelectionStrategy.QUALITY_FIRST;
  }
}

/**
 * Run differential evaluation on startup
 * Validates that fallback models behave equivalently to primary model
 */
export async function runStartupDifferentialEvaluation(
  callModel: (
    modelId: string,
    prompt: string
  ) => Promise<{ output: unknown; tokenUsage: { inputTokens: number; outputTokens: number } }>
): Promise<void> {
  if (!config.models.differentialEvalOnStartup) {
    logger.info("Differential evaluation on startup is disabled");
    return;
  }

  logger.info("Running startup differential evaluation");

  // Load standard test suite
  differentialEvaluator.loadStandardTests();

  // Get all models from the fallback chain
  const primaryModel = config.models.primary;
  const fallbackModels = config.models.fallbacks;
  const modelsToTest = [primaryModel, ...fallbackModels].filter(Boolean);

  try {
    const report = await differentialEvaluator.evaluate(modelsToTest, callModel);

    // Log summary
    logger.info("Differential evaluation completed", {
      totalTests: report.summary.totalTests,
      passedTests: report.summary.passedTests,
      failedTests: report.summary.failedTests,
      equivalentPairs: report.summary.equivalentPairs,
      divergentPairs: report.summary.divergentPairs,
      criticalDifferences: report.summary.criticalDifferences,
      unsafeModels: report.unsafeModels,
    });

    // Mark unsafe models as unavailable
    if (report.unsafeModels.length > 0) {
      logger.error("Critical: Some models failed safety tests", {
        unsafeModels: report.unsafeModels,
      });

      for (const unsafeModel of report.unsafeModels) {
        modelRegistry.updateAvailability(unsafeModel, false);
        logger.warn(`Marked model as unavailable due to failed safety tests: ${unsafeModel}`);
      }
    }

    // Warn about critical differences
    if (report.summary.criticalDifferences > 0) {
      logger.warn(
        `Found ${report.summary.criticalDifferences} critical differences between model outputs`
      );
    }

    // Check if primary model is available
    const primaryAvailable = !report.unsafeModels.includes(primaryModel);
    if (!primaryAvailable) {
      logger.error(
        `Primary model '${primaryModel}' failed safety tests! Application may not function correctly.`
      );
    }

    // Check if any fallback models are available
    const availableFallbacks = fallbackModels.filter(
      m => !report.unsafeModels.includes(m)
    );
    if (availableFallbacks.length === 0) {
      logger.error("No fallback models available after safety validation!");
    } else {
      logger.info(`Available fallback models: ${availableFallbacks.join(", ")}`);
    }
  } catch (error) {
    logger.error("Differential evaluation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't block startup on evaluation failure
  }
}

/**
 * Sync tool schemas with model registry
 * Call this after registering new tools or updating tool schemas
 */
export function syncModelToolSchemas(): void {
  logger.info("Syncing tool schemas with model registry");
  
  const needsRecertification = modelRegistry.syncToolSchemas();
  
  if (needsRecertification.length > 0) {
    logger.warn("Models need re-certification due to tool schema changes", {
      models: needsRecertification,
    });
    
    // Optionally mark models as needing recertification
    for (const modelId of needsRecertification) {
      const model = modelRegistry.getModel(modelId);
      if (model && model.metadata) {
        model.metadata.limitations = [
          ...(model.metadata.limitations || []),
          "Tool schemas have changed since certification - recertification needed",
        ];
      }
    }
  } else {
    logger.info("All model tool schemas are up to date");
  }
}

/**
 * Get model registry statistics
 */
export function getModelRegistryStats(): {
  totalModels: number;
  availableModels: number;
  certifiedModels: number;
  expiredModels: number;
  fallbackChains: number;
  primary: string;
  fallbacks: string[];
} {
  const stats = modelRegistry.getStats();
  
  return {
    ...stats,
    primary: config.models.primary,
    fallbacks: config.models.fallbacks,
  };
}
