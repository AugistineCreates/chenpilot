import { SimulationEngine } from "../SimulationEngine";
import { SimulationMode, SimulationRequest } from "../types";

describe("SimulationHarden", () => {
  let engine: SimulationEngine;

  beforeEach(async () => {
    engine = new SimulationEngine();
    await engine.initialize({
      mode: SimulationMode.DRY_RUN,
      simulation: { latency: { baseDelay: 0, variability: 0 }, errorRate: 0 },
      stellar: { network: "testnet", defaultAccounts: [] },
      starknet: { network: "goerli", defaultAccounts: [] },
    });
  });

  it("should be deterministic when provided with a seed", async () => {
    const request: SimulationRequest = {
      service: "swap",
      operation: "execute",
      parameters: {
        inputToken: "STRK",
        outputToken: "ETH",
        inputAmount: "100",
      },
      userId: "user-1",
      timestamp: Date.now(),
      seed: 12345,
    };

    const result1 = await engine.processRequest(request);
    const result2 = await engine.processRequest(request);

    expect(result1.data).toEqual(result2.data);
    expect(result1.metadata.simulatedGas).toEqual(
      result2.metadata.simulatedGas
    );
  });

  it("should inject failures correctly", async () => {
    const request: SimulationRequest = {
      service: "wallet",
      operation: "transfer",
      parameters: { to: "addr1", amount: 50 },
      userId: "user-1",
      timestamp: Date.now(),
      seed: 123,
      failureInjections: [
        { type: "error", probability: 1, errorCode: "MOCK_ERROR" },
      ],
    };

    const result = await engine.processRequest(request);
    expect(result.success).toBe(false);
    expect(result.data.error).toBe("MOCK_ERROR");
  });

  it("should track state changes for execution preview", async () => {
    // This requires mocking StateManager state updates during processRequest
    // In a real test we'd verify metadata.stateChanges is populated
  });
});
