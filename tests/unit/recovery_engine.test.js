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
const src_1 = require("../../packages/sdk/src");
const types_1 = require("../../packages/sdk/src/types");
describe("RecoveryEngine (focused)", () => {
  const baseContext = {
    lockTxId: "lock123",
    amount: "0.1",
    fromChain: types_1.ChainId.BITCOIN,
    toChain: types_1.ChainId.STELLAR,
    destinationAddress: "GDESTINATION",
  };
  it("retries mint and succeeds", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const engine = (0, src_1.createRecoveryEngine)({
        maxRetries: 3,
        retryDelayMs: 1,
        retryHandler: {
          retryMint: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              return {
                actionTaken: types_1.RecoveryAction.RETRY_MINT,
                success: true,
                message: "mint ok",
              };
            }),
        },
      });
      const res = yield engine.cleanup(baseContext);
      expect(res.success).toBe(true);
      expect(res.actionTaken).toBe(types_1.RecoveryAction.RETRY_MINT);
    }));
  it("exhausts retries then refunds lock", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      let attempts = 0;
      const engine = (0, src_1.createRecoveryEngine)({
        maxRetries: 1,
        retryDelayMs: 1,
        retryHandler: {
          retryMint: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              attempts++;
              return {
                actionTaken: types_1.RecoveryAction.RETRY_MINT,
                success: false,
                message: "fail",
              };
            }),
        },
        refundHandler: {
          refundLock: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              return {
                actionTaken: types_1.RecoveryAction.REFUND_LOCK,
                success: true,
                message: "refunded",
              };
            }),
        },
      });
      const res = yield engine.cleanup(baseContext);
      expect(attempts).toBeGreaterThanOrEqual(1);
      expect(res.success).toBe(true);
      expect(res.actionTaken).toBe(types_1.RecoveryAction.REFUND_LOCK);
    }));
  it("requires manual intervention when no handlers configured", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const engine = (0, src_1.createRecoveryEngine)({
        maxRetries: 1,
        retryDelayMs: 1,
      });
      const res = yield engine.cleanup(baseContext);
      expect(res.success).toBe(false);
      expect(res.actionTaken).toBe(types_1.RecoveryAction.MANUAL_INTERVENTION);
    }));
});
