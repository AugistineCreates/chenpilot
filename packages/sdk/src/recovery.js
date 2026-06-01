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
exports.RecoveryEngine = void 0;
exports.createRecoveryEngine = createRecoveryEngine;
const types_1 = require("./types");
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Engine responsible for handling recovery and cleanup of cross-chain operations.
 * It manages retrying steps or refunding locked assets upon failures.
 */
class RecoveryEngine {
  constructor(options) {
    var _a, _b;
    this.maxRetries =
      (_a =
        options === null || options === void 0
          ? void 0
          : options.maxRetries) !== null && _a !== void 0
        ? _a
        : 3;
    this.retryDelayMs =
      (_b =
        options === null || options === void 0
          ? void 0
          : options.retryDelayMs) !== null && _b !== void 0
        ? _b
        : 2000;
    this.retryHandler =
      options === null || options === void 0 ? void 0 : options.retryHandler;
    this.refundHandler =
      options === null || options === void 0 ? void 0 : options.refundHandler;
  }
  /**
   * Attempts to clean up a failed operation by either retrying the mint
   * or refunding the locked assets based on configured handlers.
   *
   * @param context - The context of the failed operation.
   * @returns A promise resolving to the result of the recovery attempt.
   */
  cleanup(context) {
    return __awaiter(this, void 0, void 0, function* () {
      var _a, _b;
      // 1) Attempt retries of the mint step if a retry handler is provided
      if (
        (_a = this.retryHandler) === null || _a === void 0
          ? void 0
          : _a.retryMint
      ) {
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
          try {
            const res = yield this.retryHandler.retryMint(context);
            if (res && res.success) {
              return {
                actionTaken: types_1.RecoveryAction.RETRY_MINT,
                success: true,
                message: `Mint retry succeeded on attempt ${attempt}`,
                details: res.details || {},
              };
            }
            // if handler returned failure, wait and retry
          } catch (_c) {
            // swallow and retry
          }
          if (attempt < this.maxRetries) yield delay(this.retryDelayMs);
        }
      }
      // 2) If retries exhausted or not configured, attempt refund of the lock
      if (
        (_b = this.refundHandler) === null || _b === void 0
          ? void 0
          : _b.refundLock
      ) {
        try {
          const refundRes = yield this.refundHandler.refundLock(context);
          if (refundRes && refundRes.success) {
            return {
              actionTaken: types_1.RecoveryAction.REFUND_LOCK,
              success: true,
              message: `Refund executed`,
              details: refundRes.details || {},
            };
          }
          return {
            actionTaken: types_1.RecoveryAction.MANUAL_INTERVENTION,
            success: false,
            message: `Refund handler executed but reported failure: ${(refundRes === null || refundRes === void 0 ? void 0 : refundRes.message) || "unknown"}`,
            details:
              (refundRes === null || refundRes === void 0
                ? void 0
                : refundRes.details) || {},
          };
        } catch (error) {
          const msg = String(error);
          return {
            actionTaken: types_1.RecoveryAction.MANUAL_INTERVENTION,
            success: false,
            message: `Refund handler threw an error: ${msg}`,
          };
        }
      }
      // 3) No handlers available — signal manual intervention required
      return {
        actionTaken: types_1.RecoveryAction.MANUAL_INTERVENTION,
        success: false,
        message:
          "No retry or refund handlers configured; manual intervention required.",
      };
    });
  }
}
exports.RecoveryEngine = RecoveryEngine;
/**
 * Factory function to create a new RecoveryEngine instance.
 *
 * @param options - Configuration options for the engine.
 * @returns A new RecoveryEngine instance.
 */
function createRecoveryEngine(options) {
  return new RecoveryEngine(options);
}
