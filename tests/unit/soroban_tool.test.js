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
jest.mock("../../src/services/sorobanService", () => ({
  invokeContract: jest.fn(),
}));
const soroban_1 = require("../../src/Agents/tools/soroban");
const sorobanService_1 = require("../../src/services/sorobanService");
const mockInvoke = sorobanService_1.invokeContract;
describe("SorobanTool wiring", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });
  it("calls invokeContract with expected params", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      mockInvoke.mockResolvedValue({
        network: "testnet",
        contractId: "CABC1234567890",
        method: "ping",
        result: "ok",
      });
      const result = yield soroban_1.sorobanTool.execute(
        {
          contractId: "CABC1234567890",
          method: "ping",
          network: "testnet",
          args: [1],
        },
        "user-1"
      );
      expect(mockInvoke).toHaveBeenCalledWith(
        expect.objectContaining({
          network: "testnet",
          contractId: "CABC1234567890",
          method: "ping",
          args: [1],
        })
      );
      expect(result.status).toBe("success");
    }));
  it("defaults network to testnet", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      mockInvoke.mockResolvedValue({
        network: "testnet",
        contractId: "CABC1234567890",
        method: "ping",
        result: "ok",
      });
      yield soroban_1.sorobanTool.execute(
        {
          contractId: "CABC1234567890",
          method: "ping",
        },
        "user-1"
      );
      expect(mockInvoke).toHaveBeenCalledWith(
        expect.objectContaining({
          network: "testnet",
        })
      );
    }));
  it("returns error result when service throws", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      mockInvoke.mockRejectedValue(new Error("boom"));
      const result = yield soroban_1.sorobanTool.execute(
        {
          contractId: "CABC1234567890",
          method: "ping",
          network: "testnet",
        },
        "user-1"
      );
      expect(result.status).toBe("error");
    }));
});
