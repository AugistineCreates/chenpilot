import { getRedisClient } from "../services/redis/client";

export interface LockStatus {
  key: string;
  resource: string;
  ownerId: string | null;
  createdAt: number | null;
  ageMs: number | null;
  ttlMs: number;
  stale: boolean;
}

export interface LockMonitoringOptions {
  intervalMs?: number;
  expectedTtlMs?: number;
  staleGraceMs?: number;
  logger?: Pick<Console, "warn" | "error">;
}

interface RedisPipeline {
  get(key: string): RedisPipeline;
  ttl(key: string): RedisPipeline;
  exec(): Promise<Array<[Error | null, string | number | null]>>;
}

interface RedisClient {
  scan(
    cursor: string,
    ...args: Array<string | number>
  ): Promise<[string, string[]]>;
  pipeline(): RedisPipeline;
}

const DEFAULT_EXPECTED_TTL_MS = 30_000;
const DEFAULT_STALE_GRACE_MS = 5_000;
const DEFAULT_INTERVAL_MS = 60_000;

function positiveNumber(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function nonNegativeNumber(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function parseLockValue(value: string | null): {
  ownerId: string | null;
  createdAt: number | null;
} {
  if (!value) {
    return { ownerId: null, createdAt: null };
  }

  const parts = value.split(":");
  const createdAt = Number(parts[parts.length - 1]);

  return {
    ownerId: parts.length > 1 ? parts[0] : null,
    createdAt: Number.isFinite(createdAt) ? createdAt : null,
  };
}

export async function getLockStatuses(
  options: Pick<LockMonitoringOptions, "expectedTtlMs" | "staleGraceMs"> = {}
): Promise<LockStatus[]> {
  const redis = getRedisClient() as unknown as RedisClient;
  const expectedTtlMs = positiveNumber(
    options.expectedTtlMs,
    DEFAULT_EXPECTED_TTL_MS
  );
  const staleGraceMs = nonNegativeNumber(
    options.staleGraceMs,
    DEFAULT_STALE_GRACE_MS
  );
  const statuses: LockStatus[] = [];
  let cursor = "0";

  do {
    const result = await redis.scan(cursor, "MATCH", "lock:*", "COUNT", 100);
    cursor = result[0];
    const keys = result[1];

    if (keys.length === 0) {
      continue;
    }

    const pipeline = redis.pipeline();
    keys.forEach((key) => {
      pipeline.get(key);
      pipeline.ttl(key);
    });

    const replies = await pipeline.exec();
    const now = Date.now();

    for (let index = 0; index < keys.length; index += 1) {
      const valueReply = replies[index * 2];
      const ttlReply = replies[index * 2 + 1];
      const value = valueReply && !valueReply[0] ? valueReply[1] : null;
      const ttlSeconds = ttlReply && !ttlReply[0] ? Number(ttlReply[1]) : -2;
      const parsed = parseLockValue(typeof value === "string" ? value : null);
      const ageMs = parsed.createdAt === null ? null : now - parsed.createdAt;
      const ttlMs = ttlSeconds * 1000;
      const stale =
        ageMs !== null && ageMs > expectedTtlMs + staleGraceMs;

      statuses.push({
        key: keys[index],
        resource: keys[index].slice("lock:".length),
        ownerId: parsed.ownerId,
        createdAt: parsed.createdAt,
        ageMs,
        ttlMs,
        stale,
      });
    }
  } while (cursor !== "0");

  return statuses;
}

export async function monitorLocks(
  options: Pick<
    LockMonitoringOptions,
    "expectedTtlMs" | "staleGraceMs" | "logger"
  > = {}
): Promise<LockStatus[]> {
  const logger = options.logger || console;
  const statuses = await getLockStatuses(options);
  const staleLocks = statuses.filter((status) => status.stale);

  for (const lock of staleLocks) {
    logger.warn("Stale Redis lock detected", {
      key: lock.key,
      resource: lock.resource,
      ownerId: lock.ownerId,
      createdAt: lock.createdAt,
      ageMs: lock.ageMs,
      ttlMs: lock.ttlMs,
    });
  }

  return statuses;
}

export function startLockMonitoring(
  options: LockMonitoringOptions = {}
): () => void {
  const intervalMs = positiveNumber(options.intervalMs, DEFAULT_INTERVAL_MS);
  const logger = options.logger || console;
  let running = false;

  const run = async (): Promise<void> => {
    if (running) {
      return;
    }

    running = true;
    try {
      await monitorLocks(options);
    } catch (error) {
      logger.error("Redis lock monitoring failed", error);
    } finally {
      running = false;
    }
  };

  void run();
  const timer = setInterval(() => void run(), intervalMs);

  return () => clearInterval(timer);
}

export async function lockStatusHandler(
  _request: unknown,
  response: {
    status(code: number): { json(body: unknown): unknown };
    json(body: unknown): unknown;
  }
): Promise<void> {
  try {
    const locks = await getLockStatuses();
    response.json({
      locks,
      staleCount: locks.filter((lock) => lock.stale).length,
    });
  } catch (error) {
    response.status(503).json({
      error: "Unable to retrieve Redis lock status",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
