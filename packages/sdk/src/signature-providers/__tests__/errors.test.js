"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const types_1 = require("../../types");
const errors_1 = require("../errors");
describe("SignatureProvider Error System", () => {
  describe("Base SignatureProviderError", () => {
    it("should create error with all properties", () => {
      const error = new errors_1.ConnectionError(
        "Test connection error",
        "test-provider",
        true
      );
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(errors_1.SignatureProviderError);
      expect(error.message).toBe("Test connection error");
      expect(error.code).toBe("CONNECTION_ERROR");
      expect(error.providerId).toBe("test-provider");
      expect(error.recoverable).toBe(true);
      expect(error.name).toBe("ConnectionError");
    });
    it("should work with instanceof checks", () => {
      const error = new errors_1.ConnectionError("Test error");
      expect(error instanceof Error).toBe(true);
      expect(error instanceof errors_1.SignatureProviderError).toBe(true);
      expect(error instanceof errors_1.ConnectionError).toBe(true);
    });
    it("should handle optional parameters", () => {
      const error = new errors_1.SigningError("Test error");
      expect(error.providerId).toBeUndefined();
      expect(error.chainId).toBeUndefined();
      expect(error.recoverable).toBe(false);
    });
  });
  describe("Connection Errors", () => {
    it("should create ConnectionError", () => {
      const error = new errors_1.ConnectionError(
        "Connection failed",
        "provider1"
      );
      expect(error.code).toBe("CONNECTION_ERROR");
      expect(error.providerId).toBe("provider1");
      expect(error.recoverable).toBe(true);
    });
    it("should create ConnectionTimeoutError", () => {
      const error = new errors_1.ConnectionTimeoutError("provider1");
      expect(error.code).toBe("CONNECTION_TIMEOUT");
      expect(error.message).toBe("Connection timeout");
      expect(error.providerId).toBe("provider1");
      expect(error.recoverable).toBe(true);
    });
    it("should create ProviderNotFoundError", () => {
      const error = new errors_1.ProviderNotFoundError("missing-provider");
      expect(error.code).toBe("PROVIDER_NOT_FOUND");
      expect(error.message).toBe("Provider not found: missing-provider");
      expect(error.providerId).toBe("missing-provider");
      expect(error.recoverable).toBe(false);
    });
  });
  describe("Authentication Errors", () => {
    it("should create AuthenticationError", () => {
      const error = new errors_1.AuthenticationError(
        "Auth failed",
        "provider1"
      );
      expect(error.code).toBe("AUTHENTICATION_ERROR");
      expect(error.providerId).toBe("provider1");
      expect(error.recoverable).toBe(true);
    });
    it("should create UserRejectedError", () => {
      const error = new errors_1.UserRejectedError("provider1");
      expect(error.code).toBe("USER_REJECTED");
      expect(error.message).toBe("User rejected the request");
      expect(error.providerId).toBe("provider1");
      expect(error.recoverable).toBe(true);
    });
    it("should create UnauthorizedError", () => {
      const error = new errors_1.UnauthorizedError("provider1");
      expect(error.code).toBe("UNAUTHORIZED");
      expect(error.message).toBe("Unauthorized access");
      expect(error.providerId).toBe("provider1");
      expect(error.recoverable).toBe(true);
    });
  });
  describe("Signing Errors", () => {
    it("should create SigningError", () => {
      const error = new errors_1.SigningError(
        "Signing failed",
        "provider1",
        types_1.ChainId.STELLAR,
        true
      );
      expect(error.code).toBe("SIGNING_ERROR");
      expect(error.providerId).toBe("provider1");
      expect(error.chainId).toBe(types_1.ChainId.STELLAR);
      expect(error.recoverable).toBe(true);
    });
    it("should create InvalidTransactionError", () => {
      const error = new errors_1.InvalidTransactionError(
        "Invalid format",
        "provider1",
        types_1.ChainId.STELLAR
      );
      expect(error.code).toBe("INVALID_TRANSACTION");
      expect(error.message).toBe("Invalid transaction: Invalid format");
      expect(error.providerId).toBe("provider1");
      expect(error.chainId).toBe(types_1.ChainId.STELLAR);
      expect(error.recoverable).toBe(false);
    });
    it("should create InsufficientFundsError", () => {
      const error = new errors_1.InsufficientFundsError(
        "provider1",
        types_1.ChainId.STARKNET
      );
      expect(error.code).toBe("INSUFFICIENT_FUNDS");
      expect(error.message).toBe("Insufficient funds for transaction");
      expect(error.providerId).toBe("provider1");
      expect(error.chainId).toBe(types_1.ChainId.STARKNET);
      expect(error.recoverable).toBe(false);
    });
    it("should create NetworkError", () => {
      const error = new errors_1.NetworkError(
        "RPC timeout",
        "provider1",
        types_1.ChainId.BITCOIN
      );
      expect(error.code).toBe("NETWORK_ERROR");
      expect(error.message).toBe("Network error: RPC timeout");
      expect(error.providerId).toBe("provider1");
      expect(error.chainId).toBe(types_1.ChainId.BITCOIN);
      expect(error.recoverable).toBe(true);
    });
  });
  describe("Capability Errors", () => {
    it("should create UnsupportedChainError", () => {
      const error = new errors_1.UnsupportedChainError(
        types_1.ChainId.BITCOIN,
        "provider1"
      );
      expect(error.code).toBe("UNSUPPORTED_CHAIN");
      expect(error.message).toBe("Unsupported chain: bitcoin");
      expect(error.providerId).toBe("provider1");
      expect(error.chainId).toBe(types_1.ChainId.BITCOIN);
      expect(error.recoverable).toBe(false);
    });
    it("should create UnsupportedOperationError", () => {
      const error = new errors_1.UnsupportedOperationError(
        "message signing",
        "provider1"
      );
      expect(error.code).toBe("UNSUPPORTED_OPERATION");
      expect(error.message).toBe("Unsupported operation: message signing");
      expect(error.providerId).toBe("provider1");
      expect(error.recoverable).toBe(false);
    });
  });
  describe("Hardware Wallet Errors", () => {
    it("should create HardwareWalletError", () => {
      const error = new errors_1.HardwareWalletError(
        "Device error",
        "ledger-provider"
      );
      expect(error.code).toBe("HARDWARE_WALLET_ERROR");
      expect(error.providerId).toBe("ledger-provider");
      expect(error.recoverable).toBe(true);
    });
    it("should create DeviceNotFoundError", () => {
      const error = new errors_1.DeviceNotFoundError("ledger-provider");
      expect(error.code).toBe("DEVICE_NOT_FOUND");
      expect(error.message).toBe("Hardware wallet device not found");
      expect(error.providerId).toBe("ledger-provider");
      expect(error.recoverable).toBe(true);
    });
    it("should create DeviceBusyError", () => {
      const error = new errors_1.DeviceBusyError("ledger-provider");
      expect(error.code).toBe("DEVICE_BUSY");
      expect(error.message).toBe("Hardware wallet device is busy");
      expect(error.providerId).toBe("ledger-provider");
      expect(error.recoverable).toBe(true);
    });
    it("should create DeviceLockedError", () => {
      const error = new errors_1.DeviceLockedError("ledger-provider");
      expect(error.code).toBe("DEVICE_LOCKED");
      expect(error.message).toBe("Hardware wallet device is locked");
      expect(error.providerId).toBe("ledger-provider");
      expect(error.recoverable).toBe(true);
    });
  });
  describe("SignatureProviderErrorUtils", () => {
    describe("isRecoverable", () => {
      it("should identify recoverable errors", () => {
        const recoverableError = new errors_1.ConnectionTimeoutError(
          "provider1"
        );
        const nonRecoverableError = new errors_1.ProviderNotFoundError(
          "provider1"
        );
        const genericError = new Error("Generic error");
        expect(
          errors_1.SignatureProviderErrorUtils.isRecoverable(recoverableError)
        ).toBe(true);
        expect(
          errors_1.SignatureProviderErrorUtils.isRecoverable(
            nonRecoverableError
          )
        ).toBe(false);
        expect(
          errors_1.SignatureProviderErrorUtils.isRecoverable(genericError)
        ).toBe(false);
      });
    });
    describe("getErrorMessage", () => {
      it("should provide user-friendly messages for recoverable errors", () => {
        const error = new errors_1.ConnectionTimeoutError("provider1");
        const message =
          errors_1.SignatureProviderErrorUtils.getErrorMessage(error);
        expect(message).toBe("Connection timeout. Please try again.");
      });
      it("should provide specific guidance for provider not found", () => {
        const error = new errors_1.ProviderNotFoundError("missing-provider");
        const message =
          errors_1.SignatureProviderErrorUtils.getErrorMessage(error);
        expect(message).toBe(
          "Provider not found: missing-provider. Please ensure the wallet is installed and enabled."
        );
      });
      it("should provide specific guidance for device not found", () => {
        const error = new errors_1.DeviceNotFoundError("ledger");
        const message =
          errors_1.SignatureProviderErrorUtils.getErrorMessage(error);
        expect(message).toBe(
          "Hardware wallet device not found. Please connect your hardware wallet and try again."
        );
      });
      it("should provide specific guidance for device locked", () => {
        const error = new errors_1.DeviceLockedError("ledger");
        const message =
          errors_1.SignatureProviderErrorUtils.getErrorMessage(error);
        expect(message).toBe(
          "Hardware wallet device is locked. Please unlock your hardware wallet and try again."
        );
      });
      it("should provide specific guidance for user rejection", () => {
        const error = new errors_1.UserRejectedError("provider1");
        const message =
          errors_1.SignatureProviderErrorUtils.getErrorMessage(error);
        expect(message).toBe(
          "User rejected the request. The operation was cancelled."
        );
      });
      it("should provide specific guidance for unsupported chain", () => {
        const error = new errors_1.UnsupportedChainError(
          types_1.ChainId.BITCOIN,
          "provider1"
        );
        const message =
          errors_1.SignatureProviderErrorUtils.getErrorMessage(error);
        expect(message).toBe(
          "Unsupported chain: bitcoin. This wallet does not support the selected blockchain."
        );
      });
      it("should handle generic SignatureProviderError", () => {
        const error = new errors_1.SigningError(
          "Custom error message",
          "provider1"
        );
        const message =
          errors_1.SignatureProviderErrorUtils.getErrorMessage(error);
        expect(message).toBe("Custom error message");
      });
      it("should handle generic Error objects", () => {
        const error = new Error("Generic error");
        const message =
          errors_1.SignatureProviderErrorUtils.getErrorMessage(error);
        expect(message).toBe("Generic error");
      });
      it("should handle unknown error types", () => {
        const error = "String error";
        const message =
          errors_1.SignatureProviderErrorUtils.getErrorMessage(error);
        expect(message).toBe("An unknown error occurred");
      });
    });
    describe("fromError", () => {
      it("should return SignatureProviderError as-is", () => {
        const originalError = new errors_1.ConnectionError(
          "Test error",
          "provider1"
        );
        const result =
          errors_1.SignatureProviderErrorUtils.fromError(originalError);
        expect(result).toBe(originalError);
      });
      it("should convert generic Error to SigningError", () => {
        const genericError = new Error("Generic error");
        const result = errors_1.SignatureProviderErrorUtils.fromError(
          genericError,
          "provider1",
          types_1.ChainId.STELLAR
        );
        expect(result).toBeInstanceOf(errors_1.SigningError);
        expect(result.message).toBe("Generic error");
        expect(result.providerId).toBe("provider1");
        expect(result.chainId).toBe(types_1.ChainId.STELLAR);
        expect(result.recoverable).toBe(true);
      });
      it("should convert unknown error to SigningError", () => {
        const unknownError = "String error";
        const result = errors_1.SignatureProviderErrorUtils.fromError(
          unknownError,
          "provider1"
        );
        expect(result).toBeInstanceOf(errors_1.SigningError);
        expect(result.message).toBe("Unknown error");
        expect(result.providerId).toBe("provider1");
        expect(result.recoverable).toBe(true);
      });
      it("should handle null/undefined errors", () => {
        const result1 = errors_1.SignatureProviderErrorUtils.fromError(null);
        const result2 =
          errors_1.SignatureProviderErrorUtils.fromError(undefined);
        expect(result1).toBeInstanceOf(errors_1.SigningError);
        expect(result1.message).toBe("Unknown error");
        expect(result2).toBeInstanceOf(errors_1.SigningError);
        expect(result2.message).toBe("Unknown error");
      });
    });
  });
  describe("Error Inheritance and Type Checking", () => {
    it("should maintain proper inheritance chain", () => {
      const connectionError = new errors_1.ConnectionTimeoutError("provider1");
      const signingError = new errors_1.InvalidTransactionError(
        "Invalid",
        "provider1",
        types_1.ChainId.STELLAR
      );
      const hardwareError = new errors_1.DeviceLockedError("ledger");
      // Check inheritance
      expect(connectionError instanceof errors_1.SignatureProviderError).toBe(
        true
      );
      expect(connectionError instanceof errors_1.ConnectionError).toBe(true);
      expect(connectionError instanceof errors_1.ConnectionTimeoutError).toBe(
        true
      );
      expect(signingError instanceof errors_1.SignatureProviderError).toBe(
        true
      );
      expect(signingError instanceof errors_1.SigningError).toBe(true);
      expect(signingError instanceof errors_1.InvalidTransactionError).toBe(
        true
      );
      expect(hardwareError instanceof errors_1.SignatureProviderError).toBe(
        true
      );
      expect(hardwareError instanceof errors_1.HardwareWalletError).toBe(true);
      expect(hardwareError instanceof errors_1.DeviceLockedError).toBe(true);
    });
    it("should allow type-specific error handling", () => {
      const errors = [
        new errors_1.ConnectionTimeoutError("provider1"),
        new errors_1.UserRejectedError("provider1"),
        new errors_1.DeviceLockedError("ledger"),
        new errors_1.InvalidTransactionError(
          "Invalid",
          "provider1",
          types_1.ChainId.STELLAR
        ),
      ];
      const connectionErrors = errors.filter(
        (e) => e instanceof errors_1.ConnectionError
      );
      const authErrors = errors.filter(
        (e) => e instanceof errors_1.AuthenticationError
      );
      const hardwareErrors = errors.filter(
        (e) => e instanceof errors_1.HardwareWalletError
      );
      const signingErrors = errors.filter(
        (e) => e instanceof errors_1.SigningError
      );
      expect(connectionErrors).toHaveLength(1);
      expect(authErrors).toHaveLength(1);
      expect(hardwareErrors).toHaveLength(1);
      expect(signingErrors).toHaveLength(1);
    });
  });
  describe("Error Serialization", () => {
    it("should serialize error properties correctly", () => {
      const error = new errors_1.InvalidTransactionError(
        "Invalid format",
        "provider1",
        types_1.ChainId.STELLAR
      );
      const serialized = JSON.parse(JSON.stringify(error));
      expect(serialized.message).toBe("Invalid transaction: Invalid format");
      expect(serialized.code).toBe("INVALID_TRANSACTION");
      expect(serialized.providerId).toBe("provider1");
      expect(serialized.chainId).toBe(types_1.ChainId.STELLAR);
      expect(serialized.recoverable).toBe(false);
      expect(serialized.name).toBe("InvalidTransactionError");
    });
  });
});
