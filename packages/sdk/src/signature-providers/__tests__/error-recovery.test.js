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
const types_1 = require("../../types");
const error_recovery_1 = require("../error-recovery");
const errors_1 = require("../errors");
describe("Error Recovery System", () => {
  describe("ConnectionErrorRecoveryStrategy", () => {
    let strategy;
    beforeEach(() => {
      strategy = new error_recovery_1.ConnectionErrorRecoveryStrategy();
    });
    it("should handle connection timeout errors", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const error = new errors_1.ConnectionTimeoutError("test-provider");
        expect(strategy.canRecover(error)).toBe(true);
        const result = yield strategy.recover(error, { retryCount: 0 });
        expect(result.success).toBe(false);
        expect(result.shouldRetry).toBe(true);
        expect(result.retryAfterMs).toBe(1000); // First retry
        expect(result.instructions).toContain("Connection timed out.");
      }));
    it("should use exponential backoff for timeouts", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const error = new errors_1.ConnectionTimeoutError("test-provider");
        const result1 = yield strategy.recover(error, { retryCount: 1 });
        const result2 = yield strategy.recover(error, { retryCount: 2 });
        expect(result1.retryAfterMs).toBe(2000);
        expect(result2.retryAfterMs).toBe(4000);
      }));
    it("should cap exponential backoff", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const error = new errors_1.ConnectionTimeoutError("test-provider");
        const result = yield strategy.recover(error, { retryCount: 10 });
        expect(result.retryAfterMs).toBe(10000); // Capped at 10 seconds
      }));
    it("should handle provider not found errors", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const error = new errors_1.ProviderNotFoundError("missing-provider");
        expect(strategy.canRecover(error)).toBe(false); // Not recoverable
        const result = yield strategy.recover(error);
        expect(result.success).toBe(false);
        expect(result.shouldRetry).toBe(false);
        expect(result.instructions).toContain("Wallet provider not found.");
      }));
    it("should stop retrying after max attempts", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const error = new errors_1.ConnectionTimeoutError("test-provider");
        const result = yield strategy.recover(error, {
          retryCount: 3,
          maxRetries: 3,
        });
        expect(result.success).toBe(false);
        expect(result.shouldRetry).toBe(false);
        expect(result.instructions).toContain(
          "Maximum retry attempts reached."
        );
      }));
    it("should provide recovery instructions", () => {
      const timeoutError = new errors_1.ConnectionTimeoutError("provider");
      const notFoundError = new errors_1.ProviderNotFoundError("provider");
      const timeoutInstructions =
        strategy.getRecoveryInstructions(timeoutError);
      const notFoundInstructions =
        strategy.getRecoveryInstructions(notFoundError);
      expect(timeoutInstructions).toContain("Connection timed out");
      expect(notFoundInstructions).toContain("Wallet not found");
    });
  });
  describe("AuthenticationErrorRecoveryStrategy", () => {
    let strategy;
    beforeEach(() => {
      strategy = new error_recovery_1.AuthenticationErrorRecoveryStrategy();
    });
    it("should handle user rejection errors", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const error = new errors_1.UserRejectedError("test-provider");
        expect(strategy.canRecover(error)).toBe(true);
        const result = yield strategy.recover(error);
        expect(result.success).toBe(false);
        expect(result.shouldRetry).toBe(false);
        expect(result.instructions).toContain(
          "Transaction was cancelled by user."
        );
      }));
    it("should handle generic authentication errors with retry", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const error = new errors_1.UnauthorizedError("test-provider");
        const result = yield strategy.recover(error, { retryCount: 0 });
        expect(result.success).toBe(false);
        expect(result.shouldRetry).toBe(true);
        expect(result.retryAfterMs).toBe(1000);
      }));
    it("should stop retrying auth errors after max attempts", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const error = new errors_1.UnauthorizedError("test-provider");
        const result = yield strategy.recover(error, {
          retryCount: 2,
          maxRetries: 2,
        });
        expect(result.success).toBe(false);
        expect(result.shouldRetry).toBe(false);
      }));
  });
  describe("HardwareWalletErrorRecoveryStrategy", () => {
    let strategy;
    beforeEach(() => {
      strategy = new error_recovery_1.HardwareWalletErrorRecoveryStrategy();
    });
    it("should handle device not found errors", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const error = new errors_1.DeviceNotFoundError("ledger-provider");
        expect(strategy.canRecover(error)).toBe(true);
        const result = yield strategy.recover(error);
        expect(result.success).toBe(false);
        expect(result.shouldRetry).toBe(true);
        expect(result.retryAfterMs).toBe(3000);
        expect(result.instructions).toContain("Hardware wallet not detected.");
      }));
    it("should handle device locked errors", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const error = new errors_1.DeviceLockedError("ledger-provider");
        const result = yield strategy.recover(error);
        expect(result.success).toBe(false);
        expect(result.shouldRetry).toBe(true);
        expect(result.retryAfterMs).toBe(1000);
        expect(result.instructions).toContain("Hardware wallet is locked.");
      }));
    it("should handle device busy errors", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const error = new errors_1.DeviceBusyError("ledger-provider");
        const result = yield strategy.recover(error);
        expect(result.success).toBe(false);
        expect(result.shouldRetry).toBe(true);
        expect(result.retryAfterMs).toBe(2000);
        expect(result.instructions).toContain("Hardware wallet is busy.");
      }));
    it("should handle generic hardware wallet errors", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const error = new errors_1.HardwareWalletError(
          "Generic HW error",
          "ledger-provider"
        );
        const result = yield strategy.recover(error);
        expect(result.success).toBe(false);
        expect(result.shouldRetry).toBe(true);
        expect(result.instructions).toContain(
          "Hardware wallet error occurred."
        );
      }));
  });
  describe("NetworkErrorRecoveryStrategy", () => {
    let strategy;
    beforeEach(() => {
      strategy = new error_recovery_1.NetworkErrorRecoveryStrategy();
    });
    it("should handle network errors with exponential backoff", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const error = new errors_1.NetworkError(
          "RPC timeout",
          "provider",
          types_1.ChainId.STELLAR
        );
        expect(strategy.canRecover(error)).toBe(true);
        const result1 = yield strategy.recover(error, { retryCount: 0 });
        const result2 = yield strategy.recover(error, { retryCount: 1 });
        expect(result1.shouldRetry).toBe(true);
        expect(result2.shouldRetry).toBe(true);
        expect(result2.retryAfterMs).toBeGreaterThan(result1.retryAfterMs);
      }));
    it("should include jitter in retry timing", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const error = new errors_1.NetworkError("Network error", "provider");
        const results = yield Promise.all([
          strategy.recover(error, { retryCount: 1 }),
          strategy.recover(error, { retryCount: 1 }),
          strategy.recover(error, { retryCount: 1 }),
        ]);
        // Due to jitter, retry times should vary slightly
        const retryTimes = results.map((r) => r.retryAfterMs);
        // Should have some variation due to jitter (though might occasionally be same)
        expect(retryTimes.every((t) => t >= 2000 && t <= 2500)).toBe(true);
      }));
    it("should cap retry delay", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const error = new errors_1.NetworkError("Network error", "provider");
        const result = yield strategy.recover(error, { retryCount: 10 });
        expect(result.retryAfterMs).toBeLessThanOrEqual(30000);
      }));
    it("should stop retrying after max attempts", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const error = new errors_1.NetworkError("Network error", "provider");
        const result = yield strategy.recover(error, {
          retryCount: 5,
          maxRetries: 5,
        });
        expect(result.success).toBe(false);
        expect(result.shouldRetry).toBe(false);
      }));
  });
  describe("SignatureProviderErrorRecovery", () => {
    let recovery;
    beforeEach(() => {
      recovery = new error_recovery_1.SignatureProviderErrorRecovery();
    });
    it("should find appropriate strategy for error type", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const connectionError = new errors_1.ConnectionTimeoutError("provider");
        const authError = new errors_1.UserRejectedError("provider");
        const hardwareError = new errors_1.DeviceLockedError("provider");
        const networkError = new errors_1.NetworkError(
          "Network error",
          "provider"
        );
        const connectionResult = yield recovery.recover(connectionError);
        const authResult = yield recovery.recover(authError);
        const hardwareResult = yield recovery.recover(hardwareError);
        const networkResult = yield recovery.recover(networkError);
        expect(connectionResult.instructions).toContain(
          "Connection timed out."
        );
        expect(authResult.instructions).toContain(
          "Transaction was cancelled by user."
        );
        expect(hardwareResult.instructions).toContain(
          "Hardware wallet is locked."
        );
        expect(networkResult.instructions).toContain("Network error occurred.");
      }));
    it("should handle errors without specific strategy", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const genericError = new errors_1.SigningError(
          "Generic signing error",
          "provider"
        );
        const result = yield recovery.recover(genericError);
        expect(result.success).toBe(false);
        expect(result.instructions).toContain(
          "No specific recovery strategy available."
        );
      }));
    it("should convert generic errors to SignatureProviderError", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const genericError = new Error("Generic error");
        const context = {
          providerId: "test-provider",
          chainId: types_1.ChainId.STELLAR,
        };
        const result = yield recovery.recover(genericError, context);
        expect(result.success).toBe(false);
        expect(result.shouldRetry).toBe(true); // Generic SigningError is recoverable
      }));
    it("should handle recovery strategy errors", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        // Create a faulty strategy that throws
        const faultyStrategy = {
          canRecover: () => true,
          recover: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              throw new Error("Recovery strategy failed");
            }),
          getRecoveryInstructions: () => ["Faulty instructions"],
        };
        recovery.addStrategy(faultyStrategy);
        const error = new errors_1.SigningError("Test error", "provider");
        const result = yield recovery.recover(error);
        expect(result.success).toBe(false);
        expect(result.shouldRetry).toBe(false);
        expect(result.newError).toBeDefined();
        expect(result.instructions).toContain("Error recovery failed.");
      }));
    it("should provide recovery instructions without attempting recovery", () => {
      const connectionError = new errors_1.ConnectionTimeoutError("provider");
      const unknownError = new Error("Unknown error");
      const connectionInstructions =
        recovery.getRecoveryInstructions(connectionError);
      const unknownInstructions =
        recovery.getRecoveryInstructions(unknownError);
      expect(connectionInstructions).toContain("Connection timed out");
      expect(unknownInstructions).toContain("Unknown error");
    });
    it("should check if errors are recoverable", () => {
      const recoverableError = new errors_1.ConnectionTimeoutError("provider");
      const nonRecoverableError = new errors_1.ProviderNotFoundError(
        "provider"
      );
      const unknownError = new Error("Unknown");
      expect(recovery.canRecover(recoverableError)).toBe(true);
      expect(recovery.canRecover(nonRecoverableError)).toBe(true); // Has strategy
      expect(recovery.canRecover(unknownError)).toBe(false); // No specific strategy
    });
    it("should allow adding and removing custom strategies", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const customStrategy = {
          canRecover: (error) => error.message === "custom error",
          recover: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              return {
                success: true,
                shouldRetry: false,
                instructions: ["Custom recovery successful"],
              };
            }),
          getRecoveryInstructions: () => ["Custom instructions"],
        };
        recovery.addStrategy(customStrategy);
        const customError = new errors_1.SigningError(
          "custom error",
          "provider"
        );
        const result = yield recovery.recover(customError);
        expect(result.success).toBe(true);
        expect(result.instructions).toContain("Custom recovery successful");
        // Remove strategy
        recovery.removeStrategy(customStrategy);
        const result2 = yield recovery.recover(customError);
        expect(result2.success).toBe(false);
        expect(result2.instructions).toContain(
          "No specific recovery strategy available."
        );
      }));
    it("should use global recovery instance", () => {
      expect(error_recovery_1.signatureProviderErrorRecovery).toBeInstanceOf(
        error_recovery_1.SignatureProviderErrorRecovery
      );
    });
  });
  describe("Error Recovery Context", () => {
    let recovery;
    beforeEach(() => {
      recovery = new error_recovery_1.SignatureProviderErrorRecovery();
    });
    it("should use context information in recovery", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const error = new errors_1.ConnectionTimeoutError("provider");
        const context = {
          retryCount: 2,
          maxRetries: 3,
          providerId: "test-provider",
          chainId: types_1.ChainId.STELLAR,
        };
        const result = yield recovery.recover(error, context);
        expect(result.retryAfterMs).toBe(4000); // 2^2 * 1000
      }));
    it("should handle missing context gracefully", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const error = new errors_1.ConnectionTimeoutError("provider");
        const result = yield recovery.recover(error);
        expect(result).toBeDefined();
        expect(result.shouldRetry).toBe(true);
      }));
  });
});
