import { SorobanContractStateTool } from "../../src/Agents/tools/sorobanContractState";
import * as sorobanService from "../../src/services/sorobanService";
import { YieldBloxAdapter } from "../../src/Agents/tools/defi/YieldBloxAdapter";

jest.mock("../../src/services/sorobanService");
jest.mock("../../src/config/logger");

describe("SorobanContractStateTool", () => {
  let tool: SorobanContractStateTool;
  const mockInvokeContract =
    sorobanService.invokeContract as jest.MockedFunction<
      typeof sorobanService.invokeContract
    >;

  beforeEach(() => {
    tool = new SorobanContractStateTool();
    jest.clearAllMocks();
  });

  describe("Metadata", () => {
    it("should have correct tool metadata", () => {
      expect(tool.metadata.name).toBe("soroban_contract_state");
      expect(tool.metadata.category).toBe("soroban");
      expect(tool.metadata.description).toContain("DeFi decision making");
      expect(tool.metadata.parameters.contractId.required).toBe(true);
    });

    it("should have DeFi-focused examples", () => {
      expect(tool.metadata.examples.length).toBeGreaterThan(0);
      expect(tool.metadata.examples.some((ex) => ex.includes("reserves"))).toBe(
        true
      );
    });
  });

  describe("Query Specific Methods", () => {
    it("should query specified contract methods", async () => {
      mockInvokeContract
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CTEST123",
          method: "get_reserves",
          result: { token0: "1000000", token1: "2000000" },
        })
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CTEST123",
          method: "get_fee",
          result: 30,
        });

      const result = await tool.execute(
        {
          contractId: "CTEST123",
          network: "testnet",
          methods: ["get_reserves", "get_fee"],
        },
        "user-123"
      );

      expect(result.status).toBe("success");
      expect(result.data?.state).toHaveProperty("get_reserves");
      expect(result.data?.state).toHaveProperty("get_fee");
      expect(mockInvokeContract).toHaveBeenCalledTimes(2);
    });

    it("should handle method query failures gracefully", async () => {
      mockInvokeContract
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CTEST123",
          method: "total_supply",
          result: "1000000000",
        })
        .mockRejectedValueOnce(new Error("Method not found"));

      const result = await tool.execute(
        {
          contractId: "CTEST123",
          methods: ["total_supply", "invalid_method"],
        },
        "user-123"
      );

      expect(result.status).toBe("success");
      expect(result.data?.state).toHaveProperty("total_supply");
      expect(result.data?.methods?.invalid_method).toHaveProperty("error");
    });
  });

  describe("Query State Keys", () => {
    it("should map state keys to contract methods", async () => {
      mockInvokeContract.mockResolvedValue({
        network: "testnet",
        contractId: "CTEST123",
        method: "get_reserves",
        result: { token0: "1000000", token1: "2000000" },
      });

      const result = await tool.execute(
        {
          contractId: "CTEST123",
          stateKeys: ["reserves"],
        },
        "user-123"
      );

      expect(result.status).toBe("success");
      expect(result.data?.state).toHaveProperty("reserves");
      expect(mockInvokeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "get_reserves",
        })
      );
    });

    it("should query multiple state keys", async () => {
      mockInvokeContract
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CTEST123",
          method: "total_supply",
          result: "1000000000",
        })
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CTEST123",
          method: "decimals",
          result: 7,
        });

      const result = await tool.execute(
        {
          contractId: "CTEST123",
          stateKeys: ["totalSupply", "decimals"],
        },
        "user-123"
      );

      expect(result.status).toBe("success");
      expect(result.data?.state).toHaveProperty("totalSupply");
      expect(result.data?.state).toHaveProperty("decimals");
    });
  });

  describe("Common DeFi State Queries", () => {
    it("should query common DeFi methods when no specific queries provided", async () => {
      mockInvokeContract.mockImplementation(async (params) => ({
        network: params.network,
        contractId: params.contractId,
        method: params.method,
        result: params.method === "total_supply" ? "1000000000" : null,
      }));

      const result = await tool.execute(
        {
          contractId: "CTEST123",
        },
        "user-123"
      );

      expect(result.status).toBe("success");
      expect(mockInvokeContract).toHaveBeenCalled();
      expect(result.data?.state).toBeDefined();
    });

    it("should handle partial success in common queries", async () => {
      let callCount = 0;
      mockInvokeContract.mockImplementation(async (params) => {
        callCount++;
        if (callCount === 1) {
          return {
            network: params.network,
            contractId: params.contractId,
            method: params.method,
            result: "1000000000",
          };
        }
        throw new Error("Method not available");
      });

      const result = await tool.execute(
        {
          contractId: "CTEST123",
        },
        "user-123"
      );

      expect(result.status).toBe("success");
      expect(Object.keys(result.data?.state || {}).length).toBeGreaterThan(0);
    });
  });

  describe("Contract Metadata", () => {
    it("should query contract metadata when requested", async () => {
      mockInvokeContract
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CTEST123",
          method: "admin",
          result: "GADMIN123",
        })
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CTEST123",
          method: "version",
          result: "1.0.0",
        });

      const result = await tool.execute(
        {
          contractId: "CTEST123",
          methods: [],
          includeMetadata: true,
        },
        "user-123"
      );

      expect(result.status).toBe("success");
      expect(result.data?.metadata).toBeDefined();
      expect(result.data?.metadata?.admin).toBe("GADMIN123");
      expect(result.data?.metadata?.version).toBe("1.0.0");
    });

    it("should handle missing metadata gracefully", async () => {
      mockInvokeContract.mockRejectedValue(new Error("Method not found"));

      const result = await tool.execute(
        {
          contractId: "CTEST123",
          methods: [],
          includeMetadata: true,
        },
        "user-123"
      );

      expect(result.status).toBe("success");
      expect(result.data?.metadata).toBeDefined();
    });
  });

  describe("Network Configuration", () => {
    it("should use testnet by default", async () => {
      mockInvokeContract.mockResolvedValue({
        network: "testnet",
        contractId: "CTEST123",
        method: "total_supply",
        result: "1000000000",
      });

      await tool.execute(
        {
          contractId: "CTEST123",
          methods: ["total_supply"],
        },
        "user-123"
      );

      expect(mockInvokeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          network: "testnet",
        })
      );
    });

    it("should use specified network", async () => {
      mockInvokeContract.mockResolvedValue({
        network: "mainnet",
        contractId: "CTEST123",
        method: "total_supply",
        result: "1000000000",
      });

      await tool.execute(
        {
          contractId: "CTEST123",
          network: "mainnet",
          methods: ["total_supply"],
        },
        "user-123"
      );

      expect(mockInvokeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          network: "mainnet",
        })
      );
    });

    it("should pass custom RPC URL", async () => {
      mockInvokeContract.mockResolvedValue({
        network: "testnet",
        contractId: "CTEST123",
        method: "total_supply",
        result: "1000000000",
      });

      await tool.execute(
        {
          contractId: "CTEST123",
          rpcUrl: "https://custom-rpc.example.com",
          methods: ["total_supply"],
        },
        "user-123"
      );

      expect(mockInvokeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          rpcUrl: "https://custom-rpc.example.com",
        })
      );
    });
  });

  describe("DeFi Protocol Specific Queries", () => {
    it("should query liquidity pool state", async () => {
      mockInvokeContract
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CPOOL123",
          method: "get_reserves",
          result: { reserve0: "1000000", reserve1: "2000000" },
        })
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CPOOL123",
          method: "total_supply",
          result: "500000",
        })
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CPOOL123",
          method: "get_price",
          result: "2.0",
        })
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CPOOL123",
          method: "get_fee",
          result: 30,
        });

      const state = await tool.queryDeFiProtocol("CPOOL123", "pool");

      expect(state).toHaveProperty("reserves");
      expect(state).toHaveProperty("totalSupply");
      expect(state).toHaveProperty("price");
      expect(state).toHaveProperty("fee");
    });

    it("should query lending protocol state", async () => {
      mockInvokeContract
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CLEND123",
          method: "total_supply",
          result: "10000000",
        })
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CLEND123",
          method: "total_borrow",
          result: "5000000",
        })
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CLEND123",
          method: "utilization_rate",
          result: "0.5",
        })
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CLEND123",
          method: "interest_rate",
          result: "0.05",
        })
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CLEND123",
          method: "collateral_factor",
          result: "0.75",
        });

      const state = await tool.queryDeFiProtocol("CLEND123", "lending");

      expect(state).toHaveProperty("totalSupply");
      expect(state).toHaveProperty("totalBorrow");
      expect(state).toHaveProperty("utilizationRate");
      expect(state).toHaveProperty("interestRate");
      expect(state).toHaveProperty("collateralFactor");
    });

    it("should query token state", async () => {
      mockInvokeContract
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CTOKEN123",
          method: "total_supply",
          result: "1000000000",
        })
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CTOKEN123",
          method: "balance",
          result: "100000",
        })
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CTOKEN123",
          method: "allowance",
          result: "50000",
        })
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CTOKEN123",
          method: "decimals",
          result: 7,
        })
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CTOKEN123",
          method: "name",
          result: "Test Token",
        })
        .mockResolvedValueOnce({
          network: "testnet",
          contractId: "CTOKEN123",
          method: "symbol",
          result: "TEST",
        });

      const state = await tool.queryDeFiProtocol("CTOKEN123", "token");

      expect(state).toHaveProperty("totalSupply");
      expect(state).toHaveProperty("decimals");
      expect(state).toHaveProperty("name");
      expect(state).toHaveProperty("symbol");
    });
  });

  describe("Error Handling", () => {
    it("should return error result when contract query fails completely", async () => {
      mockInvokeContract.mockRejectedValue(new Error("Contract not found"));

      const result = await tool.execute(
        {
          contractId: "CINVALID",
          methods: ["total_supply"],
        },
        "user-123"
      );

      expect(result.status).toBe("error");
      expect(result.error).toContain("Failed to query contract state");
    });

    it("should include contract ID in error result", async () => {
      mockInvokeContract.mockRejectedValue(new Error("Network error"));

      const result = await tool.execute(
        {
          contractId: "CTEST123",
          methods: ["total_supply"],
        },
        "user-123"
      );

      expect(result.status).toBe("error");
      expect(result.data?.contractId).toBe("CTEST123");
    });
  });

  describe("Result Format", () => {
    it("should include timestamp in result", async () => {
      mockInvokeContract.mockResolvedValue({
        network: "testnet",
        contractId: "CTEST123",
        method: "total_supply",
        result: "1000000000",
      });

      const result = await tool.execute(
        {
          contractId: "CTEST123",
          methods: ["total_supply"],
        },
        "user-123"
      );

      expect(result.status).toBe("success");
      expect(result.data?.timestamp).toBeDefined();
      expect(
        new Date(result.data?.timestamp as string).getTime()
      ).toBeGreaterThan(0);
    });

    it("should include network in result", async () => {
      mockInvokeContract.mockResolvedValue({
        network: "mainnet",
        contractId: "CTEST123",
        method: "total_supply",
        result: "1000000000",
      });

      const result = await tool.execute(
        {
          contractId: "CTEST123",
          network: "mainnet",
          methods: ["total_supply"],
        },
        "user-123"
      );

      expect(result.status).toBe("success");
      expect(result.data?.network).toBe("mainnet");
    });

    it("should include contract ID in result", async () => {
      mockInvokeContract.mockResolvedValue({
        network: "testnet",
        contractId: "CTEST123",
        method: "total_supply",
        result: "1000000000",
      });

      const result = await tool.execute(
        {
          contractId: "CTEST123",
          methods: ["total_supply"],
        },
        "user-123"
      );

      expect(result.status).toBe("success");
      expect(result.data?.contractId).toBe("CTEST123");
    });
  });
});

describe("YieldBloxAdapter — borrowing position net value", () => {
  let adapter: YieldBloxAdapter;

  beforeEach(() => {
    adapter = new YieldBloxAdapter();
    // @ts-expect-error — reach into protected config to enable borrowing
    adapter.config = {
      ...adapter.config,
      capabilities: { lending: false, borrowing: true, swap: false, liquidity: false },
    };
  });

  it("computes netValueUSD as valueUSD minus accruedCostUSD", async () => {
    // @ts-expect-error — stub protected method
    adapter.fetchWithSchema = jest.fn().mockResolvedValue({
      positions: [
        {
          token: "USDC",
          borrowed: "500",
          valueUSD: 500,
          borrowAPY: 0.08,
          accruedInterestUSD: 12.5,
        },
      ],
    });

    const result = await adapter.getBorrowingPositions("GADDR");

    expect(result.success).toBe(true);
    const pos = result.data![0];
    expect(pos.accruedCostUSD).toBe(12.5);
    expect(pos.netValueUSD).toBe(500 - 12.5);
  });

  it("omits netValueUSD and accruedCostUSD when accruedInterestUSD is absent", async () => {
    // @ts-expect-error
    adapter.fetchWithSchema = jest.fn().mockResolvedValue({
      positions: [
        { token: "USDC", borrowed: "500", valueUSD: 500, borrowAPY: 0.08 },
      ],
    });

    const result = await adapter.getBorrowingPositions("GADDR");

    expect(result.success).toBe(true);
    const pos = result.data![0];
    expect(pos.accruedCostUSD).toBeUndefined();
    expect(pos.netValueUSD).toBeUndefined();
  });

  it("netValueUSD is negative when accrued costs exceed position value", async () => {
    // @ts-expect-error
    adapter.fetchWithSchema = jest.fn().mockResolvedValue({
      positions: [
        {
          token: "USDC",
          borrowed: "100",
          valueUSD: 100,
          borrowAPY: 0.5,
          accruedInterestUSD: 110,
        },
      ],
    });

    const result = await adapter.getBorrowingPositions("GADDR");

    expect(result.success).toBe(true);
    const pos = result.data![0];
    expect(pos.netValueUSD).toBe(100 - 110);
    expect(pos.netValueUSD).toBeLessThan(0);
  });
});
