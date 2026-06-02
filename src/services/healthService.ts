import * as StellarSdk from "@stellar/stellar-sdk";
import { createClient } from "redis";
import nodemailer from "nodemailer";
import AppDataSource from "../config/Datasource";
import config from "../config/config";

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
  };
}

/** Critical dependencies: DOWN → UNHEALTHY */
const CRITICAL_DEPS = ["database", "redis"] as const;

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
  const out = await timed(async () => {
    if (!AppDataSource.isInitialized) {
      throw new Error("DataSource not initialized");
    }
    const result = await AppDataSource.query("SELECT 1 AS ok");
    return result;
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
    const page = await server.ledgers().limit(1).call();
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

function computeOverall(deps: HealthReport["dependencies"]): OverallStatus {
  const entries = Object.entries(deps) as [
    keyof HealthReport["dependencies"],
    DependencyHealth,
  ][];

  const criticalDown = CRITICAL_DEPS.some((key) => deps[key].status === "DOWN");
  if (criticalDown) return "UNHEALTHY";

  const anyDown = entries.some(([, d]) => d.status === "DOWN");
  const anyDegraded = entries.some(([, d]) => d.status === "DEGRADED");
  if (anyDown || anyDegraded) return "DEGRADED";

  return "HEALTHY";
}

export class HealthService {
  async getFullReport(): Promise<HealthReport> {
    const [database, redis, horizon, sorobanRpc, email, llm] =
      await Promise.all([
        checkDatabase(),
        checkRedis(),
        checkHorizon(),
        checkSorobanRpc(),
        checkEmail(),
        checkLlm(),
      ]);

    const dependencies = { database, redis, horizon, sorobanRpc, email, llm };

    return {
      overallStatus: computeOverall(dependencies),
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      dependencies,
    };
  }
}

export const healthService = new HealthService();
