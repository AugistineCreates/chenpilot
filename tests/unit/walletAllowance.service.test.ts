import { WalletAllowanceService } from "../../src/Authorization/walletAllowance.service";

describe("WalletAllowanceService", () => {
  const activeWindow = {
    periodStart: new Date("2026-01-01T00:00:00Z"),
    periodEnd: new Date("2026-02-01T00:00:00Z"),
  };

  it("prevents concurrent reservations from overspending one grant", async () => {
    const service = new WalletAllowanceService();
    await service.createGrant({
      id: "grant-1",
      walletId: "wallet-1",
      asset: "USDC",
      amount: "100",
      status: "active",
      ...activeWindow,
    });

    const attempts = await Promise.allSettled(
      Array.from({ length: 3 }, (_, index) =>
        service.reserve({
          grantId: "grant-1",
          walletId: "wallet-1",
          asset: "USDC",
          amount: "40",
          workflowId: `workflow-${index}`,
          now: new Date("2026-01-15T00:00:00Z"),
        }),
      ),
    );

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(2);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect(service.getAuditSnapshot("grant-1").reserved).toBe("80");
  });

  it("rejects expired and revoked grants", async () => {
    const service = new WalletAllowanceService();
    await service.createGrant({
      id: "grant-1",
      walletId: "wallet-1",
      asset: "USDC",
      amount: "100",
      status: "active",
      ...activeWindow,
    });

    await expect(
      service.reserve({
        grantId: "grant-1",
        walletId: "wallet-1",
        asset: "USDC",
        amount: "10",
        workflowId: "workflow-expired",
        now: new Date("2026-02-02T00:00:00Z"),
      }),
    ).rejects.toThrow("expired");

    service.revokeGrant("grant-1");
    await expect(
      service.reserve({
        grantId: "grant-1",
        walletId: "wallet-1",
        asset: "USDC",
        amount: "10",
        workflowId: "workflow-revoked",
        now: new Date("2026-01-15T00:00:00Z"),
      }),
    ).rejects.toThrow("revoked");
  });

  it("keeps ambiguous submissions reserved and audits settled and released amounts", async () => {
    const service = new WalletAllowanceService();
    await service.createGrant({
      id: "grant-1",
      walletId: "wallet-1",
      asset: "USDC",
      amount: "100",
      status: "active",
      ...activeWindow,
    });

    const ambiguous = await service.reserve({
      grantId: "grant-1",
      walletId: "wallet-1",
      asset: "USDC",
      amount: "30",
      workflowId: "workflow-ambiguous",
      transactionId: "tx-ambiguous",
      now: new Date("2026-01-15T00:00:00Z"),
    });
    const settled = await service.reserve({
      grantId: "grant-1",
      walletId: "wallet-1",
      asset: "USDC",
      amount: "20",
      workflowId: "workflow-settled",
      now: new Date("2026-01-15T00:00:00Z"),
    });
    const released = await service.reserve({
      grantId: "grant-1",
      walletId: "wallet-1",
      asset: "USDC",
      amount: "10",
      workflowId: "workflow-released",
      now: new Date("2026-01-15T00:00:00Z"),
    });

    service.settle(settled.id);
    service.release(released.id);

    const audit = service.getAuditSnapshot("grant-1");
    expect(audit.reserved).toBe("30");
    expect(audit.settled).toBe("20");
    expect(audit.released).toBe("10");
    expect(audit.reservations.find((reservation) => reservation.id === ambiguous.id)?.status).toBe("reserved");
  });
});
