/**
 * Quorum Read Service
 *
 * Implements provider quorum reads for security-critical chain state.
 * Requires consensus across multiple independent providers before
 * accepting balances, sequence numbers, contract state, and transaction status.
 *
 * Key behaviors:
 * - Configurable quorum size and provider independence
 * - Divergent responses fail closed for mutating operations
 * - Provider health scoring cannot silently reduce the minimum quorum
 * - Normalized comparison with explicit disagreement handling
 */

import {
  ProviderResponse,
  QuorumReadResult,
  ProviderConfig,
  QuorumReadConfig,
  ChainStateCategory,
  QuorumReadError,
  QuorumReadException,
} from "./quorumRead.types";
import { ProviderHealthService } from "./providerHealth.service";
import logger from "../config/logger";

/** Default quorum configuration */
export const DEFAULT_QUORUM_CONFIG: QuorumReadConfig = {
  minQuorumSize: 2,
  totalProviders: 3,
  providerTimeoutMs: 5000,
  maxResponseAgeMs: 30000,
  failClosedOnDivergence: true,
  protectedCategories: [
    "balance",
    "sequence_number",
    "contract_state",
    "transaction_status",
  ],
};

/**
 * Normalize a response value for comparison across providers.
 * Handles different formats, rounding, and whitespace.
 */
function normalizeValue<T>(value: T): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value.trim().toLowerCase();
  if (typeof value === "number") {
    // Normalize floating point precision
    return Number(value.toPrecision(15)).toString();
  }
  if (typeof value === "object") {
    return JSON.stringify(value, Object.keys(value as object).sort());
  }
  return String(value);
}

/**
 * Group responses by their normalized value and count agreements.
 * The canonical value stored is the first response's raw value for each group.
 */
function groupByValue<T>(
  responses: ProviderResponse<T>[]
): Map<string, { value: T; count: number; providers: string[] }> {
  const groups = new Map<
    string,
    { value: T; count: number; providers: string[] }
  >();

  for (const response of responses) {
    if (response.value === null) continue; // Skip failed responses

    const normalized = normalizeValue(response.value);
    const existing = groups.get(normalized);
    if (existing) {
      existing.count++;
      existing.providers.push(response.providerId);
    } else {
      groups.set(normalized, {
        value: response.value,
        count: 1,
        providers: [response.providerId],
      });
    }
  }

  return groups;
}

export class QuorumReadService {
  private healthService: ProviderHealthService;
  private config: QuorumReadConfig;
  private providers: ProviderConfig[];

  constructor(
    providers: ProviderConfig[],
    config: Partial<QuorumReadConfig> = {}
  ) {
    this.config = { ...DEFAULT_QUORUM_CONFIG, ...config };
    this.providers = providers;
    this.healthService = new ProviderHealthService(providers, this.config);
  }

  /**
   * Perform a quorum read across all available providers.
   *
   * @param fetchFn - Function that queries a single provider and returns a response
   * @param category - The chain state category being read
   * @param context - Additional context for logging
   * @returns QuorumReadResult with the agreed-upon value or rejection
   */
  async readQuorum<T>(
    fetchFn: (provider: ProviderConfig) => Promise<ProviderResponse<T>>,
    category: ChainStateCategory,
    context?: Record<string, unknown>
  ): Promise<QuorumReadResult<T>> {
    if (!this.config.protectedCategories.includes(category)) {
      logger.debug(`Category ${category} not protected, skipping quorum read`);
      return {
        quorumAchieved: false,
        value: null,
        agreementCount: 0,
        totalProviders: 0,
        responses: [],
        rejected: true,
        error: `Category ${category} is not protected by quorum reads`,
      };
    }

    // Get providers to query (health-aware, never below minQuorumSize)
    const providersToQuery = this.healthService.getProvidersForQuorum();
    const minRequired = this.config.minQuorumSize;

    logger.debug(
      `Quorum read for ${category}: querying ${providersToQuery.length} providers (min quorum: ${minRequired})`,
      context
    );

    // Query all providers concurrently with timeout
    const responses = await Promise.all(
      providersToQuery.map(async (provider) => {
        const startTime = Date.now();
        try {
          const response = await Promise.race([
            fetchFn(provider),
            this.createTimeout<ProviderResponse<T>>(
              this.config.providerTimeoutMs,
              provider.id
            ),
          ]);

          const latencyMs = Date.now() - startTime;

          // Check staleness
          if (
            response.timestamp &&
            Date.now() - response.timestamp > this.config.maxResponseAgeMs
          ) {
            this.healthService.recordFailure(
              provider.id,
              "Response exceeded staleness threshold"
            );
            return {
              providerId: provider.id,
              value: null,
              error: `Stale response: ${(Date.now() - response.timestamp).toFixed(0)}ms old`,
              timestamp: response.timestamp,
              latencyMs: response.latencyMs,
            };
          }

          // Check latency
          if (latencyMs > this.config.providerTimeoutMs * 0.8) {
            this.healthService.recordFailure(
              provider.id,
              "High latency response"
            );
          } else {
            this.healthService.recordSuccess(provider.id, latencyMs);
          }

          return response;
        } catch (error) {
          const latencyMs = Date.now() - startTime;
          this.healthService.recordFailure(
            provider.id,
            error instanceof Error ? error.message : "Unknown error"
          );
          return {
            providerId: provider.id,
            value: null,
            error: error instanceof Error ? error.message : "Unknown error",
            timestamp: Date.now(),
            latencyMs,
          };
        }
      })
    );

    // Analyze responses
    return this.analyzeResponses<T>(responses, category, minRequired);
  }

  /**
   * Analyze provider responses to determine if quorum was achieved.
   */
  private analyzeResponses<T>(
    responses: ProviderResponse<T>[],
    category: ChainStateCategory,
    minRequired: number
  ): QuorumReadResult<T> {
    const validResponses = responses.filter((r) => r.value !== null);
    const failedResponses = responses.filter((r) => r.value === null);

    // Not enough providers responded
    if (validResponses.length < minRequired) {
      const error = `Only ${validResponses.length}/${responses.length} providers responded successfully (need ${minRequired})`;
      logger.warn(`Quorum failed for ${category}: ${error}`);

      if (this.config.failClosedOnDivergence) {
        throw new QuorumReadException(
          QuorumReadError.INSUFFICIENT_PROVIDERS,
          error,
          {
            category,
            validResponses: validResponses.length,
            totalResponses: responses.length,
            minRequired,
          }
        );
      }

      return {
        quorumAchieved: false,
        value: null,
        agreementCount: 0,
        totalProviders: responses.length,
        responses,
        rejected: true,
        error,
      };
    }

    // Group responses by normalized value
    const groups = groupByValue(validResponses);

    // Find the majority group
    let majorityGroup: { value: T; count: number; providers: string[] } | null =
      null;

    for (const group of groups.values()) {
      if (!majorityGroup || group.count > majorityGroup.count) {
        majorityGroup = group;
      }
    }

    // If multiple groups tie, fail closed on divergence
    if (majorityGroup) {
      const tiedGroups = Array.from(groups.values()).filter(
        (g) => g.count === majorityGroup!.count
      );
      if (tiedGroups.length > 1) {
        const error = `Multiple values tied for majority: ${tiedGroups.length} groups with ${majorityGroup.count} votes each`;
        logger.warn(`Quorum failed for ${category}: ${error}`);

        if (this.config.failClosedOnDivergence) {
          throw new QuorumReadException(
            QuorumReadError.DIVERGENT_RESPONSES,
            error,
            {
              category,
              groups: Array.from(groups.entries()).map(([k, v]) => ({
                normalizedValue: k,
                count: v.count,
                providers: v.providers,
              })),
            }
          );
        }

        return {
          quorumAchieved: false,
          value: null,
          agreementCount: majorityGroup.count,
          totalProviders: responses.length,
          responses,
          rejected: true,
          error,
        };
      }
    }

    if (!majorityGroup) {
      const error = "No valid responses to analyze";
      logger.warn(`Quorum failed for ${category}: ${error}`);

      if (this.config.failClosedOnDivergence) {
        throw new QuorumReadException(
          QuorumReadError.ALL_PROVIDERS_FAILED,
          error,
          { category, responses }
        );
      }

      return {
        quorumAchieved: false,
        value: null,
        agreementCount: 0,
        totalProviders: responses.length,
        responses,
        rejected: true,
        error,
      };
    }

    // Check if majority meets quorum threshold
    if (majorityGroup.count < minRequired) {
      const error = `No value achieved quorum: best agreement was ${majorityGroup.count}/${responses.length} (need ${minRequired})`;
      logger.warn(`Quorum failed for ${category}: ${error}`, {
        groups: Array.from(groups.entries()).map(([k, v]) => ({
          normalizedValue: k,
          count: v.count,
          providers: v.providers,
        })),
      });

      if (this.config.failClosedOnDivergence) {
        throw new QuorumReadException(
          QuorumReadError.DIVERGENT_RESPONSES,
          error,
          {
            category,
            majorityCount: majorityGroup.count,
            minRequired,
            groups: Array.from(groups.entries()).map(([k, v]) => ({
              normalizedValue: k,
              count: v.count,
              providers: v.providers,
            })),
          }
        );
      }

      return {
        quorumAchieved: false,
        value: null,
        agreementCount: majorityGroup.count,
        totalProviders: responses.length,
        responses,
        rejected: true,
        error,
      };
    }

    // Quorum achieved
    logger.info(
      `Quorum achieved for ${category}: ${majorityGroup.count}/${responses.length} providers agree`,
      { providers: majorityGroup.providers }
    );

    return {
      quorumAchieved: true,
      value: majorityGroup.value,
      agreementCount: majorityGroup.count,
      totalProviders: responses.length,
      responses,
      rejected: false,
    };
  }

  /**
   * Create a timeout promise that rejects after specified ms.
   */
  private createTimeout<T>(ms: number, providerId: string): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(`Provider ${providerId} timed out after ${ms}ms`)
        );
      }, ms);
    });
  }

  /**
   * Get the provider health service for monitoring.
   */
  getHealthService(): ProviderHealthService {
    return this.healthService;
  }

  /**
   * Get the current quorum configuration.
   */
  getConfig(): QuorumReadConfig {
    return { ...this.config };
  }
}
