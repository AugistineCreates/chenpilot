"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignatureProviderErrorUtils =
  exports.AllProvidersFailedError =
  exports.UnsupportedProviderTypeError =
  exports.ProviderCreationError =
  exports.InvalidProviderMetadataError =
  exports.InvalidProviderIdError =
  exports.InvalidProviderImplementationError =
  exports.ProviderAlreadyRegisteredError =
  exports.DeviceLockedError =
  exports.DeviceBusyError =
  exports.DeviceNotFoundError =
  exports.HardwareWalletError =
  exports.UnsupportedOperationError =
  exports.UnsupportedChainError =
  exports.NetworkError =
  exports.InsufficientFundsError =
  exports.InvalidTransactionError =
  exports.SigningError =
  exports.UnauthorizedError =
  exports.UserRejectedError =
  exports.AuthenticationError =
  exports.ProviderNotFoundError =
  exports.ConnectionTimeoutError =
  exports.ConnectionError =
  exports.SignatureProviderError =
    void 0;
/**
 * Base error class for all SignatureProvider related errors
 */
class SignatureProviderError extends Error {
  constructor(message, code, providerId, chainId, recoverable = false) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.providerId = providerId;
    this.chainId = chainId;
    this.recoverable = recoverable;
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
exports.SignatureProviderError = SignatureProviderError;
/**
 * Connection related errors
 */
class ConnectionError extends SignatureProviderError {
  constructor(message, providerId, recoverable = true) {
    super(message, "CONNECTION_ERROR", providerId, undefined, recoverable);
  }
}
exports.ConnectionError = ConnectionError;
class ConnectionTimeoutError extends ConnectionError {
  constructor(providerId) {
    super("Connection timeout", providerId, true);
    this.code = "CONNECTION_TIMEOUT";
  }
}
exports.ConnectionTimeoutError = ConnectionTimeoutError;
class ProviderNotFoundError extends ConnectionError {
  constructor(providerId) {
    super(`Provider not found: ${providerId}`, providerId, false);
    this.code = "PROVIDER_NOT_FOUND";
  }
}
exports.ProviderNotFoundError = ProviderNotFoundError;
/**
 * Authentication and authorization errors
 */
class AuthenticationError extends SignatureProviderError {
  constructor(message, providerId) {
    super(message, "AUTHENTICATION_ERROR", providerId, undefined, true);
  }
}
exports.AuthenticationError = AuthenticationError;
class UserRejectedError extends AuthenticationError {
  constructor(providerId) {
    super("User rejected the request", providerId);
    this.code = "USER_REJECTED";
  }
}
exports.UserRejectedError = UserRejectedError;
class UnauthorizedError extends AuthenticationError {
  constructor(providerId) {
    super("Unauthorized access", providerId);
    this.code = "UNAUTHORIZED";
  }
}
exports.UnauthorizedError = UnauthorizedError;
/**
 * Transaction and signing errors
 */
class SigningError extends SignatureProviderError {
  constructor(message, providerId, chainId, recoverable = false) {
    super(message, "SIGNING_ERROR", providerId, chainId, recoverable);
  }
}
exports.SigningError = SigningError;
class InvalidTransactionError extends SigningError {
  constructor(message, providerId, chainId) {
    super(`Invalid transaction: ${message}`, providerId, chainId, false);
    this.code = "INVALID_TRANSACTION";
  }
}
exports.InvalidTransactionError = InvalidTransactionError;
class InsufficientFundsError extends SigningError {
  constructor(providerId, chainId) {
    super("Insufficient funds for transaction", providerId, chainId, false);
    this.code = "INSUFFICIENT_FUNDS";
  }
}
exports.InsufficientFundsError = InsufficientFundsError;
class NetworkError extends SigningError {
  constructor(message, providerId, chainId) {
    super(`Network error: ${message}`, providerId, chainId, true);
    this.code = "NETWORK_ERROR";
  }
}
exports.NetworkError = NetworkError;
/**
 * Chain and capability errors
 */
class UnsupportedChainError extends SignatureProviderError {
  constructor(chainId, providerId) {
    super(
      `Unsupported chain: ${chainId}`,
      "UNSUPPORTED_CHAIN",
      providerId,
      chainId,
      false
    );
  }
}
exports.UnsupportedChainError = UnsupportedChainError;
class UnsupportedOperationError extends SignatureProviderError {
  constructor(operation, providerId) {
    super(
      `Unsupported operation: ${operation}`,
      "UNSUPPORTED_OPERATION",
      providerId,
      undefined,
      false
    );
  }
}
exports.UnsupportedOperationError = UnsupportedOperationError;
/**
 * Hardware wallet specific errors
 */
class HardwareWalletError extends SignatureProviderError {
  constructor(message, providerId, recoverable = true) {
    super(message, "HARDWARE_WALLET_ERROR", providerId, undefined, recoverable);
  }
}
exports.HardwareWalletError = HardwareWalletError;
class DeviceNotFoundError extends HardwareWalletError {
  constructor(providerId) {
    super("Hardware wallet device not found", providerId, true);
    this.code = "DEVICE_NOT_FOUND";
  }
}
exports.DeviceNotFoundError = DeviceNotFoundError;
class DeviceBusyError extends HardwareWalletError {
  constructor(providerId) {
    super("Hardware wallet device is busy", providerId, true);
    this.code = "DEVICE_BUSY";
  }
}
exports.DeviceBusyError = DeviceBusyError;
class DeviceLockedError extends HardwareWalletError {
  constructor(providerId) {
    super("Hardware wallet device is locked", providerId, true);
    this.code = "DEVICE_LOCKED";
  }
}
exports.DeviceLockedError = DeviceLockedError;
/**
 * Provider registration and validation errors
 */
class ProviderAlreadyRegisteredError extends SignatureProviderError {
  constructor(providerId) {
    super(
      `Provider with ID '${providerId}' is already registered`,
      "PROVIDER_ALREADY_REGISTERED",
      providerId,
      undefined,
      false
    );
  }
}
exports.ProviderAlreadyRegisteredError = ProviderAlreadyRegisteredError;
class InvalidProviderImplementationError extends SignatureProviderError {
  constructor(providerId, details) {
    super(
      `Provider ${providerId} ${details}`,
      "INVALID_PROVIDER_IMPLEMENTATION",
      providerId,
      undefined,
      false
    );
  }
}
exports.InvalidProviderImplementationError = InvalidProviderImplementationError;
class InvalidProviderIdError extends SignatureProviderError {
  constructor(message) {
    super(message, "INVALID_PROVIDER_ID", undefined, undefined, false);
  }
}
exports.InvalidProviderIdError = InvalidProviderIdError;
class InvalidProviderMetadataError extends SignatureProviderError {
  constructor(providerId, details) {
    super(
      `Provider ${providerId} ${details}`,
      "INVALID_PROVIDER_METADATA",
      providerId,
      undefined,
      false
    );
  }
}
exports.InvalidProviderMetadataError = InvalidProviderMetadataError;
/**
 * Generic provider errors for factory and other operations
 */
class ProviderCreationError extends SignatureProviderError {
  constructor(message, providerId) {
    super(message, "PROVIDER_CREATION_FAILED", providerId, undefined, false);
  }
}
exports.ProviderCreationError = ProviderCreationError;
class UnsupportedProviderTypeError extends SignatureProviderError {
  constructor(providerType) {
    super(
      `Unsupported provider type: ${providerType}`,
      "UNSUPPORTED_PROVIDER_TYPE",
      undefined,
      undefined,
      false
    );
  }
}
exports.UnsupportedProviderTypeError = UnsupportedProviderTypeError;
class AllProvidersFailedError extends SignatureProviderError {
  constructor(message) {
    super(message, "ALL_PROVIDERS_FAILED", undefined, undefined, false);
  }
}
exports.AllProvidersFailedError = AllProvidersFailedError;
/**
 * Utility functions for error handling
 */
class SignatureProviderErrorUtils {
  /**
   * Check if an error is recoverable (user can retry the operation)
   */
  static isRecoverable(error) {
    if (error instanceof SignatureProviderError) {
      return error.recoverable;
    }
    return false;
  }
  /**
   * Get user-friendly error message with recovery suggestions
   */
  static getErrorMessage(error) {
    if (error instanceof SignatureProviderError) {
      const baseMessage = error.message;
      if (error.recoverable) {
        return `${baseMessage}. Please try again.`;
      }
      // Provide specific guidance based on error type
      switch (error.code) {
        case "PROVIDER_NOT_FOUND":
          return `${baseMessage}. Please ensure the wallet is installed and enabled.`;
        case "DEVICE_NOT_FOUND":
          return `${baseMessage}. Please connect your hardware wallet and try again.`;
        case "DEVICE_LOCKED":
          return `${baseMessage}. Please unlock your hardware wallet and try again.`;
        case "USER_REJECTED":
          return `${baseMessage}. The operation was cancelled.`;
        case "UNSUPPORTED_CHAIN":
          return `${baseMessage}. This wallet does not support the selected blockchain.`;
        default:
          return baseMessage;
      }
    }
    return error instanceof Error ? error.message : "An unknown error occurred";
  }
  /**
   * Create appropriate error from generic error object
   */
  static fromError(error, providerId, chainId) {
    if (error instanceof SignatureProviderError) {
      return error;
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return new SigningError(message, providerId, chainId, true);
  }
}
exports.SignatureProviderErrorUtils = SignatureProviderErrorUtils;
