import AppDataSource from "../config/Datasource";
import {
  AgentExecutionMetrics,
  ExecutionStatus,
} from "../Agents/agentExecutionMetrics.entity";
import { AuditAction, AuditLog } from "../AuditLog/auditLog.entity";
import { BotSession } from "../Bot/botSession.entity";
import { contractMetadataRegistry } from "./contracts";

export interface OperatorReportQuery {
  startDate?: Date;
  endDate?: Date;
}

export interface OperatorReport {
  periodStart: string;
  periodEnd: string;
  execution: {
    total: number;
    successRate: number;
    failureRate: number;
    averageExecutionTimeMs: number;
    byStatus: Record<string, number>;
    byAgentType: Record<string, number>;
  };
  audit: {
    totalEvents: number;
    dataExports: number;
    contractActions: number;
    securityEvents: number;
    byAction: Record<string, number>;
  };
  botSessions: {
    active: number;
    expired: number;
    byPlatform: Record<string, number>;
  };
  contracts: {
    registered: number;
    enabledBindings: number;
    capabilities: string[];
  };
}

export class OperatorReportingService {
  private executionRepository =
    AppDataSource.getRepository(AgentExecutionMetrics);
  private auditRepository = AppDataSource.getRepository(AuditLog);
  private botSessionRepository = AppDataSource.getRepository(BotSession);

  async buildReport(query: OperatorReportQuery = {}): Promise<OperatorReport> {
    const periodEnd = query.endDate ?? new Date();
    const periodStart =
      query.startDate ?? new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000);

    const [execution, audit, botSessions] = await Promise.all([
      this.getExecutionSummary(periodStart, periodEnd),
      this.getAuditSummary(periodStart, periodEnd),
      this.getBotSessionSummary(periodEnd),
    ]);

    const contracts = contractMetadataRegistry.listContracts();
    const enabledBindings = contracts.reduce(
      (total, contract) =>
        total + contract.bindings.filter((binding) => binding.enabled).length,
      0
    );
    const capabilities = Array.from(
      new Set(
        contracts.flatMap((contract) =>
          contract.capabilities.map((capability) => capability.name)
        )
      )
    ).sort();

    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      execution,
      audit,
      botSessions,
      contracts: {
        registered: contracts.length,
        enabledBindings,
        capabilities,
      },
    };
  }

  private async getExecutionSummary(
    periodStart: Date,
    periodEnd: Date
  ): Promise<OperatorReport["execution"]> {
    const baseQuery = this.executionRepository
      .createQueryBuilder("execution")
      .where("execution.createdAt >= :periodStart", { periodStart })
      .andWhere("execution.createdAt <= :periodEnd", { periodEnd });

    const total = await baseQuery.getCount();
    const statusRows = await baseQuery
      .clone()
      .select("execution.status", "key")
      .addSelect("COUNT(*)", "count")
      .groupBy("execution.status")
      .getRawMany<{ key: string; count: string }>();
    const agentRows = await baseQuery
      .clone()
      .select("execution.agentType", "key")
      .addSelect("COUNT(*)", "count")
      .groupBy("execution.agentType")
      .getRawMany<{ key: string; count: string }>();
    const averageRow = await baseQuery
      .clone()
      .select("AVG(execution.executionTimeMs)", "average")
      .getRawOne<{ average?: string }>();

    const byStatus = this.rowsToCountMap(statusRows);
    const successful = byStatus[ExecutionStatus.SUCCESS] ?? 0;
    const failed =
      (byStatus[ExecutionStatus.FAILED] ?? 0) +
      (byStatus[ExecutionStatus.TIMEOUT] ?? 0);

    return {
      total,
      successRate: total > 0 ? (successful / total) * 100 : 0,
      failureRate: total > 0 ? (failed / total) * 100 : 0,
      averageExecutionTimeMs: Number.parseFloat(averageRow?.average ?? "0"),
      byStatus,
      byAgentType: this.rowsToCountMap(agentRows),
    };
  }

  private async getAuditSummary(
    periodStart: Date,
    periodEnd: Date
  ): Promise<OperatorReport["audit"]> {
    const baseQuery = this.auditRepository
      .createQueryBuilder("audit")
      .where("audit.createdAt >= :periodStart", { periodStart })
      .andWhere("audit.createdAt <= :periodEnd", { periodEnd });

    const totalEvents = await baseQuery.getCount();
    const actionRows = await baseQuery
      .clone()
      .select("audit.action", "key")
      .addSelect("COUNT(*)", "count")
      .groupBy("audit.action")
      .getRawMany<{ key: string; count: string }>();
    const byAction = this.rowsToCountMap(actionRows);

    const contractActions = await baseQuery
      .clone()
      .andWhere("audit.resource LIKE :contractResource", {
        contractResource: "contract:%",
      })
      .getCount();
    const securityEvents = await baseQuery
      .clone()
      .andWhere("audit.severity IN (:...severities)", {
        severities: ["warning", "critical"],
      })
      .getCount();

    return {
      totalEvents,
      dataExports: byAction[AuditAction.DATA_EXPORT] ?? 0,
      contractActions,
      securityEvents,
      byAction,
    };
  }

  private async getBotSessionSummary(
    asOf: Date
  ): Promise<OperatorReport["botSessions"]> {
    const active = await this.botSessionRepository
      .createQueryBuilder("session")
      .where("session.isActive = :isActive", { isActive: true })
      .andWhere("(session.expiresAt IS NULL OR session.expiresAt > :asOf)", {
        asOf,
      })
      .getCount();
    const expired = await this.botSessionRepository
      .createQueryBuilder("session")
      .where("session.expiresAt IS NOT NULL")
      .andWhere("session.expiresAt <= :asOf", { asOf })
      .getCount();
    const platformRows = await this.botSessionRepository
      .createQueryBuilder("session")
      .select("session.platform", "key")
      .addSelect("COUNT(*)", "count")
      .groupBy("session.platform")
      .getRawMany<{ key: string; count: string }>();

    return {
      active,
      expired,
      byPlatform: this.rowsToCountMap(platformRows),
    };
  }

  private rowsToCountMap(
    rows: Array<{ key: string; count: string }>
  ): Record<string, number> {
    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.key] = Number.parseInt(row.count, 10);
      return acc;
    }, {});
  }
}

export const operatorReportingService = new OperatorReportingService();
