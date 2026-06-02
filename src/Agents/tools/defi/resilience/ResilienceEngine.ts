import { CircuitBreaker, CircuitBreakerConfig } from "./CircuitBreaker";
import { executeWithRetry, RetryConfig } from "./Retry";
import { z } from "zod";

export interface ResilienceConfig {
  retry?: Partial<RetryConfig>;
  circuitBreaker?: Partial<CircuitBreakerConfig>;
}

export class ResilienceEngine {
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();

  /**
   * Get or create a circuit breaker for a unique key.
   */
  getCircuitBreaker(key: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    if (!this.circuitBreakers.has(key)) {
      this.circuitBreakers.set(key, new CircuitBreaker(config));
    }
    return this.circuitBreakers.get(key)!;
  }

  /**
   * Clears the circuit breaker cache (useful for testing)
   */
  clearCircuitBreakers(): void {
    this.circuitBreakers.clear();
  }

  /**
   * Execute an operation wrapped in Circuit Breaker, Retries with Exponential Backoff + Jitter,
   * and strict Schema Validation.
   */
  async execute<T, S extends z.ZodTypeAny>(
    key: string,
    fn: () => Promise<any>,
    schema?: S,
    config?: ResilienceConfig
  ): Promise<z.infer<S> | T> {
    const cb = this.getCircuitBreaker(key, config?.circuitBreaker);

    // Merge default configuration with custom inputs
    const retryConfig: RetryConfig = {
      maxAttempts: config?.retry?.maxAttempts ?? 3,
      baseDelayMs: config?.retry?.baseDelayMs ?? 1000,
      maxDelayMs: config?.retry?.maxDelayMs ?? 10000,
      jitterRangeMs: config?.retry?.jitterRangeMs ?? 100,
    };

    return cb.execute(async () => {
      return executeWithRetry(async () => {
        const rawResult = await fn();
        
        if (schema) {
          const parsed = schema.safeParse(rawResult);
          if (!parsed.success) {
            console.error(`[ResilienceEngine] Schema validation failed:`, parsed.error.format());
            throw new Error(`Schema validation failed: ${parsed.error.message}`);
          }
          return parsed.data;
        }
        
        return rawResult;
      }, retryConfig);
    });
  }
}

export const resilienceEngine = new ResilienceEngine();
