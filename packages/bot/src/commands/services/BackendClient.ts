/**
 * Safer Backend Client
 * Provides safer integration with backend services with retry logic, timeouts, and circuit breakers
 */

import { BackendClient, CommandError } from '../types';

interface CircuitBreakerState {
  isOpen: boolean;
  failureCount: number;
  lastFailureTime: number;
  nextAttemptTime: number;
}

interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export class SafeBackendClient implements BackendClient {
  private baseUrl: string;
  private timeoutMs: number;
  private circuitBreaker: Map<string, CircuitBreakerState>;
  private retryConfig: RetryConfig;

  constructor(
    baseUrl: string,
    options: {
      timeoutMs?: number;
      retryConfig?: Partial<RetryConfig>;
    } = {}
  ) {
    this.baseUrl = baseUrl;
    this.timeoutMs = options.timeoutMs || 30000;
    this.circuitBreaker = new Map();
    this.retryConfig = {
      maxAttempts: options.retryConfig?.maxAttempts || 3,
      initialDelayMs: options.retryConfig?.initialDelayMs || 1000,
      maxDelayMs: options.retryConfig?.maxDelayMs || 10000,
      backoffMultiplier: options.retryConfig?.backoffMultiplier || 2,
    };
  }

  /**
   * Execute command with retry logic and circuit breaker
   */
  async executeCommand<TInput, TOutput>(
    command: string,
    input: TInput,
    userId: string
  ): Promise<TOutput> {
    const endpoint = `${this.baseUrl}/commands/${command}`;
    
    // Check circuit breaker
    if (this.isCircuitOpen(endpoint)) {
      throw new CommandError({
        code: 'BACKEND_ERROR',
        message: 'Circuit breaker is open for this endpoint',
        recoverable: false,
      });
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.retryConfig.maxAttempts; attempt++) {
      try {
        const result = await this.fetchWithTimeout<TOutput>(
          endpoint,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-User-Id': userId,
            },
            body: JSON.stringify(input),
          }
        );

        // Reset circuit breaker on success
        this.resetCircuitBreaker(endpoint);
        
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Don't retry on certain errors
        if (!this.shouldRetry(error)) {
          break;
        }

        // Exponential backoff
        if (attempt < this.retryConfig.maxAttempts - 1) {
          const delay = this.calculateDelay(attempt);
          await this.sleep(delay);
        }
      }
    }

    // Record failure and potentially open circuit breaker
    this.recordFailure(endpoint);

    throw new CommandError({
      code: 'BACKEND_ERROR',
      message: lastError?.message || 'Failed to execute command',
      recoverable: true,
      details: { endpoint, attempts: this.retryConfig.maxAttempts },
    });
  }

  /**
   * Execute workflow with retry logic and circuit breaker
   */
  async executeWorkflow<TState, TOutput = unknown>(
    workflow: string,
    state: TState,
    step: string
  ): Promise<TOutput> {
    const endpoint = `${this.baseUrl}/workflows/${workflow}/${step}`;

    if (this.isCircuitOpen(endpoint)) {
      throw new CommandError({
        code: 'BACKEND_ERROR',
        message: 'Circuit breaker is open for this endpoint',
        recoverable: false,
      });
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.retryConfig.maxAttempts; attempt++) {
      try {
        const result = await this.fetchWithTimeout<TOutput>(
          endpoint,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ state }),
          }
        );

        this.resetCircuitBreaker(endpoint);
        
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (!this.shouldRetry(error)) {
          break;
        }

        if (attempt < this.retryConfig.maxAttempts - 1) {
          const delay = this.calculateDelay(attempt);
          await this.sleep(delay);
        }
      }
    }

    this.recordFailure(endpoint);

    throw new CommandError({
      code: 'BACKEND_ERROR',
      message: lastError?.message || 'Failed to execute workflow',
      recoverable: true,
      details: { endpoint, attempts: this.retryConfig.maxAttempts },
    });
  }

  /**
   * Fetch with timeout
   */
  private async fetchWithTimeout<T>(
    url: string,
    options: RequestInit
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      
      throw error;
    }
  }

  /**
   * Check if circuit breaker is open for endpoint
   */
  private isCircuitOpen(endpoint: string): boolean {
    const state = this.circuitBreaker.get(endpoint);
    if (!state) return false;

    if (Date.now() >= state.nextAttemptTime) {
      // Circuit breaker can be reset
      this.circuitBreaker.delete(endpoint);
      return false;
    }

    return state.isOpen;
  }

  /**
   * Record failure for circuit breaker
   */
  private recordFailure(endpoint: string): void {
    const state = this.circuitBreaker.get(endpoint) || {
      isOpen: false,
      failureCount: 0,
      lastFailureTime: 0,
      nextAttemptTime: 0,
    };

    state.failureCount++;
    state.lastFailureTime = Date.now();

    // Open circuit breaker after 5 failures
    if (state.failureCount >= 5) {
      state.isOpen = true;
      state.nextAttemptTime = Date.now() + 60000; // 1 minute cooldown
    }

    this.circuitBreaker.set(endpoint, state);
  }

  /**
   * Reset circuit breaker for endpoint
   */
  private resetCircuitBreaker(endpoint: string): void {
    this.circuitBreaker.delete(endpoint);
  }

  /**
   * Determine if error should trigger retry
   */
  private shouldRetry(error: Error): boolean {
    // Retry on network errors and 5xx errors
    if (error.message.includes('timeout')) return true;
    if (error.message.includes('ECONNREFUSED')) return true;
    if (error.message.includes('ETIMEDOUT')) return true;
    if (error.message.startsWith('HTTP 5')) return true;
    
    return false;
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateDelay(attempt: number): number {
    const delay = this.retryConfig.initialDelayMs * 
      Math.pow(this.retryConfig.backoffMultiplier, attempt);
    return Math.min(delay, this.retryConfig.maxDelayMs);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get circuit breaker state for monitoring
   */
  getCircuitBreakerState(): Record<string, CircuitBreakerState> {
    return Object.fromEntries(this.circuitBreaker);
  }

  /**
   * Reset all circuit breakers
   */
  resetAllCircuitBreakers(): void {
    this.circuitBreaker.clear();
  }
}
