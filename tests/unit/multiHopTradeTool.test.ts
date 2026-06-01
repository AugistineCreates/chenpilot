import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { MultiHopTradeTool } from "../../src/Agents/tools/multiHopTradeTool";
import * as multiHopModule from "../../src/services/multiHopPathFinder";
import * as StellarSdk from "@stellar/stellar-sdk";

jest.mock("../../src/services/multiHopPathFinder");
jest.mock("@stellar/stellar-sdk");
jest.mock("../../src/Auth/accounts.json", () => [
  {
    userId: "user-1",
    secretKey: "SCZANGBA5RLKJRDNKPNM5VGDKQNQXQZQNQXQZQNQXQZQNQXQZQNQXQZ",
    publicKey: "GABC123",
  },
]);

const mockFindOptimalPath = multiHopModule.multiHopPathFinder
  .findOptimalPath as jest.Mock;

const GOOD_PATH: multiHopModule.TradePath = {
  path: [],
  sourceAmount: "100.0000000",
  destinationAmount: "12.5000000",
  priceImpact: 0.3,
  estimatedSlippage: 0.003,
  hops: 1,
  route: ["XLM", "USDC"],
  efficiency: 0.97,
};

const GOOD_RESULT: multiHopModule.PathEvaluationResult = {
  bestPath: GOOD_PATH,
  allPaths: [GOOD_PATH],
  evaluationTime: 42,
  timestamp: Date.now(),
};

describe("MultiHopTradeTool", () => {
  let tool: MultiHopTradeTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new MultiHopTradeTool();
  });

  // ---------------------------------------------------------------------------
  // evaluate operation
  // ---------------------------------------------------------------------------

  describe("operation=evaluate", () => {
    it("returns success with serialized best path", async () => {
      mockFindOptimalPath.mockResolvedValue(GOOD_RESULT);

      const result = await tool.execute(
        {
          operation: "evaluate",
          fromAsset: "XLM",
          toAsset: "USDC",
          amount: 100,
        },
        "user-1"
      );

      expect(result.status).toBe("success");
      expect(result.action).toBe("multi_hop_evaluate");
      expect(result.data?.bestPath).toBeDefined();
      const best = result.data?.bestPath as Record<string, unknown>;
      expect(best.route).toEqual(["XLM", "USDC"]);
      expect(best.hops).toBe(1);
      expect(typeof best.efficiency).toBe("number");
    });

    it("includes policyApplied in the response", async () => {
      mockFindOptimalPath.mockResolvedValue(GOOD_RESULT);

      const result = await tool.execute(
        {
          operation: "evaluate",
          fromAsset: "XLM",
          toAsset: "USDC",
          amount: 100,
          policy: { minEfficiency: 0.8 },
        },
        "user-1"
      );

      expect(result.status).toBe("success");
      const policy = result.data?.policyApplied as Record<string, unknown>;
      expect(policy.minEfficiency).toBe(0.8);
    });

    it("returns error when policy is violated", async () => {
      mockFindOptimalPath.mockRejectedValue(
        new multiHopModule.RoutePolicyViolationError(
          "efficiency 0.50 < required 0.70",
          GOOD_PATH
        )
      );

      const result = await tool.execute(
        {
          operation: "evaluate",
          fromAsset: "XLM",
          toAsset: "USDC",
          amount: 100,
        },
        "user-1"
      );

      expect(result.status).toBe("error");
      expect(result.error).toMatch(/policy violation/i);
      expect((result.data as Record<string, unknown>)?.policyViolation).toBe(
        true
      );
      expect(
        (result.data as Record<string, unknown>)?.bestAvailablePath
      ).toBeDefined();
    });

    it("returns error when no paths found", async () => {
      mockFindOptimalPath.mockRejectedValue(
        new Error("No valid trading paths found")
      );

      const result = await tool.execute(
        {
          operation: "evaluate",
          fromAsset: "XLM",
          toAsset: "USDC",
          amount: 100,
        },
        "user-1"
      );

      expect(result.status).toBe("error");
      expect(result.error).toMatch(/No valid trading paths/);
    });
  });

  // ---------------------------------------------------------------------------
  // execute operation
  // ---------------------------------------------------------------------------

  describe("operation=execute", () => {
    it("submits transaction and returns txHash on success", async () => {
      mockFindOptimalPath.mockResolvedValue(GOOD_RESULT);

      const mockKeypair = {
        publicKey: jest.fn().mockReturnValue("GABC123"),
        sign: jest.fn(),
      };
      (StellarSdk.Keypair.fromSecret as jest.Mock).mockReturnValue(mockKeypair);

      const mockAccount = { id: "GABC123", sequence: "1" };
      const mockServer = {
        loadAccount: jest.fn().mockResolvedValue(mockAccount),
        submitTransaction: jest.fn().mockResolvedValue({
          hash: "abc123txhash",
          successful: true,
          ledger: 1000,
        }),
      };
      (StellarSdk.Horizon.Server as unknown as jest.Mock).mockImplementation(
        () => mockServer
      );

      const mockTx = { sign: jest.fn() };
      const mockBuilder = {
        addOperation: jest.fn().mockReturnThis(),
        setTimeout: jest.fn().mockReturnThis(),
        build: jest.fn().mockReturnValue(mockTx),
      };
      (
        StellarSdk.TransactionBuilder as unknown as jest.Mock
      ).mockImplementation(() => mockBuilder);
      (StellarSdk.Operation.pathPaymentStrictSend as jest.Mock).mockReturnValue(
        {}
      );

      // Re-instantiate after mocking
      tool = new MultiHopTradeTool();

      const result = await tool.execute(
        {
          operation: "execute",
          fromAsset: "XLM",
          toAsset: "USDC",
          amount: 100,
        },
        "user-1"
      );

      expect(result.status).toBe("success");
      expect(result.action).toBe("multi_hop_execute");
      expect(result.data?.txHash).toBe("abc123txhash");
      expect(result.data?.successful).toBe(true);
    });

    it("returns error when policy is violated before execution", async () => {
      mockFindOptimalPath.mockRejectedValue(
        new multiHopModule.RoutePolicyViolationError(
          "slippage 6.00% > max 5.00%",
          GOOD_PATH
        )
      );

      const result = await tool.execute(
        {
          operation: "execute",
          fromAsset: "XLM",
          toAsset: "USDC",
          amount: 100,
        },
        "user-1"
      );

      expect(result.status).toBe("error");
      expect((result.data as Record<string, unknown>)?.policyViolation).toBe(
        true
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Input validation
  // ---------------------------------------------------------------------------

  describe("input validation", () => {
    it("rejects same source and destination asset", async () => {
      const result = await tool.execute(
        {
          operation: "evaluate",
          fromAsset: "XLM",
          toAsset: "XLM",
          amount: 100,
        },
        "user-1"
      );

      expect(result.status).toBe("error");
      expect(result.error).toMatch(/different/i);
    });

    it("rejects unsupported asset", async () => {
      const result = await tool.execute(
        {
          operation: "evaluate",
          fromAsset: "BTC",
          toAsset: "USDC",
          amount: 100,
        },
        "user-1"
      );

      expect(result.status).toBe("error");
      expect(result.error).toMatch(/unsupported asset/i);
    });

    it("rejects unknown operation", async () => {
      const result = await tool.execute(
        {
          operation: "unknown" as "evaluate",
          fromAsset: "XLM",
          toAsset: "USDC",
          amount: 100,
        },
        "user-1"
      );

      expect(result.status).toBe("error");
      expect(result.error).toMatch(/unknown operation/i);
    });
  });
});
