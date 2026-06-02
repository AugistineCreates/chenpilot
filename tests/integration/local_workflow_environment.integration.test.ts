import {
  createDeterministicSimulationConfig,
  LocalChainManager,
} from "../../src/simulation/LocalChainManager";

describe("Deterministic local workflow environment", () => {
  it("runs repeatable Soroban and wallet workflow simulations from fixtures", async () => {
    const first = new LocalChainManager();
    const second = new LocalChainManager();

    await first.initialize(createDeterministicSimulationConfig());
    await second.initialize(createDeterministicSimulationConfig());

    const request = {
      service: "soroban" as const,
      operation: "invoke_contract",
      parameters: {
        network: "testnet",
        contractId: "CLOCALDETERMINISTIC0000000000000000000000000000000001",
        method: "balance",
        args: ["GLOCALACCOUNT0000000000000000000000000000000000000000001"],
      },
      userId: "integration-user-1",
      timestamp: 1,
    };

    const firstResult = await first.getSimulationEngine().processRequest(request);
    const secondResult = await second.getSimulationEngine().processRequest(request);

    expect(first.isEnabled).toBe(true);
    expect(first.getMetrics()).toMatchObject({ initialized: true, mode: "local" });
    expect(firstResult.success).toBe(true);
    expect(secondResult.success).toBe(true);
    expect(firstResult.data).toEqual(secondResult.data);
    expect(firstResult.metadata.simulatedGas).toEqual(
      secondResult.metadata.simulatedGas
    );
  });
});
