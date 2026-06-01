import {
  SorobanNetwork,
  ResourceLimits,
  FeeBumpConfig,
  FeeBumpResult,
  FeeBumpStrategy,
  TransactionResourceError,
} from "./types";

/**
 * Default resource limits for Soroban transactions
 */
const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  cpuInstructions: 100_000_000,
  readBytes: 200_000,
  writeBytes: 100_000,
  readLedgerEntries: 40,
  writeLedgerEntries: 25,
  txSizeByte: 100_000,
};

/**
 * Multipliers for different fee bump strategies
 */
const STRATEGY_MULTIPLIERS: Record<FeeBumpStrategy, number> = {
  conservative: 1.2,
  moderate: 1.5,
  aggressive: 2.0,
};

/**
 * Maximum number of fee bump attempts
 */
const MAX_BUMP_ATTEMPTS = 3;

/**
 * Parse resource error from Soroban RPC response
 */
function parseResourceError(error: string): TransactionResourceError | null {
  const patterns = {
    cpuInstructions: /cpu.*?instructions.*?exceeded.*?(\d+).*?limit.*?(\d+)/i,
    readBytes: /read.*?bytes.*?exceeded.*?(\d+).*?limit.*?(\d+)/i,
    writeBytes: /write.*?bytes.*?exceeded.*?(\d+).*?limit.*?(\d+)/i,
    readLedgerEntries: /read.*?entries.*?exceeded.*?(\d+).*?limit.*?(\d+)/i,
    writeLedgerEntries: /write.*?entries.*?exceeded.*?(\d+).*?limit.*?(\d+)/i,
    txSizeByte: /transaction.*?size.*?exceeded.*?(\d+).*?limit.*?(\d+)/i,
  };

  for (const [resource, pattern] of Object.entries(patterns)) {
    const match = error.match(pattern);
    if (match) {
      return {
        resource: resource as keyof ResourceLimits,
        required: parseInt(match[1], 10),
        limit: parseInt(match[2], 10),
        message: error,
      };
    }
  }

  return null;
}

/**
 * Calculate adjusted resource limits based on error and strategy
 */
function calculateAdjustedLimits(
  currentLimits: ResourceLimits,
  error: TransactionResourceError,
  strategy: FeeBumpStrategy
): ResourceLimits {
  const multiplier = STRATEGY_MULTIPLIERS[strategy];
  const newLimits = { ...currentLimits };

  // Adjust the specific resource that failed
  const requiredValue = error.required;
  newLimits[error.resource] = Math.ceil(requiredValue * multiplier);

  // Also bump other resources proportionally to avoid cascading failures
  const proportionalBump = 1.1;
  for (const key of Object.keys(newLimits) as Array<keyof ResourceLimits>) {
    if (key !== error.resource) {
      newLimits[key] = Math.ceil(newLimits[key] * proportionalBump);
    }
  }

  return newLimits;
}

/**
 * Estimate resource fee based on limits
 */
function estimateResourceFee(limits: ResourceLimits): number {
  // Base fee calculation (simplified)
  // In production, this should use actual network fee rates
  const cpuFee = Math.ceil(limits.cpuInstructions / 10_000);
  const readFee = Math.ceil(limits.readBytes / 1_000);
  const writeFee = Math.ceil(limits.writeBytes / 500);
  const entryFee =
    (limits.readLedgerEntries + limits.writeLedgerEntries) * 1000;
  const sizeFee = Math.ceil(limits.txSizeByte / 100);

  return cpuFee + readFee + writeFee + entryFee + sizeFee;
}

/**
 * Fee Bumping Engine for Soroban transactions
 *
 * Automatically adjusts resource limits when transactions fail due to
 * insufficient resources. Supports multiple retry strategies and
 * configurable limits.
 *
 * @example
 * ```typescript
 * const engine = new FeeBumpingEngine({
 *   strategy: 'moderate',
 *   maxAttempts: 3,
 * });
 *
 * const result = await engine.bumpAndRetry(
 *   async (limits) => {
 *     return await invokeContract({
 *       ...params,
 *       resourceLimits: limits,
 *     });
 *   },
 *   { cpuInstructions: 50_000_000, ... }
 * );
 * ```
 */
export class FeeBumpingEngine {
  private config: Required<Omit<FeeBumpConfig, "onBump">> &
    Pick<FeeBumpConfig, "onBump">;

  constructor(config?: FeeBumpConfig) {
    this.config = {
      strategy: config?.strategy || "moderate",
      maxAttempts: config?.maxAttempts || MAX_BUMP_ATTEMPTS,
      initialLimits: config?.initialLimits || DEFAULT_RESOURCE_LIMITS,
      onBump: config?.onBump,
    };
  }

  /**
   * Execute a transaction with automatic fee bumping on resource errors
   *
   * @param txExecutor - Function that executes the transaction with given limits
   * @param initialLimits - Optional initial resource limits (uses defaults if not provided)
   * @returns Result containing success status, final limits, and transaction result
   */
  async bumpAndRetry<T>(
    txExecutor: (limits: ResourceLimits) => Promise<T>,
    initialLimits?: Partial<ResourceLimits>
  ): Promise<FeeBumpResult<T>> {
    let currentLimits: ResourceLimits = {
      ...this.config.initialLimits,
      ...initialLimits,
    };

    const attempts: Array<{
      attempt: number;
      limits: ResourceLimits;
      error?: string;
    }> = [];

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        const result = await txExecutor(currentLimits);

        return {
          success: true,
          result,
          finalLimits: currentLimits,
          attempts,
          estimatedFee: estimateResourceFee(currentLimits),
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        attempts.push({
          attempt,
          limits: { ...currentLimits },
          error: errorMessage,
        });

        // Check if this is a resource error
        const resourceError = parseResourceError(errorMessage);

        if (!resourceError) {
          // Not a resource error, don't retry
          return {
            success: false,
            error: errorMessage,
            finalLimits: currentLimits,
            attempts,
            estimatedFee: estimateResourceFee(currentLimits),
          };
        }

        // Last attempt failed
        if (attempt === this.config.maxAttempts) {
          return {
            success: false,
            error: `Max retry attempts (${this.config.maxAttempts}) reached. Last error: ${errorMessage}`,
            finalLimits: currentLimits,
            attempts,
            estimatedFee: estimateResourceFee(currentLimits),
          };
        }

        // Calculate new limits and retry
        const previousLimits = { ...currentLimits };
        currentLimits = calculateAdjustedLimits(
          currentLimits,
          resourceError,
          this.config.strategy
        );

        // Notify about the bump
        if (this.config.onBump) {
          this.config.onBump({
            attempt,
            previousLimits,
            newLimits: currentLimits,
            error: resourceError,
          });
        }
      }
    }

    // Should never reach here, but TypeScript needs it
    return {
      success: false,
      error: "Unexpected error in fee bumping loop",
      finalLimits: currentLimits,
      attempts,
      estimatedFee: estimateResourceFee(currentLimits),
    };
  }

  /**
   * Manually calculate adjusted limits for a given error
   *
   * @param error - Error message from failed transaction
   * @param currentLimits - Current resource limits
   * @returns Adjusted limits or null if error is not resource-related
   */
  calculateAdjustment(
    error: string,
    currentLimits: ResourceLimits
  ): ResourceLimits | null {
    const resourceError = parseResourceError(error);
    if (!resourceError) {
      return null;
    }

    return calculateAdjustedLimits(
      currentLimits,
      resourceError,
      this.config.strategy
    );
  }

  /**
   * Estimate the fee for given resource limits
   *
   * @param limits - Resource limits to estimate fee for
   * @returns Estimated fee in stroops
   */
  estimateFee(limits: ResourceLimits): number {
    return estimateResourceFee(limits);
  }

  /**
   * Get default resource limits
   */
  static getDefaultLimits(): ResourceLimits {
    return { ...DEFAULT_RESOURCE_LIMITS };
  }
}

/**
 * Create a fee bumping engine with optional configuration
 *
 * @param config - Optional configuration for the engine
 * @returns Configured FeeBumpingEngine instance
 */
export function createFeeBumpingEngine(
  config?: FeeBumpConfig
): FeeBumpingEngine {
  return new FeeBumpingEngine(config);
}
