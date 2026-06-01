import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { MultiHopPathFinder } from "../../src/services/multiHopPathFinder";
import * as StellarSdk from "@stellar/stellar-sdk";

jest.mock("@stellar/stellar-sdk");

describe("MultiHopPathFinder", () => {
  let pathFinder: MultiHopPathFinder;
  let mockServer: any;

  beforeEach(() => {
    mockServer = {
      strictSendPaths: jest.fn().mockReturnThis(),
      strictReceivePaths: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn(),
    };

    (StellarSdk.Horizon.Server as any) = jest.fn(() => mockServer);
    pathFinder = new MultiHopPathFinder();
  });

  describe("findOptimalPath", () => {
    it("should find and evaluate multiple trading paths", async () => {
      const mockPaths = {
        records: [
          {
            source_amount: "100.0000000",
            destination_amount: "12.5000000",
            path: [
              {
                asset_type: "credit_alphanum4",
                asset_code: "USDC",
                asset_issuer:
                  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
              },
            ],
          },
          {
            source_amount: "100.0000000",
            destination_amount: "12.3000000",
            path: [
              {
                asset_type: "credit_alphanum4",
                asset_code: "USDT",
                asset_issuer:
                  "GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V",
              },
            ],
          },
        ],
      };

      mockServer.call.mockResolvedValue(mockPaths);

      const sourceAsset = StellarSdk.Asset.native();
      const destAsset = new StellarSdk.Asset(
        "USDC",
        "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
      );

      const result = await pathFinder.findOptimalPath(
        sourceAsset,
        destAsset,
        "100",
        { maxHops: 3 }
      );

      expect(result.bestPath).toBeDefined();
      expect(result.allPaths.length).toBeGreaterThan(0);
      expect(result.bestPath.efficiency).toBeGreaterThan(0);
      expect(result.evaluationTime).toBeGreaterThan(0);
    });

    it("should select path with highest efficiency", async () => {
      const mockPaths = {
        records: [
          {
            source_amount: "100.0000000",
            destination_amount: "15.0000000",
            path: [],
          },
          {
            source_amount: "100.0000000",
            destination_amount: "14.5000000",
            path: [
              {
                asset_type: "credit_alphanum4",
                asset_code: "USDC",
                asset_issuer:
                  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
              },
            ],
          },
        ],
      };

      mockServer.call.mockResolvedValue(mockPaths);

      const sourceAsset = StellarSdk.Asset.native();
      const destAsset = new StellarSdk.Asset(
        "USDT",
        "GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V"
      );

      const result = await pathFinder.findOptimalPath(
        sourceAsset,
        destAsset,
        "100"
      );

      expect(
        parseFloat(result.bestPath.destinationAmount)
      ).toBeGreaterThanOrEqual(
        parseFloat(result.allPaths[1]?.destinationAmount || "0")
      );
    });

    it("should filter paths by max hops", async () => {
      const mockPaths = {
        records: [
          {
            source_amount: "100.0000000",
            destination_amount: "12.0000000",
            path: [],
          },
          {
            source_amount: "100.0000000",
            destination_amount: "12.5000000",
            path: [
              {
                asset_type: "credit_alphanum4",
                asset_code: "USDC",
                asset_issuer: "ISSUER1",
              },
              {
                asset_type: "credit_alphanum4",
                asset_code: "USDT",
                asset_issuer: "ISSUER2",
              },
              {
                asset_type: "credit_alphanum4",
                asset_code: "BTC",
                asset_issuer: "ISSUER3",
              },
            ],
          },
        ],
      };

      mockServer.call.mockResolvedValue(mockPaths);

      const sourceAsset = StellarSdk.Asset.native();
      const destAsset = new StellarSdk.Asset("USDC", "ISSUER");

      const result = await pathFinder.findOptimalPath(
        sourceAsset,
        destAsset,
        "100",
        { maxHops: 2 }
      );

      result.allPaths.forEach((path) => {
        expect(path.hops).toBeLessThanOrEqual(2);
      });
    });

    it("should throw error when no paths found", async () => {
      mockServer.call.mockResolvedValue({ records: [] });

      const sourceAsset = StellarSdk.Asset.native();
      const destAsset = new StellarSdk.Asset("UNKNOWN", "ISSUER");

      await expect(
        pathFinder.findOptimalPath(sourceAsset, destAsset, "100")
      ).rejects.toThrow("No valid trading paths found");
    });
  });

  describe("comparePaths", () => {
    it("should prefer path with higher efficiency", () => {
      const path1 = {
        path: [],
        sourceAmount: "100",
        destinationAmount: "12",
        priceImpact: 1,
        estimatedSlippage: 0.001,
        hops: 2,
        route: ["XLM", "USDC"],
        efficiency: 11.5,
      };

      const path2 = {
        path: [],
        sourceAmount: "100",
        destinationAmount: "11",
        priceImpact: 1.5,
        estimatedSlippage: 0.002,
        hops: 3,
        route: ["XLM", "USDT", "USDC"],
        efficiency: 10.2,
      };

      const better = pathFinder.comparePaths(path1, path2);
      expect(better.efficiency).toBe(11.5);
    });

    it("should prefer fewer hops when efficiency is equal", () => {
      const path1 = {
        path: [],
        sourceAmount: "100",
        destinationAmount: "12",
        priceImpact: 1,
        estimatedSlippage: 0.001,
        hops: 2,
        route: ["XLM", "USDC"],
        efficiency: 11.0,
      };

      const path2 = {
        path: [],
        sourceAmount: "100",
        destinationAmount: "12",
        priceImpact: 1,
        estimatedSlippage: 0.001,
        hops: 3,
        route: ["XLM", "USDT", "USDC"],
        efficiency: 11.0,
      };

      const better = pathFinder.comparePaths(path1, path2);
      expect(better.hops).toBe(2);
    });
  });
});
