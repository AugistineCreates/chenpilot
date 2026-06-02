import {
  ContractClient,
  createContractBinding,
  decodeObject,
} from "../contractClient";

function mockFetch(result: unknown): jest.MockedFunction<typeof fetch> {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ result }),
  } as Response);
}

describe("ContractClient", () => {
  it("decodes query results with a typed decoder", async () => {
    type VaultState = { admin: string; paused: boolean };
    const fetcher = mockFetch({ result: { admin: "GADMIN", paused: false } });
    const client = new ContractClient({
      network: "testnet",
      fetcher,
    });

    const result = await client.query<VaultState>({
      contractId: "CCONTRACT",
      method: "state",
      decoder: decodeObject<VaultState>(["admin", "paused"]),
    });

    expect(result.decoded.admin).toBe("GADMIN");
    expect(result.compatibility.compatible).toBe(true);
  });

  it("surfaces fees, auth entries, warnings, and approval checkpoints", async () => {
    const fetcher = mockFetch({
      result: { retval: "ok", auth: [{ address: "GUSER" }] },
      minResourceFee: "1200",
      transactionData: "AAAA",
      warnings: [{ code: "large_fee", message: "Fee exceeds policy" }],
    });
    const client = new ContractClient({ network: "testnet", fetcher });

    const result = await client.simulate({
      contractId: "CCONTRACT",
      method: "withdraw",
      args: ["100"],
      decoder: (value) => String(value),
    });

    expect(result.decoded).toBe("ok");
    expect(result.feeEstimate.minResourceFee).toBe("1200");
    expect(result.authEntries).toHaveLength(1);
    expect(result.transactionDataXdr).toBe("AAAA");
    expect(result.approvalRequirements.map((r) => r.checkpoint)).toEqual([
      "fee",
      "auth",
      "manual",
    ]);
  });

  it("sends idempotency keys during execution", async () => {
    const fetcher = mockFetch({ hash: "txhash", status: "PENDING" });
    const client = new ContractClient({ network: "testnet", fetcher });

    const result = await client.execute({
      contractId: "CCONTRACT",
      method: "deposit",
      signedTransactionXdr: "SIGNED_XDR",
      idempotencyKey: "deposit-1",
    });

    expect(result.status).toBe("PENDING");
    expect(result.hash).toBe("txhash");
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "Idempotency-Key": "deposit-1" }),
      })
    );
  });

  it("adds compatibility warnings for unsupported networks", async () => {
    const fetcher = mockFetch({ result: { admin: "GADMIN" } });
    const client = new ContractClient({
      network: "mainnet",
      fetcher,
      compatibility: { supportedNetworks: ["testnet"] },
    });

    const result = await client.query({
      contractId: "CCONTRACT",
      method: "admin",
    });

    expect(result.compatibility.compatible).toBe(false);
    expect(result.compatibility.warnings[0]).toContain("mainnet");
  });

  it("creates typed query and simulation bindings", async () => {
    const fetcher = mockFetch({ result: { retval: 7 } });
    const client = new ContractClient({ network: "testnet", fetcher });
    const vault = createContractBinding(client, {
      balance: {
        contractId: "CCONTRACT",
        method: "balance",
        kind: "query",
        decoder: (value) => Number(value),
      },
      previewWithdraw: {
        contractId: "CCONTRACT",
        method: "withdraw",
        kind: "simulate",
        decoder: (value) => Number(value),
      },
    } as const);

    await expect(vault.balance("GUSER")).resolves.toMatchObject({ decoded: 7 });
    await expect(vault.previewWithdraw("100")).resolves.toMatchObject({
      decoded: 7,
    });
  });
});
