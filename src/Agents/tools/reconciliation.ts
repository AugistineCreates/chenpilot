import { BaseTool } from "./base/BaseTool";
import { ToolMetadata, ToolResult } from "../registry/ToolMetadata";
import {
  reconciliationService,
  ReconciliationScope,
} from "../../services/reconciliation.service";
import logger from "../../config/logger";

interface ReconciliationPayload extends Record<string, unknown> {
  operation: "run" | "get_reports";
  scope?: {
    transactions?: boolean;
    balances?: boolean;
    contractState?: boolean;
    walletAddress?: string;
    contractIds?: string[];
    network?: "testnet" | "mainnet";
  };
  limit?: number;
}

export class ReconciliationTool extends BaseTool<ReconciliationPayload> {
  metadata: ToolMetadata = {
    name: "reconciliation_tool",
    description:
      "Detect and surface drift between backend records and on-chain reality. Checks transaction status, wallet balances, and contract state for inconsistencies.",
    parameters: {
      operation: {
        type: "string",
        description: "Operation to perform",
        required: true,
        enum: ["run", "get_reports"],
      },
      scope: {
        type: "object",
        description:
          "Reconciliation scope: which checks to run and against which entities",
        required: false,
      },
      limit: {
        type: "number",
        description: "Number of past reports to retrieve (for get_reports)",
        required: false,
        min: 1,
        max: 50,
      },
    },
    examples: [
      "Run reconciliation to check if my transactions match on-chain",
      "Check for balance drift on my wallet",
      "Show me recent reconciliation reports",
      "Reconcile contract state for contract CXXX",
    ],
    category: "diagnostics",
    version: "1.0.0",
  };

  async execute(
    payload: ReconciliationPayload,
    userId: string
  ): Promise<ToolResult> {
    switch (payload.operation) {
      case "run":
        return this.runReconciliation(payload, userId);
      case "get_reports":
        return this.getReports(payload, userId);
      default:
        return this.createErrorResult(
          "reconciliation",
          `Unknown operation: ${payload.operation}`
        );
    }
  }

  private async runReconciliation(
    payload: ReconciliationPayload,
    userId: string
  ): Promise<ToolResult> {
    try {
      logger.info("Running reconciliation", { userId, scope: payload.scope });

      const scope: ReconciliationScope = {
        transactions: payload.scope?.transactions ?? true,
        balances: payload.scope?.balances ?? false,
        contractState: payload.scope?.contractState ?? false,
        walletAddress: payload.scope?.walletAddress,
        contractIds: payload.scope?.contractIds,
        network: payload.scope?.network ?? "testnet",
      };

      const report = await reconciliationService.reconcile(userId, scope);

      const summary =
        report.status === "clean"
          ? "No drift detected — backend records match on-chain state."
          : `Drift detected: ${report.summary.critical} critical, ${report.summary.major} major, ${report.summary.minor} minor issues found.`;

      return this.createSuccessResult("reconciliation_run", {
        reportId: report.id,
        status: report.status,
        summary,
        driftCount: report.summary.total,
        driftItems: report.driftItems.map((d) => ({
          type: d.type,
          severity: d.severity,
          entityId: d.entityId,
          description: d.description,
          repairAction: d.repairAction,
        })),
        completedAt: report.completedAt,
      });
    } catch (err) {
      logger.error("ReconciliationTool run failed", { err, userId });
      return this.createErrorResult(
        "reconciliation_run",
        err instanceof Error ? err.message : "Reconciliation failed"
      );
    }
  }

  private async getReports(
    payload: ReconciliationPayload,
    userId: string
  ): Promise<ToolResult> {
    try {
      const limit = typeof payload.limit === "number" ? payload.limit : 10;
      const reports = await reconciliationService.getReports(userId, limit);

      return this.createSuccessResult("reconciliation_reports", {
        count: reports.length,
        reports: reports.map((r) => ({
          id: r.id,
          status: r.status,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          driftCount: r.summary.total,
          summary: r.summary,
        })),
      });
    } catch (err) {
      logger.error("ReconciliationTool get_reports failed", { err, userId });
      return this.createErrorResult(
        "reconciliation_reports",
        err instanceof Error ? err.message : "Failed to fetch reports"
      );
    }
  }
}

export const reconciliationTool = new ReconciliationTool();
