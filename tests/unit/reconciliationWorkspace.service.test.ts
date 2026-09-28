import { ReconciliationReport } from "../../src/services/reconciliation.service";
import { ReconciliationWorkspaceService } from "../../src/services/reconciliationWorkspace.service";

describe("ReconciliationWorkspaceService", () => {
  const report: ReconciliationReport = {
    id: "report-1",
    userId: "user-1",
    scope: { transactions: true, walletAddress: "wallet-1" },
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status: "drifted",
    summary: { total: 1, critical: 1, major: 0, minor: 0, none: 0 },
    driftItems: [
      {
        type: "transaction_missing",
        severity: "critical",
        entityId: "tx-1",
        backendValue: "submitted",
        onChainValue: null,
        description: "missing",
        detectedAt: new Date().toISOString(),
      },
    ],
  };

  it("filters cases, enforces operator permission, and preserves immutable history", () => {
    const service = new ReconciliationWorkspaceService();
    const [created] = service.createCasesFromReport(report);

    expect(service.listCases({ status: "unresolved" })).toHaveLength(1);
    expect(() =>
      service.assign(created.id, "operator-1", { id: "user-1", roles: ["user"] }),
    ).toThrow("Operator permission required");

    const assigned = service.assign(created.id, "operator-1", {
      id: "admin-1",
      roles: ["admin"],
    });
    const withEvidence = service.attachEvidence(
      created.id,
      { uri: "s3://evidence/1", sha256: "abc" },
      { id: "operator-1", roles: ["operator"] },
    );
    const resolved = service.resolve(
      created.id,
      "verified_repair",
      "transaction repaired",
      { id: "operator-1", roles: ["operator"] },
    );

    expect(assigned.status).toBe("assigned");
    expect(withEvidence.evidence).toHaveLength(1);
    expect(resolved.status).toBe("verified_repair");
    expect(resolved.transactionId).toBe("tx-1");
    expect(resolved.walletId).toBe("wallet-1");
    expect(resolved.history.map((entry) => entry.action)).toEqual([
      "case_created",
      "assigned",
      "evidence_attached",
      "resolved",
    ]);
  });
});
