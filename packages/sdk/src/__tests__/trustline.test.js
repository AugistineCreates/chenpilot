"use strict";
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done
          ? resolve(result.value)
          : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
Object.defineProperty(exports, "__esModule", { value: true });
const trustline_1 = require("../trustline");
// Mock the Server but use real Asset and Operation from stellar-sdk
const mockCall = jest.fn();
const mockServerInstance = {
  accounts: () => ({ accountId: () => ({ call: mockCall }) }),
};
jest.mock("stellar-sdk", () => {
  const original = jest.requireActual("stellar-sdk");
  return Object.assign(Object.assign({}, original), {
    Server: jest.fn(() => mockServerInstance),
  });
});
describe("trustline helper functions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  describe("hasValidStellarTrustline", () => {
    it("returns true for native asset regardless of balances", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, trustline_1.hasValidStellarTrustline)(
          undefined,
          "GABC123",
          "XLM"
        );
        expect(res.exists).toBe(true);
        expect(res.authorized).toBe(true);
      }));
    it("handles missing trustline", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        mockCall.mockResolvedValueOnce({ balances: [] });
        const res = yield (0, trustline_1.hasValidStellarTrustline)(
          undefined,
          "GABC123",
          "TOKEN",
          "GISSUER"
        );
        expect(res.exists).toBe(false);
        expect(res.authorized).toBe(false);
      }));
    it("returns details when trustline present and authorized flag parsed", () =>
      __awaiter(void 0, void 0, void 0, function* () {
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
        const res = yield (0, trustline_1.hasValidStellarTrustline)(
          undefined,
          "GABC123",
          "TOKEN",
          "GISSUER"
        );
        expect(res.exists).toBe(true);
        expect(res.authorized).toBe(false);
        expect(res.details).toBeDefined();
      }));
  });
  describe("findZeroBalanceTrustlines", () => {
    it("filters out native trustlines and non-zero balances", () =>
      __awaiter(void 0, void 0, void 0, function* () {
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
        const result = yield (0, trustline_1.findZeroBalanceTrustlines)(
          undefined,
          "G123"
        );
        expect(result).toEqual([
          { assetCode: "ABC", assetIssuer: "ISS", balance: "0.00000" },
        ]);
      }));
    it("returns empty array when no zero-balance trustlines", () =>
      __awaiter(void 0, void 0, void 0, function* () {
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
        const result = yield (0, trustline_1.findZeroBalanceTrustlines)(
          undefined,
          "G123"
        );
        expect(result).toEqual([]);
      }));
  });
  describe("buildTrustlineRemovalOps", () => {
    it("produces an empty array when given no trustlines", () => {
      const ops = (0, trustline_1.buildTrustlineRemovalOps)([]);
      expect(ops).toEqual([]);
    });
  });
});
