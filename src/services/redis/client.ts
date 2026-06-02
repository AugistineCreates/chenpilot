import Redis from "ioredis";
import config from "../../config/config";
import logger from "../../config/logger";

let client: Redis | null = null;
let connectCount = 0;

export function getRedisClient(): Redis {
  if (!client) {
    client = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
    });

    client.on("connect", () => {
      connectCount++;
      logger.info("Redis client connected", {
        connectionAttempt: connectCount,
      });
    });

    client.on("error", (err: Error) => {
      logger.error("Redis client error", { error: err.message });
    });
  }

  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
    logger.info("Redis client disconnected");
  }
}

export async function healthCheckRedis(): Promise<boolean> {
  try {
    const c = getRedisClient();
    await c.ping();
    return true;
  } catch {
    return false;
  }
}
