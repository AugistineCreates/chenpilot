import * as StellarSdk from "@stellar/stellar-sdk";

const TEST_CONTRACT_ID = "CABC1234567890";

describe("Soroban Service invokeContract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SOROBAN_RPC_URL_TESTNET;
    delete process.env.SOROBAN_RPC_URL_MAINNET;
  });

  it("uses default testnet RPC URL and passphrase", async () => {
    process.env.SOROBAN_RPC_URL_TESTNET = "https://rpc-testnet.example";
    const { invokeContract } =
      await import("../../src/services/sorobanService");

    await invokeContract({
      network: "testnet",
      contractId: TEST_CONTRACT_ID,
      method: "ping",
      args: [],
    });

    expect(StellarSdk.SorobanRpc.Server).toHaveBeenCalledWith(
      "https://rpc-testnet.example",
      expect.any(Object)
    );

    const builderArgs = (StellarSdk.TransactionBuilder as jest.Mock).mock
      .calls[0][1];
    expect(builderArgs.networkPassphrase).toBe(StellarSdk.Networks.TESTNET);
  });

  it("uses default mainnet RPC URL and passphrase", async () => {
    process.env.SOROBAN_RPC_URL_MAINNET = "https://rpc-mainnet.example";
    const { invokeContract } =
      await import("../../src/services/sorobanService");

    await invokeContract({
      network: "mainnet",
      contractId: TEST_CONTRACT_ID,
      method: "ping",
      args: [],
    });

    expect(StellarSdk.SorobanRpc.Server).toHaveBeenCalledWith(
      "https://rpc-mainnet.example",
      expect.any(Object)
    );

    const builderArgs = (StellarSdk.TransactionBuilder as jest.Mock).mock
      .calls[0][1];
    expect(builderArgs.networkPassphrase).toBe(StellarSdk.Networks.PUBLIC);
  });

  it("rejects missing contractId", async () => {
    const { invokeContract } =
      await import("../../src/services/sorobanService");

    await expect(
      invokeContract({
        network: "testnet",
        contractId: "",
        method: "ping",
      })
    ).rejects.toThrow("contractId");
  });

  it("rejects missing method", async () => {
    const { invokeContract } =
      await import("../../src/services/sorobanService");

    await expect(
      invokeContract({
        network: "testnet",
        contractId: TEST_CONTRACT_ID,
        method: "",
      })
    ).rejects.toThrow("method");
  });

  it("returns expected result shape", async () => {
    const { invokeContract } =
      await import("../../src/services/sorobanService");

    const result = await invokeContract({
      network: "testnet",
      contractId: TEST_CONTRACT_ID,
      method: "ping",
      args: [1, "two"],
    });

    expect(result).toEqual(
      expect.objectContaining({
        network: "testnet",
        contractId: TEST_CONTRACT_ID,
        method: "ping",
        result: "mock_scval",
      })
    );
    expect(result.raw).toBeDefined();
  });
});
