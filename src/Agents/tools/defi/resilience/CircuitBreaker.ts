export type CircuitState = "CLOSED" | "OPEN" | "HALF-OPEN";

export interface CircuitBreakerConfig {
  failureThreshold: number; // consecutive failures to open the circuit
  resetTimeoutMs: number; // time to wait before transitioning to HALF-OPEN
  successThreshold: number; // consecutive successes to transition to CLOSED from HALF-OPEN
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private successCount = 0;
  private lastStateChange: number = Date.now();
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 3,
      resetTimeoutMs: config.resetTimeoutMs ?? 5000,
      successThreshold: config.successThreshold ?? 2,
    };
  }

  getConfig(): CircuitBreakerConfig {
    return this.config;
  }

  getState(): CircuitState {
    this.checkStateTransition();
    return this.state;
  }

  private checkStateTransition(): void {
    if (this.state === "OPEN") {
      const elapsed = Date.now() - this.lastStateChange;
      if (elapsed >= this.config.resetTimeoutMs) {
        this.transitionTo("HALF-OPEN");
      }
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();
    this.failureCount = 0;
    this.successCount = 0;
    console.log(`[CircuitBreaker] State transitioned from ${oldState} to ${newState}`);
  }

  recordSuccess(): void {
    this.checkStateTransition();
    if (this.state === "HALF-OPEN") {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo("CLOSED");
      }
    } else if (this.state === "CLOSED") {
      this.failureCount = 0;
    }
  }

  recordFailure(): void {
    this.checkStateTransition();
    if (this.state === "CLOSED") {
      this.failureCount++;
      if (this.failureCount >= this.config.failureThreshold) {
        this.transitionTo("OPEN");
      }
    } else if (this.state === "HALF-OPEN") {
      this.transitionTo("OPEN");
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();
    if (currentState === "OPEN") {
      throw new Error("Circuit breaker is OPEN. Call rejected.");
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
}
