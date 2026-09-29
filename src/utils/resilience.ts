import logger from "../config/logger";
import { BudgetExhaustedError } from "./budget";

export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number;
  recoveryTimeout: number;
  successThreshold: number;
  timeoutMs?: number;
  onStateChange?: (oldState: CircuitState, newState: CircuitState) => void;
}

export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly circuitName: string,
    public readonly circuitState: CircuitState,
  ) {
    super(message);
    this.name = "CircuitBreakerError";
  }
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private options: CircuitBreakerOptions;

  constructor(options: CircuitBreakerOptions) {
    this.options = {
      failureThreshold: 5,
      recoveryTimeout: 30000,
      successThreshold: 2,
      timeoutMs: 10000,
      ...options,
    };
  }

  private setState(newState: CircuitState): void {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      logger.warn(
        `Circuit breaker '${this.options.name}' state changed`,
        { oldState, newState, circuitName: this.options.name }
      );
      this.options.onStateChange?.(oldState, newState);
    }
  }

  private canCall(): boolean {
    const now = Date.now();

    switch (this.state) {
      case CircuitState.CLOSED:
        return true;
      case CircuitState.OPEN:
        if (now - this.lastFailureTime >= this.options.recoveryTimeout) {
          this.setState(CircuitState.HALF_OPEN);
          this.successCount = 0;
          return true;
        }
        return false;
      case CircuitState.HALF_OPEN:
        return true;
    }
  }

  private recordSuccess(): void {
    switch (this.state) {
      case CircuitState.HALF_OPEN:
        this.successCount++;
        if (this.successCount >= this.options.successThreshold) {
          this.setState(CircuitState.CLOSED);
          this.failureCount = 0;
          this.successCount = 0;
        }
        break;
      case CircuitState.CLOSED:
        this.failureCount = 0;
        break;
    }
  }

  private recordFailure(): void {
    this.lastFailureTime = Date.now();
    switch (this.state) {
      case CircuitState.CLOSED:
        this.failureCount++;
        if (this.failureCount >= this.options.failureThreshold) {
          this.setState(CircuitState.OPEN);
        }
        break;
      case CircuitState.HALF_OPEN:
        this.setState(CircuitState.OPEN);
        break;
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canCall()) {
      throw new CircuitBreakerError(
        `Circuit breaker '${this.options.name}' is OPEN. Request blocked.`,
        this.options.name,
        this.state,
      );
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    logger.info(`Circuit breaker '${this.options.name}' reset`, { circuitName: this.options.name });
  }

  getMetrics(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime: number;
  } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
    };
  }
}

export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableErrors?: (error: Error) => boolean;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

export class RetryAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryAbortedError";
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const {
    maxAttempts,
    initialDelayMs,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    retryableErrors = (error) => !(error instanceof BudgetExhaustedError),
    onRetry,
  } = options;

  let lastError: Error | undefined;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!retryableErrors(lastError) || attempt === maxAttempts) {
        throw lastError;
      }

      onRetry?.(attempt, lastError, delay);
      logger.warn(
        `Retrying operation (attempt ${attempt}/${maxAttempts})`,
        { attempt, maxAttempts, delayMs: delay, error: lastError.message },
      );

      await new Promise((resolve) => setTimeout(resolve, delay));

      delay = Math.min(delay * backoffMultiplier, maxDelayMs);
    }
  }

  throw lastError;
}

export async function withRetryAndCircuitBreaker<T>(
  fn: () => Promise<T>,
  retryOptions: RetryOptions,
  circuitBreaker: CircuitBreaker,
): Promise<T> {
  return await circuitBreaker.execute(() => withRetry(fn, retryOptions));
}

export interface BudgetedRetryOptions extends Omit<RetryOptions, "maxAttempts"> {
  budget: {
    attempts: number;
    deadline: number;
  };
}

export async function withBudgetedRetry<T>(
  fn: () => Promise<T>,
  options: BudgetedRetryOptions,
): Promise<T> {
  const { budget, initialDelayMs, maxDelayMs = 30000, backoffMultiplier = 2, retryableErrors, onRetry } = options;

  let lastError: Error | undefined;
  let delay = initialDelayMs;
  const maxAttempts = budget.attempts;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (Date.now() > budget.deadline) {
        throw new BudgetExhaustedError(
          `Budget deadline exhausted during retry on attempt ${attempt}`,
          "deadline",
          {
            deadline: budget.deadline,
            attempts: maxAttempts - attempt,
            bytes: 0,
            downstreamCalls: 0,
            path: options as unknown as string,
            consumedAttempts: attempt,
            consumedBytes: 0,
            consumedDownstreamCalls: 0,
          },
        );
      }

      const shouldRetry = retryableErrors
        ? retryableErrors(lastError)
        : !(lastError instanceof BudgetExhaustedError);

      if (!shouldRetry || attempt === maxAttempts) {
        throw lastError;
      }

      onRetry?.(attempt, lastError, delay);
      logger.warn(
        `Budgeted retrying operation (attempt ${attempt}/${maxAttempts})`,
        { attempt, maxAttempts, delayMs: delay, error: lastError.message },
      );

      await new Promise((resolve) => setTimeout(resolve, delay));

      delay = Math.min(delay * backoffMultiplier, maxDelayMs);
    }
  }

  throw lastError;
}

export const createResilientFunction = <T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: {
    circuitBreakerOptions: CircuitBreakerOptions;
    retryOptions: RetryOptions;
  },
): T => {
  const circuitBreaker = new CircuitBreaker(options.circuitBreakerOptions);
  
  return ((...args: any[]) => {
    return withRetryAndCircuitBreaker(
      () => fn(...args),
      options.retryOptions,
      circuitBreaker,
    );
  }) as T;
};
