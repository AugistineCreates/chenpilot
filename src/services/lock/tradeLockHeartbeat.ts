export interface TradeLockHeartbeatOptions {
  /** Duration of the initially acquired lock, in milliseconds. */
  ttlMs?: number;
  /** Interval between lock extensions, in milliseconds. */
  heartbeatIntervalMs?: number;
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000;

function validatePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

/**
 * Runs a long-lived trade operation while periodically extending its lock.
 *
 * The extension interval is intentionally shorter than the lock TTL so that
 * temporary scheduling delays do not normally allow the lock to expire. If an
 * extension fails, the returned promise rejects immediately; callers should
 * use their normal trade cleanup path to release the lock and stop submitting
 * further on-chain work.
 */
export async function withTradeLockHeartbeat<T>(
  operation: Promise<T> | (() => Promise<T>),
  extendLock: () => Promise<void> | void,
  options: TradeLockHeartbeatOptions = {}
): Promise<T> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ??
    Math.min(DEFAULT_HEARTBEAT_INTERVAL_MS, Math.max(1, Math.floor(ttlMs / 3)));

  validatePositiveFinite(ttlMs, "ttlMs");
  validatePositiveFinite(heartbeatIntervalMs, "heartbeatIntervalMs");

  let rejectHeartbeatFailure: (reason?: unknown) => void = () => undefined;
  const heartbeatFailure = new Promise<never>((_, reject) => {
    rejectHeartbeatFailure = reject;
  });

  let extensionInFlight = false;
  let heartbeatFailed = false;
  const timer = setInterval(() => {
    if (extensionInFlight || heartbeatFailed) {
      return;
    }

    extensionInFlight = true;
    Promise.resolve()
      .then(() => extendLock())
      .catch((error: unknown) => {
        heartbeatFailed = true;
        rejectHeartbeatFailure(error);
      })
      .finally(() => {
        extensionInFlight = false;
      });
  }, heartbeatIntervalMs);

  try {
    const tradeOperation =
      typeof operation === "function" ? operation() : operation;
    return await Promise.race([tradeOperation, heartbeatFailure]);
  } finally {
    clearInterval(timer);
  }
}
