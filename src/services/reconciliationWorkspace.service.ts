import { DriftItem, ReconciliationReport } from "./reconciliation.service";

export type InvestigationStatus = "unresolved" | "assigned" | "verified_repair" | "dismissed";

export interface OperatorActor {
  id: string;
  roles: string[];
}

export interface InvestigationHistoryEntry {
  id: string;
  action: string;
  actorId: string;
  at: Date;
  details: Record<string, unknown>;
}

export interface ReconciliationCase {
  id: string;
  reportId: string;
  driftItem: DriftItem;
  walletId?: string;
  transactionId?: string;
  assignedTo?: string;
  status: InvestigationStatus;
  evidence: Array<{ id: string; uri: string; sha256: string; addedBy: string; addedAt: Date }>;
  history: InvestigationHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export class ReconciliationWorkspaceService {
  private cases = new Map<string, ReconciliationCase>();

  createCasesFromReport(report: ReconciliationReport): ReconciliationCase[] {
    return report.driftItems.map((driftItem) => {
      const now = new Date();
      const investigation: ReconciliationCase = {
        id: crypto.randomUUID(),
        reportId: report.id,
        driftItem,
        walletId: report.scope.walletAddress,
        transactionId: driftItem.type.includes("transaction") ? driftItem.entityId : undefined,
        status: "unresolved",
        evidence: [],
        history: [
          {
            id: crypto.randomUUID(),
            action: "case_created",
            actorId: "system",
            at: now,
            details: { driftType: driftItem.type, severity: driftItem.severity },
          },
        ],
        createdAt: now,
        updatedAt: now,
      };
      this.cases.set(investigation.id, investigation);
      return this.clone(investigation);
    });
  }

  listCases(filters: {
    status?: InvestigationStatus;
    assignedTo?: string;
    walletId?: string;
    transactionId?: string;
  } = {}): ReconciliationCase[] {
    return [...this.cases.values()]
      .filter((item) => !filters.status || item.status === filters.status)
      .filter((item) => !filters.assignedTo || item.assignedTo === filters.assignedTo)
      .filter((item) => !filters.walletId || item.walletId === filters.walletId)
      .filter((item) => !filters.transactionId || item.transactionId === filters.transactionId)
      .map((item) => this.clone(item));
  }

  assign(caseId: string, assigneeId: string, actor: OperatorActor): ReconciliationCase {
    this.assertOperator(actor);
    const item = this.requireCase(caseId);
    item.assignedTo = assigneeId;
    item.status = "assigned";
    this.appendHistory(item, "assigned", actor.id, { assigneeId });
    return this.save(item);
  }

  attachEvidence(
    caseId: string,
    evidence: { uri: string; sha256: string },
    actor: OperatorActor,
  ): ReconciliationCase {
    this.assertOperator(actor);
    const item = this.requireCase(caseId);
    item.evidence.push({
      id: crypto.randomUUID(),
      uri: evidence.uri,
      sha256: evidence.sha256,
      addedBy: actor.id,
      addedAt: new Date(),
    });
    this.appendHistory(item, "evidence_attached", actor.id, evidence);
    return this.save(item);
  }

  resolve(
    caseId: string,
    status: Extract<InvestigationStatus, "verified_repair" | "dismissed">,
    resolution: string,
    actor: OperatorActor,
  ): ReconciliationCase {
    this.assertOperator(actor);
    const item = this.requireCase(caseId);
    item.status = status;
    this.appendHistory(item, "resolved", actor.id, { status, resolution });
    return this.save(item);
  }

  private assertOperator(actor: OperatorActor): void {
    if (!actor.roles.includes("operator") && !actor.roles.includes("admin")) {
      throw new Error("Operator permission required");
    }
  }

  private requireCase(caseId: string): ReconciliationCase {
    const item = this.cases.get(caseId);
    if (!item) throw new Error("Reconciliation case not found");
    return this.clone(item);
  }

  private appendHistory(
    item: ReconciliationCase,
    action: string,
    actorId: string,
    details: Record<string, unknown>,
  ): void {
    item.history.push({ id: crypto.randomUUID(), action, actorId, at: new Date(), details });
    item.updatedAt = new Date();
  }

  private save(item: ReconciliationCase): ReconciliationCase {
    this.cases.set(item.id, this.clone(item));
    return this.clone(item);
  }

  private clone(item: ReconciliationCase): ReconciliationCase {
    return {
      ...item,
      evidence: item.evidence.map((evidence) => ({ ...evidence })),
      history: item.history.map((entry) => ({ ...entry, details: { ...entry.details } })),
    };
  }
}

export const reconciliationWorkspaceService = new ReconciliationWorkspaceService();
