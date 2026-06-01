import { Asset, Operation, Server, Keypair, Account } from "stellar-sdk";
import {
  hasValidStellarTrustline,
  findZeroBalanceTrustlines,
  buildTrustlineRemovalOps,
  TrustlineInfo,
} from "../trustline";

// Mock the Server but use real Asset and Operation from stellar-sdk
const mockCall = jest.fn();
const mockServerInstance: any = {
  accounts: () => ({ accountId: () => ({ call: mockCall }) }),
};

jest.mock("stellar-sdk", () => {
  const original = jest.requireActual("stellar-sdk");
  return {
    ...original,
    Server: jest.fn(() => mockServerInstance),
  };
});

describe("trustline helper functions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("hasValidStellarTrustline", () => {
    it("returns true for native asset regardless of balances", async () => {
      const res = await hasValidStellarTrustline(undefined, "GABC123", "XLM");
      expect(res.exists).toBe(true);
      expect(res.authorized).toBe(true);
    });

    it("handles missing trustline", async () => {
      mockCall.mockResolvedValueOnce({ balances: [] });
      const res = await hasValidStellarTrustline(
        undefined,
        "GABC123",
        "TOKEN",
        "GISSUER"
      );
      expect(res.exists).toBe(false);
      expect(res.authorized).toBe(false);
    });

    it("returns details when trustline present and authorized flag parsed", async () => {
      mockCall.mockResolvedValueOnce({
        balances: [
          {
            asset_code: "TOKEN",
            asset_issuer: "GISSUER",
            balance: "10",
            authorized: false,
          },
        ],
      });
      const res = await hasValidStellarTrustline(
        undefined,
        "GABC123",
        "TOKEN",
        "GISSUER"
      );
      expect(res.exists).toBe(true);
      expect(res.authorized).toBe(false);
      expect(res.details).toBeDefined();
    });
  });

  describe("findZeroBalanceTrustlines", () => {
    it("filters out native trustlines and non-zero balances", async () => {
      mockCall.mockResolvedValueOnce({
        balances: [
          { asset_type: "native", balance: "100" },
          {
            asset_type: "credit_alphanum4",
            asset_code: "ABC",
            asset_issuer: "ISS",
            balance: "0.00000",
          },
          {
            asset_type: "credit_alphanum4",
            asset_code: "XYZ",
            asset_issuer: "ISS",
            balance: "5.0",
          },
        ],
      });

      const result = await findZeroBalanceTrustlines(undefined, "G123");
      expect(result).toEqual([
        { assetCode: "ABC", assetIssuer: "ISS", balance: "0.00000" },
      ]);
    });

    it("returns empty array when no zero-balance trustlines", async () => {
      mockCall.mockResolvedValueOnce({
        balances: [
          {
            asset_type: "credit_alphanum4",
            asset_code: "FOO",
            asset_issuer: "ISS",
            balance: "1",
          },
        ],
      });
      const result = await findZeroBalanceTrustlines(undefined, "G123");
      expect(result).toEqual([]);
    });
  });

  describe("buildTrustlineRemovalOps", () => {
    it("produces an empty array when given no trustlines", () => {
      const ops = buildTrustlineRemovalOps([]);
      expect(ops).toEqual([]);
    });
  });
});
