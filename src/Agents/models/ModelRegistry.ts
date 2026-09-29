/**
 * Model Registry and Selection
 * 
 * Central registry for certified LLM models with capability-based selection.
 * Manages model metadata, fallback chains, and availability.
 */

import {
  ModelCapability,
  CapabilityRequirement,
  meetsRequirements,
  getCertificationStatus,
  CertificationStatus,
  PlanVersion,
  OutputFormat,
  generateToolSchemaHash,
} from "./ModelCapability";
import { toolRegistry } from "../registry/ToolRegistry";
import logger from "../../config/logger";

/**
 * Model selection strategy
 */
export enum SelectionStrategy {
  /** Select highest quality model that meets requirements */
  QUALITY_FIRST = "quality_first",
  /** Select lowest latency model that meets requirements */
  LATENCY_FIRST = "latency_first",
  /** Select lowest cost model that meets requirements */
  COST_FIRST = "cost_first",
  /** Balance quality, latency, and cost */
  BALANCED = "balanced",
}

/**
 * Fallback chain configuration
 */
export interface FallbackChain {
  /** Primary model to try first */
  primary: string;
  /** Ordered list of fallback models */
  fallbacks: string[];
  /** Strategy for selecting from fallbacks */
  strategy: SelectionStrategy;
}

/**
 * Model selection result
 */
export interface ModelSelectionResult {
  /** Selected model capability */
  model: ModelCapability;
  /** Whether this is a fallback (not primary) */
  isFallback: boolean;
  /** Reason for selection */
  reason: string;
  /** Models that were considered but rejected */
  rejected: Array<{
    modelId: string;
    reasons: string[];
  }>;
}

/**
 * Central registry for LLM models
 */
export class ModelRegistry {
  private models: Map<string, ModelCapability> = new Map();
  private fallbackChains: Map<string, FallbackChain> = new Map();

  /**
   * Register a model with the registry
   */
  register(capability: ModelCapability): void {
    const status = getCertificationStatus(capability);
    
    if (status === CertificationStatus.UNCERTIFIED) {
      logger.warn(`Registering uncertified model: ${capability.modelId}`);
    } else if (status === CertificationStatus.EXPIRED) {
      logger.warn(`Registering model with expired certification: ${capability.modelId}`);
    } else if (status === CertificationStatus.FAILED) {
      logger.warn(`Registering model with failed conformance tests: ${capability.modelId}`);
    }

    this.models.set(capability.modelId, capability);
    logger.info(`Registered model: ${capability.modelId}`, {
      provider: capability.provider,
      planVersions: capability.supportedPlanVersions,
      certificationStatus: status,
    });
  }

  /**
   * Unregister a model
   */
  unregister(modelId: string): boolean {
    const removed = this.models.delete(modelId);
    if (removed) {
      logger.info(`Unregistered model: ${modelId}`);
    }
    return removed;
  }

  /**
   * Get a model by ID
   */
  getModel(modelId: string): ModelCapability | undefined {
    return this.models.get(modelId);
  }

  /**
   * Get all registered models
   */
  getAllModels(): ModelCapability[] {
    return Array.from(this.models.values());
  }

  /**
   * Get models that meet specific capability requirements
   */
  getCompatibleModels(requirements: CapabilityRequirement): ModelCapability[] {
    const compatible: ModelCapability[] = [];

    for (const capability of this.models.values()) {
      const check = meetsRequirements(capability, requirements);
      if (check.meets) {
        compatible.push(capability);
      }
    }

    return compatible;
  }

  /**
   * Register a fallback chain
   */
  registerFallbackChain(name: string, chain: FallbackChain): void {
    // Validate that all models in the chain exist
    const allModels = [chain.primary, ...chain.fallbacks];
    const missing = allModels.filter(id => !this.models.has(id));
    
    if (missing.length > 0) {
      throw new Error(`Cannot register fallback chain '${name}': models not found: ${missing.join(", ")}`);
    }

    this.fallbackChains.set(name, chain);
    logger.info(`Registered fallback chain: ${name}`, {
      primary: chain.primary,
      fallbacks: chain.fallbacks,
      strategy: chain.strategy,
    });
  }

  /**
   * Get a fallback chain by name
   */
  getFallbackChain(name: string): FallbackChain | undefined {
    return this.fallbackChains.get(name);
  }

  /**
   * Select the best model for given requirements
   */
  selectModel(
    requirements: CapabilityRequirement,
    strategy: SelectionStrategy = SelectionStrategy.QUALITY_FIRST,
    preferredModelId?: string
  ): ModelSelectionResult | null {
    const rejected: Array<{ modelId: string; reasons: string[] }> = [];
    
    // First try preferred model if specified
    if (preferredModelId) {
      const preferred = this.models.get(preferredModelId);
      if (preferred) {
        const check = meetsRequirements(preferred, requirements);
        if (check.meets) {
          logger.debug(`Selected preferred model: ${preferredModelId}`);
          return {
            model: preferred,
            isFallback: false,
            reason: "Preferred model meets all requirements",
            rejected,
          };
        } else {
          rejected.push({ modelId: preferredModelId, reasons: check.reasons });
          logger.debug(`Preferred model ${preferredModelId} does not meet requirements`, {
            reasons: check.reasons,
          });
        }
      }
    }

    // Get all compatible models
    const compatible = this.getCompatibleModels(requirements);
    
    if (compatible.length === 0) {
      logger.warn("No compatible models found for requirements", { requirements });
      
      // Record why each model was rejected
      for (const capability of this.models.values()) {
        const check = meetsRequirements(capability, requirements);
        if (!check.meets) {
          rejected.push({ modelId: capability.modelId, reasons: check.reasons });
        }
      }
      
      return null;
    }

    // Sort compatible models by strategy
    const sorted = this.sortByStrategy(compatible, strategy);
    const selected = sorted[0];

    logger.info(`Selected model: ${selected.modelId}`, {
      strategy,
      isFallback: preferredModelId !== undefined && selected.modelId !== preferredModelId,
      qualityScore: selected.performance.qualityScore,
      avgLatency: selected.performance.avgLatencyMs,
    });

    return {
      model: selected,
      isFallback: preferredModelId !== undefined && selected.modelId !== preferredModelId,
      reason: this.getSelectionReason(selected, strategy),
      rejected,
    };
  }

  /**
   * Select model using a fallback chain
   */
  selectWithFallbackChain(
    chainName: string,
    requirements: CapabilityRequirement
  ): ModelSelectionResult | null {
    const chain = this.fallbackChains.get(chainName);
    if (!chain) {
      logger.error(`Fallback chain not found: ${chainName}`);
      return null;
    }

    const rejected: Array<{ modelId: string; reasons: string[] }> = [];

    // Try primary model first
    const primary = this.models.get(chain.primary);
    if (primary) {
      const check = meetsRequirements(primary, requirements);
      if (check.meets) {
        logger.debug(`Selected primary model from chain '${chainName}': ${chain.primary}`);
        return {
          model: primary,
          isFallback: false,
          reason: `Primary model from chain '${chainName}'`,
          rejected,
        };
      } else {
        rejected.push({ modelId: chain.primary, reasons: check.reasons });
        logger.warn(`Primary model ${chain.primary} from chain '${chainName}' does not meet requirements`, {
          reasons: check.reasons,
        });
      }
    }

    // Try fallback models
    const compatibleFallbacks: ModelCapability[] = [];
    
    for (const fallbackId of chain.fallbacks) {
      const fallback = this.models.get(fallbackId);
      if (!fallback) {
        continue;
      }

      const check = meetsRequirements(fallback, requirements);
      if (check.meets) {
        compatibleFallbacks.push(fallback);
      } else {
        rejected.push({ modelId: fallbackId, reasons: check.reasons });
      }
    }

    if (compatibleFallbacks.length === 0) {
      logger.error(`No compatible fallback models in chain '${chainName}'`, {
        primary: chain.primary,
        fallbacks: chain.fallbacks,
        rejected: rejected.map(r => r.modelId),
      });
      return null;
    }

    // Sort fallbacks by strategy
    const sorted = this.sortByStrategy(compatibleFallbacks, chain.strategy);
    const selected = sorted[0];

    logger.warn(`Falling back to model: ${selected.modelId}`, {
      chain: chainName,
      originalPrimary: chain.primary,
      strategy: chain.strategy,
    });

    return {
      model: selected,
      isFallback: true,
      reason: `Fallback from chain '${chainName}' (primary ${chain.primary} unavailable)`,
      rejected,
    };
  }

  /**
   * Update model availability status
   */
  updateAvailability(modelId: string, available: boolean): void {
    const model = this.models.get(modelId);
    if (model) {
      model.available = available;
      logger.info(`Updated model availability: ${modelId} -> ${available}`);
    }
  }

  /**
   * Sync certified tool schemas with current tool registry
   * Returns models that need re-certification due to schema changes
   */
  syncToolSchemas(): string[] {
    const needsRecertification: string[] = [];
    const currentTools = toolRegistry.getAllTools();

    for (const capability of this.models.values()) {
      let schemaChanged = false;

      for (const certifiedSchema of capability.certifiedToolSchemas) {
        const currentTool = currentTools.find(t => t.metadata.name === certifiedSchema.toolName);
        
        if (!currentTool) {
          logger.warn(`Model ${capability.modelId} certified for tool '${certifiedSchema.toolName}' which no longer exists`);
          schemaChanged = true;
          continue;
        }

        const currentHash = generateToolSchemaHash(currentTool.metadata);
        if (currentHash !== certifiedSchema.schemaHash) {
          logger.warn(`Tool schema changed for '${certifiedSchema.toolName}'`, {
            modelId: capability.modelId,
            certifiedVersion: certifiedSchema.version,
            currentVersion: currentTool.metadata.version,
            certifiedHash: certifiedSchema.schemaHash,
            currentHash,
          });
          schemaChanged = true;
        }
      }

      if (schemaChanged) {
        needsRecertification.push(capability.modelId);
      }
    }

    return needsRecertification;
  }

  /**
   * Sort models by selection strategy
   */
  private sortByStrategy(
    models: ModelCapability[],
    strategy: SelectionStrategy
  ): ModelCapability[] {
    const sorted = [...models];

    switch (strategy) {
      case SelectionStrategy.QUALITY_FIRST:
        sorted.sort((a, b) => b.performance.qualityScore - a.performance.qualityScore);
        break;

      case SelectionStrategy.LATENCY_FIRST:
        sorted.sort((a, b) => a.performance.avgLatencyMs - b.performance.avgLatencyMs);
        break;

      case SelectionStrategy.COST_FIRST:
        sorted.sort((a, b) => {
          const costA = a.performance.costPerKInput + a.performance.costPerKOutput;
          const costB = b.performance.costPerKInput + b.performance.costPerKOutput;
          return costA - costB;
        });
        break;

      case SelectionStrategy.BALANCED:
        sorted.sort((a, b) => {
          // Normalize metrics to 0-1 scale and compute weighted score
          const maxQuality = Math.max(...models.map(m => m.performance.qualityScore));
          const maxLatency = Math.max(...models.map(m => m.performance.avgLatencyMs));
          const maxCost = Math.max(...models.map(m => 
            m.performance.costPerKInput + m.performance.costPerKOutput
          ));

          const scoreA = this.computeBalancedScore(a, maxQuality, maxLatency, maxCost);
          const scoreB = this.computeBalancedScore(b, maxQuality, maxLatency, maxCost);
          
          return scoreB - scoreA; // Higher score is better
        });
        break;
    }

    return sorted;
  }

  /**
   * Compute balanced score (higher is better)
   */
  private computeBalancedScore(
    model: ModelCapability,
    maxQuality: number,
    maxLatency: number,
    maxCost: number
  ): number {
    const qualityNorm = model.performance.qualityScore / (maxQuality || 1);
    const latencyNorm = 1 - (model.performance.avgLatencyMs / (maxLatency || 1));
    const costNorm = 1 - ((model.performance.costPerKInput + model.performance.costPerKOutput) / (maxCost || 1));

    // Weighted average: quality 50%, latency 30%, cost 20%
    return qualityNorm * 0.5 + latencyNorm * 0.3 + costNorm * 0.2;
  }

  /**
   * Get human-readable selection reason
   */
  private getSelectionReason(model: ModelCapability, strategy: SelectionStrategy): string {
    switch (strategy) {
      case SelectionStrategy.QUALITY_FIRST:
        return `Highest quality model (score: ${model.performance.qualityScore.toFixed(3)})`;
      case SelectionStrategy.LATENCY_FIRST:
        return `Lowest latency model (${model.performance.avgLatencyMs}ms avg)`;
      case SelectionStrategy.COST_FIRST:
        const cost = model.performance.costPerKInput + model.performance.costPerKOutput;
        return `Most cost-effective model ($${cost.toFixed(4)}/1K tokens)`;
      case SelectionStrategy.BALANCED:
        return `Best balanced score across quality, latency, and cost`;
      default:
        return "Selected based on requirements";
    }
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalModels: number;
    availableModels: number;
    certifiedModels: number;
    expiredModels: number;
    fallbackChains: number;
  } {
    let availableModels = 0;
    let certifiedModels = 0;
    let expiredModels = 0;

    for (const capability of this.models.values()) {
      if (capability.available) {
        availableModels++;
      }

      const status = getCertificationStatus(capability);
      if (status === CertificationStatus.CERTIFIED) {
        certifiedModels++;
      } else if (status === CertificationStatus.EXPIRED) {
        expiredModels++;
      }
    }

    return {
      totalModels: this.models.size,
      availableModels,
      certifiedModels,
      expiredModels,
      fallbackChains: this.fallbackChains.size,
    };
  }
}

// Singleton instance
export const modelRegistry = new ModelRegistry();
