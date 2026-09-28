import { TransactionDisputeService } from "../../src/services/transactionDispute.service";

describe("TransactionDisputeService", () => {
  it("deduplicates reports, redacts evidence, and tracks user-visible progress", () => {
    const service = new TransactionDisputeService();
    const first = service.report({
      userId: "user-1",
      transactionId: "tx-1",
      workflowId: "workflow-1",
      evidence: "Bearer abc.def and SA234567890123456789012345678901234567890123456789012345",
    });
    const duplicate = service.report({
      userId: "user-1",
      transactionId: "tx-1",
      workflowId: "workflow-1",
    });

    expect(duplicate.id).toBe(first.id);
    expect(first.evidence[0].redactedText).toContain("Bearer [REDACTED_TOKEN]");
    expect(first.evidence[0].redactedText).toContain("[REDACTED_SECRET_KEY]");

    expect(() =>
      service.assign(first.id, "investigator-1", { id: "user-2", roles: ["user"] }),
    ).toThrow("Investigator access required");

    service.assign(first.id, "investigator-1", {
      id: "admin-1",
      roles: ["admin"],
    });
    service.resolve(first.id, "resolved", "refund issued outside ledger mutation", {
      id: "investigator-1",
      roles: ["investigator"],
    });

    const progress = service.getVisibleProgress(first.id, { id: "user-1", roles: ["user"] });
    expect(progress.status).toBe("resolved");
    expect(progress.transitions.map((transition) => transition.to)).toEqual([
      "open",
      "investigating",
      "resolved",
    ]);
  });
});
