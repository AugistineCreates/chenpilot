/**
 * Provider Health Service
 *
 * Tracks provider health scoring with a critical invariant:
 * health scoring CANNOT silently reduce the minimum quorum.
 * A provider must still be counted toward quorum even if its
 * health score is low, unless it is explicitly marked as unhealthy
 * AND the remaining healthy providers still meet the minimum quorum.
 */

import {
  ProviderHealth,
  ProviderConfig,
  QuorumReadConfig,
} from "./quorumRead.types";
import logger from "../config/logger";

/** Decay factor for health score on failure (0.8 = 20% penalty) */
const FAILURE_DECAY = 0.8;
/** Recovery factor for health score on success (0.1 = 10% bonus capped at 1.0) */
const SUCCESS_RECOVERY = 0.1;
/** Minimum health score before a provider is considered unhealthy */
const UNHEALTHY_THRESHOLD = 0.2;
/** Maximum consecutive failures before provider is marked unhealthy */
const MAX_CONSECUTIVE_FAILURES = 5;

export class ProviderHealthService {
  private healthMap: Map<string, ProviderHealth> = new Map();
  private config: QuorumReadConfig;
  private providers: ProviderConfig[];

  constructor(providers: ProviderConfig[], config: QuorumReadConfig) {
    this.providers = providers;
    this.config = config;

    // Initialize health tracking for all providers
    for (const provider of providers) {
      this.healthMap.set(provider.id, {
        providerId: provider.id,
        healthy: true,
        score: 1.0,
        consecutiveFailures: 0,
        totalRequests: 0,
        totalFailures: 0,
        avgLatencyMs: 0,
      });
    }
  }

  /**
   * Record a successful request for a provider.
   */
  recordSuccess(providerId: string, latencyMs: number): void {
    const health = this.healthMap.get(providerId);
    if (!health) return;

    health.totalRequests++;
    health.score = Math.min(1.0, health.score + SUCCESS_RECOVERY);
    health.consecutiveFailures = 0;
    health.healthy = true;
    health.lastSuccessAt = Date.now();

    // Exponential moving average for latency
    health.avgLatencyMs =
      health.totalRequests === 1
        ? latencyMs
        : health.avgLatencyMs * 0.9 + latencyMs * 0.1;
  }

  /**
   * Record a failed request for a provider.
   */
  recordFailure(providerId: string, error?: string): void {
    const health = this.healthMap.get(providerId);
    if (!health) return;

    health.totalRequests++;
    health.totalFailures++;
    health.consecutiveFailures++;
    health.score *= FAILURE_DECAY;
    health.lastFailureAt = Date.now();

    if (
      health.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ||
      health.score < UNHEALTHY_THRESHOLD
    ) {
      health.healthy = false;
      logger.warn(
        `Provider ${providerId} marked unhealthy (score: ${health.score.toFixed(3)}, consecutive failures: ${health.consecutiveFailures})`,
        { error }
      );
    }
  }

  /**
   * Get the health status of a provider.
   */
  getHealth(providerId: string): ProviderHealth | undefined {
    return this.healthMap.get(providerId);
  }

  /**
   * Get all provider health statuses.
   */
  getAllHealth(): ProviderHealth[] {
    return Array.from(this.healthMap.values());
  }

  /**
   * Determine which providers should be queried for a quorum read.
   *
   * CRITICAL INVARIANT: Health scoring CANNOT reduce the minimum quorum.
   * If disabling unhealthy providers would leave fewer than minQuorumSize
   * healthy providers, ALL providers are included (even unhealthy ones).
   */
  getProvidersForQuorum(): ProviderConfig[] {
    const healthyProviders = this.providers.filter((p) => {
      const health = this.healthMap.get(p.id);
      return health?.healthy !== false;
    });

    const unhealthyProviders = this.providers.filter((p) => {
      const health = this.healthMap.get(p.id);
      return health?.healthy === false;
    });

    // If healthy providers meet the minimum quorum, exclude unhealthy ones
    if (healthyProviders.length >= this.config.minQuorumSize) {
      logger.debug(
        `Quorum: ${healthyProviders.length} healthy providers meet minQuorumSize=${this.config.minQuorumSize}`
      );
      return healthyProviders;
    }

    // CRITICAL: Cannot reduce below minimum quorum — include ALL providers
    logger.warn(
      `Quorum: Only ${healthyProviders.length} healthy providers (need ${this.config.minQuorumSize}). Including ${unhealthyProviders.length} unhealthy providers to maintain quorum.`
    );
    return this.providers;
  }

  /**
   * Get the effective quorum size after health filtering.
   * This value is NEVER less than minQuorumSize as long as providers exist.
   */
  getEffectiveQuorumSize(): number {
    const available = this.getProvidersForQuorum();
    return Math.max(available.length, this.config.minQuorumSize);
  }

  /**
   * Reset health state for a provider (e.g., after manual intervention).
   */
  resetProvider(providerId: string): void {
    const health = this.healthMap.get(providerId);
    if (health) {
      health.score = 1.0;
      health.healthy = true;
      health.consecutiveFailures = 0;
    }
  }

  /**
   * Get a summary of provider health for monitoring/alerting.
   */
  getHealthSummary(): {
    totalProviders: number;
    healthyProviders: number;
    unhealthyProviders: number;
    averageScore: number;
    minQuorumSize: number;
    quorumMaintained: boolean;
  } {
    const all = this.getAllHealth();
    const healthy = all.filter((h) => h.healthy);
    const unhealthy = all.filter((h) => !h.healthy);
    const averageScore =
      all.length > 0
        ? all.reduce((sum, h) => sum + h.score, 0) / all.length
        : 0;

    return {
      totalProviders: all.length,
      healthyProviders: healthy.length,
      unhealthyProviders: unhealthy.length,
      averageScore,
      minQuorumSize: this.config.minQuorumSize,
      quorumMaintained: healthy.length >= this.config.minQuorumSize,
    };
  }
}
