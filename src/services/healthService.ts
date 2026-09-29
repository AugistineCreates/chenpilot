import * as StellarSdk from "@stellar/stellar-sdk";
import { createClient } from "redis";
import nodemailer from "nodemailer";
import AppDataSource, { getPoolStats } from "../config/Datasource";
import config from "../config/config";
import { clockSkewService } from "./clock/clockSkew.service";
import type { ClockSample } from "./clock/types";

export type DependencyStatus = "UP" | "DEGRADED" | "DOWN";
export type OverallStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY";

export interface DependencyHealth {
  status: DependencyStatus;
  latencyMs: number;
  error?: string;
  /** Extra metadata (e.g. ledger sequence, db version) */
  detail?: Record<string, unknown>;
}

export interface HealthReport {
  overallStatus: OverallStatus;
  timestamp: string;
  uptime: number;
  dependencies: {
    database: DependencyHealth;
    redis: DependencyHealth;
    horizon: DependencyHealth;
    sorobanRpc: DependencyHealth;
    email: DependencyHealth;
    llm: DependencyHealth;
    clockSkew: DependencyHealth;
  };
}

async function timed<T>(
  fn: () => Promise<T>
): Promise<
  { latencyMs: number; result: T } | { latencyMs: number; error: Error }
> {
  const start = performance.now();
  try {
    const result = await fn();
    return { latencyMs: Math.round(performance.now() - start), result };
  } catch (err) {
    return {
      latencyMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

async function checkDatabase(): Promise<DependencyHealth> {
  if (!AppDataSource.isInitialized) {
    return {
      status: "DOWN",
      latencyMs: 0,
      error: "DataSource not initialized",
    };
  }

  // --- 1. Time connection acquisition (pool wait-time diagnostic) ---
  const acquireStart = performance.now();
  let acquireMs = 0;
  try {
    // Borrow a raw client from the pool to measure pure acquisition time,
    // then immediately release it before running the health query.
    const driver = AppDataSource.driver as unknown as {
      master?: { connect(): Promise<{ release(): void }> };
    };
    if (driver.master) {
      const client = await driver.master.connect();
      acquireMs = Math.round(performance.now() - acquireStart);
      client.release();
    }
  } catch {
    // Acquisition failure is surfaced via the query attempt below.
    acquireMs = Math.round(performance.now() - acquireStart);
  }

  // --- 2. Run the canonical liveness query ---
  const out = await timed(async () => {
    const result = await AppDataSource.query("SELECT 1 AS ok");
    return result;
  });

  // --- 3. Collect live pool saturation metrics ---
  const poolStats = getPoolStats();

  if ("error" in out) {
    return {
      status: "DOWN",
      latencyMs: out.latencyMs,
      error: out.error.message,
      detail: poolStats
        ? {
            acquireMs,
            pool: poolStats,
          }
        : { acquireMs },
    };
  }

  // --- 4. Determine status from pool saturation ---
  //
  // Rules:
  //  • DEGRADED when any requests are already waiting for a free connection
  //    (waitingRequests > 0) — the pool is exhausted right now.
  //  • DEGRADED when the saturation ratio is ≥ 0.8 (pool is 80 %+ full) —
  //    the next burst of requests will likely queue.
  //  • UP otherwise.
  const saturated = poolStats
    ? poolStats.waitingRequests > 0 || poolStats.saturationRatio >= 0.8
    : false;

  return {
    status: saturated ? "DEGRADED" : "UP",
    latencyMs: out.latencyMs,
    ...(saturated ? { error: "Connection pool is saturated" } : {}),
    detail: poolStats
      ? {
          acquireMs,
          pool: poolStats,
        }
      : { acquireMs },
  };
}

async function checkRedis(): Promise<DependencyHealth> {
  const url = config.redis.password
    ? `redis://:${config.redis.password}@${config.redis.host}:${config.redis.port}/${config.redis.db}`
    : `redis://${config.redis.host}:${config.redis.port}/${config.redis.db}`;

  const client = createClient({
    url,
    socket: { connectTimeout: 3000, reconnectStrategy: false },
  });

  try {
    const out = await timed(async () => {
      await client.connect();
      return client.ping();
    });

    if ("error" in out) {
      return {
        status: "DOWN",
        latencyMs: out.latencyMs,
        error: out.error.message,
      };
    }
    return { status: "UP", latencyMs: out.latencyMs };
  } finally {
    await client.quit().catch(() => {});
  }
}

async function checkHorizon(): Promise<DependencyHealth> {
  const out = await timed(async () => {
    const server = new StellarSdk.Horizon.Server(config.stellar.horizonUrl);
    const now = new Date();
    const page = await server.ledgers().limit(1).call();
    const ledgerTime = page.records?.[0]?.closed_at
      ? new Date(page.records[0].closed_at)
      : now;

    // Record clock sample for skew detection
    const sample: ClockSample = {
      localTime: now,
      remoteTime: ledgerTime,
      source: "horizon",
      latencyMs: Math.round(performance.now()),
    };
    clockSkewService.recordSample(sample);

    return page.records?.[0]?.sequence;
  });

  if ("error" in out) {
    return {
      status: "DOWN",
      latencyMs: out.latencyMs,
      error: out.error.message,
    };
  }
  return {
    status: "UP",
    latencyMs: out.latencyMs,
    detail: { ledgerSequence: out.result },
  };
}

async function checkSorobanRpc(): Promise<DependencyHealth> {
  const rpcUrl =
    process.env.SOROBAN_RPC_URL ||
    (config.stellar.network === "testnet"
      ? "https://soroban-testnet.stellar.org"
      : "https://mainnet.stellar.validationcloud.io/v1/XCpFB7kgdAFAcEwuVADpboMZDja5ttXS");

  const out = await timed(async () => {
    const server = new StellarSdk.SorobanRpc.Server(rpcUrl);
    return server.getLatestLedger();
  });

  if ("error" in out) {
    return {
      status: "DOWN",
      latencyMs: out.latencyMs,
      error: out.error.message,
    };
  }
  return {
    status: "UP",
    latencyMs: out.latencyMs,
    detail: { ledgerSequence: (out.result as { sequence?: number }).sequence },
  };
}

async function checkEmail(): Promise<DependencyHealth> {
  if (!config.email.host || config.email.host === "smtp.example.com") {
    return {
      status: "DEGRADED",
      latencyMs: 0,
      error: "Email not configured",
    };
  }

  const out = await timed(async () => {
    const transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465,
      auth: config.email.user
        ? { user: config.email.user, pass: config.email.pass }
        : undefined,
    });
    await transporter.verify();
  });

  if ("error" in out) {
    return {
      status: "DOWN",
      latencyMs: out.latencyMs,
      error: out.error.message,
    };
  }
  return { status: "UP", latencyMs: out.latencyMs };
}

async function checkLlm(): Promise<DependencyHealth> {
  if (!config.apiKey) {
    return {
      status: "DEGRADED",
      latencyMs: 0,
      error: "ANTHROPIC_API_KEY not configured",
    };
  }
  // Validate key format without making a network call (avoids cost/latency)
  const validFormat = /^sk-ant-/.test(config.apiKey);
  if (!validFormat) {
    return {
      status: "DEGRADED",
      latencyMs: 0,
      error: "ANTHROPIC_API_KEY format invalid",
    };
  }
  return { status: "UP", latencyMs: 0 };
}

async function checkClockSkew(): Promise<DependencyHealth> {
  const skewStats = clockSkewService.getStats();

  const statusMap = {
    HEALTHY: "UP" as DependencyStatus,
    DEGRADED: "DEGRADED" as DependencyStatus,
    CRITICAL: "DOWN" as DependencyStatus,
  };

  return {
    status: statusMap[skewStats.status],
    latencyMs: 0,
    detail: {
      maxOffsetMs: skewStats.maxOffsetMs,
      medianOffsetMs: skewStats.medianOffsetMs,
      stdDeviation: skewStats.stdDeviation,
      status: skewStats.status,
    },
  };
}

function computeOverall(deps: HealthReport["dependencies"]): OverallStatus {
  const entries = Object.entries(deps) as [
    keyof HealthReport["dependencies"],
    DependencyHealth,
  ][];

  const criticalDeps = ["database", "redis", "clockSkew"] as const;
  const criticalDown = criticalDeps.some((key) => deps[key].status === "DOWN");
  if (criticalDown) return "UNHEALTHY";

  const anyDown = entries.some(([, d]) => d.status === "DOWN");
  const anyDegraded = entries.some(([, d]) => d.status === "DEGRADED");
  if (anyDown || anyDegraded) return "DEGRADED";

  return "HEALTHY";
}

export class HealthService {
  async getFullReport(): Promise<HealthReport> {
    const [database, redis, horizon, sorobanRpc, email, llm, clockSkew] =
      await Promise.all([
        checkDatabase(),
        checkRedis(),
        checkHorizon(),
        checkSorobanRpc(),
        checkEmail(),
        checkLlm(),
        checkClockSkew(),
      ]);

    const dependencies = {
      database,
      redis,
      horizon,
      sorobanRpc,
      email,
      llm,
      clockSkew,
    };

    return {
      overallStatus: computeOverall(dependencies),
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      dependencies,
    };
  }
}

export const healthService = new HealthService();
