export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRangeMs: number;
}

export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  onRetry?: (attempt: number, error: any, nextDelayMs: number) => void
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs, jitterRangeMs } = config;
  let lastError: any;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      const retryCount = attempt; // 0 for the first retry, 1 for the second, etc.
      if (attempt === maxAttempts - 1) {
        break;
      }

      // Calculate exponential backoff: base_delay * 2^retry_count
      let delay = baseDelayMs * Math.pow(2, retryCount);
      if (delay > maxDelayMs) {
        delay = maxDelayMs;
      }

      // Add random jitter: delay + random_jitter
      const jitter = Math.random() * jitterRangeMs;
      const totalDelay = delay + jitter;

      if (onRetry) {
        onRetry(attempt + 1, error, totalDelay);
      }

      await new Promise((resolve) => setTimeout(resolve, totalDelay));
    }
  }

  throw lastError;
}
