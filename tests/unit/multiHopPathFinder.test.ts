import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import {
  MultiHopPathFinder,
  RoutePolicyViolationError,
  PolicyViolation,
  DEFAULT_ROUTE_POLICY,
  RoutePolicy,
} from "../../src/services/multiHopPathFinder";
import * as StellarSdk from "@stellar/stellar-sdk";

jest.mock("@stellar/stellar-sdk");

const XLM = StellarSdk.Asset.native();
const USDC = new StellarSdk.Asset(
  "USDC",
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
);

function makeRecord(destAmount: string, midAssets: unknown[] = []) {
  return {
    source_amount: "100.0000000",
    destination_amount: destAmount,
    path: midAssets,
  };
}

describe("MultiHopPathFinder", () => {
  let pathFinder: MultiHopPathFinder;
  let mockServer: {
    strictSendPaths: jest.Mock;
    strictReceivePaths: jest.Mock;
    limit: jest.Mock;
    call: jest.Mock;
  };

  beforeEach(() => {
    mockServer = {
      strictSendPaths: jest.fn().mockReturnThis(),
      strictReceivePaths: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn(),
    };
    (StellarSdk.Horizon.Server as unknown as jest.Mock).mockImplementation(
      () => mockServer
    );
    pathFinder = new MultiHopPathFinder();
  });

  describe("findOptimalPath — basic evaluation", () => {
    it("returns a result with normalized efficiency in [0,1]", async () => {
      mockServer.call.mockResolvedValue({
        records: [makeRecord("12.5000000"), makeRecord("11.0000000")],
      });

      const result = await pathFinder.findOptimalPath(XLM, USDC, "100", {
        policy: { minEfficiency: 0, maxSlippage: 1, maxHops: 10 },
      });

      expect(result.bestPath.efficiency).toBeGreaterThanOrEqual(0);
      expect(result.bestPath.efficiency).toBeLessThanOrEqual(1);
      expect(
        result.allPaths.every((p) => p.efficiency >= 0 && p.efficiency <= 1)
      ).toBe(true);
    });

    it("selects the path with highest destination amount as best", async () => {
      mockServer.call.mockResolvedValue({
        records: [makeRecord("10.0000000"), makeRecord("15.0000000")],
      });

      const result = await pathFinder.findOptimalPath(XLM, USDC, "100", {
        policy: { minEfficiency: 0, maxSlippage: 1, maxHops: 10 },
      });

      expect(parseFloat(result.bestPath.destinationAmount)).toBe(15.0);
    });

    it("evaluationTime is a positive number", async () => {
      mockServer.call.mockResolvedValue({
        records: [makeRecord("12.0000000")],
      });

      const result = await pathFinder.findOptimalPath(XLM, USDC, "100", {
        policy: { minEfficiency: 0, maxSlippage: 1, maxHops: 10 },
      });

      expect(result.evaluationTime).toBeGreaterThanOrEqual(0);
    });

    it("throws when no paths are found", async () => {
      mockServer.call.mockResolvedValue({ records: [] });

      await expect(
        pathFinder.findOptimalPath(XLM, USDC, "100")
      ).rejects.toThrow("No valid trading paths found");
    });

    it("throws on timeout", async () => {
      mockServer.call.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 500))
      );

      await expect(
        pathFinder.findOptimalPath(XLM, USDC, "100", { timeout: 50 })
      ).rejects.toThrow("timed out");
    });
  });

  describe("findOptimalPath — hop filtering", () => {
    it("excludes paths with too many intermediate hops", async () => {
      const manyHops = [
        { asset_type: "credit_alphanum4", asset_code: "A", asset_issuer: "I1" },
        { asset_type: "credit_alphanum4", asset_code: "B", asset_issuer: "I2" },
        { asset_type: "credit_alphanum4", asset_code: "C", asset_issuer: "I3" },
      ];
      mockServer.call.mockResolvedValue({
        records: [
          makeRecord("12.0000000"),           // 1 hop (direct)
          makeRecord("13.0000000", manyHops), // 4 hops — excluded when maxHops=2
        ],
      });

      const result = await pathFinder.findOptimalPath(XLM, USDC, "100", {
        maxHops: 2,
        policy: { minEfficiency: 0, maxSlippage: 1, maxHops: 10 },
      });

      result.allPaths.forEach((p) => expect(p.hops).toBeLessThanOrEqual(2));
    });
  });

  describe("findOptimalPath — deterministic tie-breaking", () => {
    it("prefers fewer hops when efficiency is equal", async () => {
      mockServer.call.mockResolvedValue({
        records: [
          makeRecord("12.0000000", [
            { asset_type: "credit_alphanum4", asset_code: "X", asset_issuer: "I" },
          ]),
          makeRecord("12.0000000"), // direct, fewer hops
        ],
      });

      const result = await pathFinder.findOptimalPath(XLM, USDC, "100", {
        policy: { minEfficiency: 0, maxSlippage: 1, maxHops: 10 },
      });

      expect(result.bestPath.hops).toBeLessThanOrEqual(
        result.allPaths.find((p) => p.hops > result.bestPath.hops)?.hops ??
          result.bestPath.hops
      );
    });
  });

  describe("RoutePolicy enforcement", () => {
    it("throws RoutePolicyViolationError when efficiency is below minEfficiency", async () => {
      mockServer.call.mockResolvedValue({
        records: [makeRecord("12.0000000")],
      });

      const strictPolicy: RoutePolicy = {
        minEfficiency: 0.999,
        maxSlippage: 1,
        maxHops: 10,
      };

      await expect(
        pathFinder.findOptimalPath(XLM, USDC, "100", { policy: strictPolicy })
      ).rejects.toThrow(RoutePolicyViolationError);
    });

    it("throws RoutePolicyViolationError when slippage exceeds maxSlippage", async () => {
      // 3-hop path: slippage = 0.003 * 3 = 0.009 = 0.9%
      const threeHops = [
        { asset_type: "credit_alphanum4", asset_code: "A", asset_issuer: "I1" },
        { asset_type: "credit_alphanum4", asset_code: "B", asset_issuer: "I2" },
      ];
      mockServer.call.mockResolvedValue({
        records: [makeRecord("12.0000000", threeHops)],
      });

      const strictPolicy: RoutePolicy = {
        minEfficiency: 0,
        maxSlippage: 0.005, // 0.5% — below the 0.9% from 3 hops
        maxHops: 10,
      };

      await expect(
        pathFinder.findOptimalPath(XLM, USDC, "100", { policy: strictPolicy })
      ).rejects.toThrow(RoutePolicyViolationError);
    });

    it("RoutePolicyViolationError exposes bestAvailable path", async () => {
      mockServer.call.mockResolvedValue({
        records: [makeRecord("12.0000000")],
      });

      const strictPolicy: RoutePolicy = {
        minEfficiency: 0.999,
        maxSlippage: 1,
        maxHops: 10,
      };

      try {
        await pathFinder.findOptimalPath(XLM, USDC, "100", {
          policy: strictPolicy,
        });
        fail("Expected RoutePolicyViolationError");
      } catch (err) {
        expect(err).toBeInstanceOf(RoutePolicyViolationError);
        expect((err as RoutePolicyViolationError).bestAvailable).toBeDefined();
        expect(
          parseFloat(
            (err as RoutePolicyViolationError).bestAvailable.destinationAmount
          )
        ).toBe(12.0);
      }
    });

    it("passes with DEFAULT_ROUTE_POLICY for a reasonable path", async () => {
      // Direct path: efficiency ≈ 0.977, slippage = 0.003, hops = 1
      // DEFAULT_ROUTE_POLICY: minEfficiency=0.7, maxSlippage=0.05, maxHops=5 → should pass
      mockServer.call.mockResolvedValue({
        records: [makeRecord("12.0000000")],
      });

      const result = await pathFinder.findOptimalPath(XLM, USDC, "100", {
        policy: DEFAULT_ROUTE_POLICY,
      });

      expect(result.bestPath).toBeDefined();
      expect(result.bestPath.efficiency).toBeGreaterThanOrEqual(
        DEFAULT_ROUTE_POLICY.minEfficiency
      );
    });

    it("violations[] contains a structured entry for each breached threshold", async () => {
      // 4-hop path: slippage = 0.012, efficiency also below 0.999 — both fail
      const threeIntermediateHops = [
        { asset_type: "credit_alphanum4", asset_code: "A", asset_issuer: "I1" },
        { asset_type: "credit_alphanum4", asset_code: "B", asset_issuer: "I2" },
        { asset_type: "credit_alphanum4", asset_code: "C", asset_issuer: "I3" },
      ];
      mockServer.call.mockResolvedValue({
        records: [makeRecord("12.0000000", threeIntermediateHops)],
      });

      const strictPolicy: RoutePolicy = {
        minEfficiency: 0.999,
        maxSlippage: 0.005,
        maxHops: 10,
      };

      try {
        await pathFinder.findOptimalPath(XLM, USDC, "100", {
          policy: strictPolicy,
        });
        fail("Expected RoutePolicyViolationError");
      } catch (err) {
        expect(err).toBeInstanceOf(RoutePolicyViolationError);
        const e = err as RoutePolicyViolationError;
        expect(e.violations.length).toBeGreaterThanOrEqual(2);
        expect(e.violations.map((v: PolicyViolation) => v.field)).toContain("efficiency");
        expect(e.violations.map((v: PolicyViolation) => v.field)).toContain("slippage");
        e.violations.forEach((v: PolicyViolation) => {
          expect(typeof v.actual).toBe("number");
          expect(typeof v.threshold).toBe("number");
          expect(typeof v.reason).toBe("string");
        });
      }
    });

    it("throws RoutePolicyViolationError when hops exceed policy maxHops", async () => {
      // 4-hop path (3 intermediate assets)
      const threeIntermediateHops = [
        { asset_type: "credit_alphanum4", asset_code: "A", asset_issuer: "I1" },
        { asset_type: "credit_alphanum4", asset_code: "B", asset_issuer: "I2" },
        { asset_type: "credit_alphanum4", asset_code: "C", asset_issuer: "I3" },
      ];
      mockServer.call.mockResolvedValue({
        records: [makeRecord("12.0000000", threeIntermediateHops)],
      });

      const strictPolicy: RoutePolicy = {
        minEfficiency: 0,
        maxSlippage: 1,
        maxHops: 2, // path has 4 hops → violation
      };

      try {
        await pathFinder.findOptimalPath(XLM, USDC, "100", {
          policy: strictPolicy,
        });
        fail("Expected RoutePolicyViolationError");
      } catch (err) {
        expect(err).toBeInstanceOf(RoutePolicyViolationError);
        const e = err as RoutePolicyViolationError;
        expect(e.violations.some((v: PolicyViolation) => v.field === "hops")).toBe(true);
        const hopsViolation = e.violations.find((v: PolicyViolation) => v.field === "hops")!;
        expect(hopsViolation.actual).toBeGreaterThan(hopsViolation.threshold);
      }
    });

    it("all-routes-fail: error carries the best candidate across all failing paths", async () => {
      mockServer.call.mockResolvedValue({
        records: [
          makeRecord("8.0000000"),
          makeRecord("12.0000000"),
          makeRecord("10.0000000"),
        ],
      });

      const strictPolicy: RoutePolicy = {
        minEfficiency: 0.999,
        maxSlippage: 1,
        maxHops: 10,
      };

      try {
        await pathFinder.findOptimalPath(XLM, USDC, "100", {
          policy: strictPolicy,
        });
        fail("Expected RoutePolicyViolationError");
      } catch (err) {
        expect(err).toBeInstanceOf(RoutePolicyViolationError);
        const e = err as RoutePolicyViolationError;
        expect(parseFloat(e.bestAvailable.destinationAmount)).toBe(12.0);
        expect(e.violations.length).toBeGreaterThan(0);
      }
    });
  });

  describe("comparePaths", () => {
    it("returns the path with higher efficiency", () => {
      const high = {
        path: [],
        sourceAmount: "100",
        destinationAmount: "15",
        priceImpact: 0.3,
        estimatedSlippage: 0.003,
        hops: 1,
        route: ["XLM", "USDC"],
        efficiency: 0.97,
      };
      const low = {
        path: [],
        sourceAmount: "100",
        destinationAmount: "12",
        priceImpact: 0.6,
        estimatedSlippage: 0.006,
        hops: 2,
        route: ["XLM", "USDT", "USDC"],
        efficiency: 0.75,
      };

      expect(pathFinder.comparePaths(high, low)).toBe(high);
      expect(pathFinder.comparePaths(low, high)).toBe(high);
    });

    it("prefers fewer hops on equal efficiency", () => {
      const direct = {
        path: [],
        sourceAmount: "100",
        destinationAmount: "12",
        priceImpact: 0.3,
        estimatedSlippage: 0.003,
        hops: 1,
        route: ["XLM", "USDC"],
        efficiency: 0.9,
      };
      const indirect = {
        path: [],
        sourceAmount: "100",
        destinationAmount: "12",
        priceImpact: 0.3,
        estimatedSlippage: 0.003,
        hops: 3,
        route: ["XLM", "A", "B", "USDC"],
        efficiency: 0.9,
      };

      expect(pathFinder.comparePaths(direct, indirect)).toBe(direct);
    });
  });
});
