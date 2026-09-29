import { DataSource, DataSourceOptions } from "typeorm";
import config from "./config";

/** Shape of the live pool statistics returned by getPoolStats(). */
export interface PoolStats {
  /** Maximum number of connections the pool will ever open. */
  maxConnections: number;
  /** Connections currently checked out (active). */
  activeConnections: number;
  /** Connections sitting idle, ready to be used. */
  idleConnections: number;
  /** Requests waiting because every connection is in use. */
  waitingRequests: number;
  /** Saturation ratio: activeConnections / maxConnections (0–1). */
  saturationRatio: number;
}

/** Default pool ceiling – can be overridden with DB_POOL_MAX env var. */
const DB_POOL_MAX = Math.max(
  1,
  Number.parseInt(process.env.DB_POOL_MAX || "10", 10)
);
const DB_POOL_MIN = Math.max(
  0,
  Number.parseInt(process.env.DB_POOL_MIN || "2", 10)
);
/** Milliseconds a caller will wait for a free connection before an error is thrown. */
const DB_POOL_ACQUIRE_TIMEOUT_MS = Math.max(
  500,
  Number.parseInt(process.env.DB_POOL_ACQUIRE_TIMEOUT_MS || "5000", 10)
);
/** Milliseconds an idle connection may remain in the pool before being closed. */
const DB_POOL_IDLE_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || "30000", 10)
);
import { Contact } from "../Contacts/contact.entity";
import { User } from "../Auth/user.entity";
import { RefreshToken } from "../Auth/refreshToken.entity";
import { UserPreferences } from "../Auth/userPreferences.entity";
import { AgentTool } from "../Agents/tools/agent-tool.entity";
import { AgentExecutionMetrics } from "../Agents/agentExecutionMetrics.entity";
import {
  PromptVersion,
  PromptMetric,
} from "../Agents/registry/PromptVersion.entity";
import { DurableExecution } from "../Agents/planner/DurableExecution.entity";
import { DurableStep } from "../Agents/planner/DurableStep.entity";
import { DurableOperation } from "../Reliability/DurableOperation.entity";
import { WebhookIdempotency } from "../Gateway/webhookIdempotency.entity";
import { AuditLog } from "../AuditLog/auditLog.entity";
import { DeployedContract } from "../ContractRegistry/contractRegistry.entity";
import { BotSession } from "../Bot/botSession.entity";
import { IndexerCursor } from "../services/stellarIndexer/indexerCursor.entity";
import {
  AdminWorkflowPolicy,
  AdminWorkflowInstance,
  AdminWorkflowApproval,
} from "../Agents/admin/workflow.entity";
import { TransactionLifecycle } from "../transactions/TransactionLifecycle.entity";
import { LedgerObservation } from "../transactions/LedgerObservation.entity";
import { OutboxEvent } from "../Reliability/outboxEvent.entity";

const isDev = config.env === "development";

const dbOptions: DataSourceOptions = {
  type: "postgres",
  host: config.db.postgres.host,
  port: Number(config.db.postgres.port),
  username: config.db.postgres.username,
  password: config.db.postgres.password || undefined,
  database: config.db.postgres.database,
  synchronize: false,
  /**
   * Connection-pool settings.
   * These are passed directly to the `pg` Pool constructor.
   * Tune DB_POOL_MAX / DB_POOL_MIN / DB_POOL_ACQUIRE_TIMEOUT_MS /
   * DB_POOL_IDLE_TIMEOUT_MS in your environment to match workload.
   */
  extra: {
    max: DB_POOL_MAX,
    min: DB_POOL_MIN,
    /** Milliseconds before a pending acquire() call rejects with a timeout. */
    connectionTimeoutMillis: DB_POOL_ACQUIRE_TIMEOUT_MS,
    /** Milliseconds an idle connection may sit before the pool closes it. */
    idleTimeoutMillis: DB_POOL_IDLE_TIMEOUT_MS,
  },
  entities: [
    Contact,
    User,
    RefreshToken,
    UserPreferences,
    AgentTool,
    AgentExecutionMetrics,
    PromptVersion,
    PromptMetric,
    DurableExecution,
    DurableStep,
    DurableOperation,
    WebhookIdempotency,
    AuditLog,
    DeployedContract,
    BotSession,
    IndexerCursor,
    AdminWorkflowPolicy,
    AdminWorkflowInstance,
    AdminWorkflowApproval,
    TransactionLifecycle,
    LedgerObservation,
    OutboxEvent,
  ],
  migrations: [isDev ? "src/migrations/**/*.ts" : "dist/migrations/**/*.js"],
  subscribers: [],
};

const AppDataSource = new DataSource(dbOptions);

/**
 * Returns live connection-pool saturation metrics by interrogating the
 * underlying `pg.Pool` that TypeORM holds.
 *
 * Returns `null` when the DataSource has not been initialised yet, so
 * callers must guard against a null result.
 */
export function getPoolStats(): PoolStats | null {
  if (!AppDataSource.isInitialized) return null;

  // TypeORM's PostgresDriver exposes the raw pg.Pool as `driver.master`.
  // We use `unknown` casting so we avoid importing internal TypeORM types.
  const driver = AppDataSource.driver as unknown as {
    master?: {
      totalCount: number;
      idleCount: number;
      waitingCount: number;
    };
  };

  const pool = driver.master;
  if (!pool) return null;

  const activeConnections = Math.max(0, pool.totalCount - pool.idleCount);

  return {
    maxConnections: DB_POOL_MAX,
    activeConnections,
    idleConnections: pool.idleCount,
    waitingRequests: pool.waitingCount,
    saturationRatio: DB_POOL_MAX > 0 ? activeConnections / DB_POOL_MAX : 0,
  };
}

export default AppDataSource;
export { AppDataSource };
