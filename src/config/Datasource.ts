import { DataSource, DataSourceOptions } from "typeorm";
import config from "./config";
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

const isDev = config.env === "development";

const dbOptions: DataSourceOptions = {
  type: "postgres",
  host: config.db.postgres.host,
  port: Number(config.db.postgres.port),
  username: config.db.postgres.username,
  password: config.db.postgres.password || undefined,
  database: config.db.postgres.database,
  synchronize: false,
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
  ],
  migrations: [
    isDev ? "src/migrations/**/*.ts" : "dist/migrations/**/*.js",
  ],
  subscribers: [],
};

const AppDataSource = new DataSource(dbOptions);

export default AppDataSource;
export { AppDataSource };
