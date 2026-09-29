import { ChainId } from "../types";
import { ErrorCategory } from "../errors";

/**
 * Maps a SignatureProvider error code to its ErrorCategory.
 */
function codeToCategory(code: string): ErrorCategory {
  switch (code) {
    case "CONNECTION_ERROR":
    case "CONNECTION_TIMEOUT":
    case "PROVIDER_NOT_FOUND":
    case "NETWORK_ERROR":
      return ErrorCategory.TRANSPORT;
    case "INVALID_TRANSACTION":
    case "INVALID_PROVIDER_IMPLEMENTATION":
    case "INVALID_PROVIDER_ID":
    case "INVALID_PROVIDER_METADATA":
    case "UNSUPPORTED_PROVIDER_TYPE":
      return ErrorCategory.VALIDATION;
    case "SIGNING_ERROR":
    case "INSUFFICIENT_FUNDS":
    case "HARDWARE_WALLET_ERROR":
    case "DEVICE_NOT_FOUND":
    case "DEVICE_BUSY":
    case "DEVICE_LOCKED":
      return ErrorCategory.EXECUTION;
    case "AUTHENTICATION_ERROR":
    case "USER_REJECTED":
    case "UNAUTHORIZED":
      return ErrorCategory.POLICY;
    case "UNSUPPORTED_CHAIN":
    case "UNSUPPORTED_OPERATION":
      return ErrorCategory.COMPATIBILITY;
    default:
      return ErrorCategory.UNKNOWN;
  }
}

/**
 * Base error class for all SignatureProvider related errors
 */
export abstract class SignatureProviderError extends Error {
  public readonly code: string;
  public readonly category: ErrorCategory;
  public readonly providerId?: string;
  public readonly chainId?: ChainId;
  public readonly recoverable: boolean;

  constructor(
    message: string,
    code: string,
    providerId?: string,
    chainId?: ChainId,
    recoverable: boolean = false
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.category = codeToCategory(code);
    this.providerId = providerId;
    this.chainId = chainId;
    this.recoverable = recoverable;

    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Connection related errors
 */
export class ConnectionError extends SignatureProviderError {
  constructor(
    message: string,
    providerId?: string,
    recoverable: boolean = true
  ) {
    super(message, "CONNECTION_ERROR", providerId, undefined, recoverable);
  }
}

export class ConnectionTimeoutError extends ConnectionError {
  constructor(providerId?: string) {
    super("Connection timeout", providerId, true);
  }

  public readonly code = "CONNECTION_TIMEOUT";
}

export class ProviderNotFoundError extends ConnectionError {
  constructor(providerId: string) {
    super(`Provider not found: ${providerId}`, providerId, false);
  }

  public readonly code = "PROVIDER_NOT_FOUND";
}

/**
 * Authentication and authorization errors
 */
export class AuthenticationError extends SignatureProviderError {
  constructor(message: string, providerId?: string) {
    super(message, "AUTHENTICATION_ERROR", providerId, undefined, true);
  }
}

export class UserRejectedError extends AuthenticationError {
  constructor(providerId?: string) {
    super("User rejected the request", providerId);
  }

  public readonly code = "USER_REJECTED";
}

export class UnauthorizedError extends AuthenticationError {
  constructor(providerId?: string) {
    super("Unauthorized access", providerId);
  }

  public readonly code = "UNAUTHORIZED";
}

/**
 * Transaction and signing errors
 */
export class SigningError extends SignatureProviderError {
  constructor(
    message: string,
    providerId?: string,
    chainId?: ChainId,
    recoverable: boolean = false
  ) {
    super(message, "SIGNING_ERROR", providerId, chainId, recoverable);
  }
}

export class InvalidTransactionError extends SigningError {
  constructor(message: string, providerId?: string, chainId?: ChainId) {
    super(`Invalid transaction: ${message}`, providerId, chainId, false);
  }

  public readonly code = "INVALID_TRANSACTION";
}

export class InsufficientFundsError extends SigningError {
  constructor(providerId?: string, chainId?: ChainId) {
    super("Insufficient funds for transaction", providerId, chainId, false);
  }

  public readonly code = "INSUFFICIENT_FUNDS";
}

export class NetworkError extends SigningError {
  constructor(message: string, providerId?: string, chainId?: ChainId) {
    super(`Network error: ${message}`, providerId, chainId, true);
  }

  public readonly code = "NETWORK_ERROR";
}

/**
 * Chain and capability errors
 */
export class UnsupportedChainError extends SignatureProviderError {
  constructor(chainId: ChainId, providerId?: string) {
    super(
      `Unsupported chain: ${chainId}`,
      "UNSUPPORTED_CHAIN",
      providerId,
      chainId,
      false
    );
  }
}

export class UnsupportedOperationError extends SignatureProviderError {
  constructor(operation: string, providerId?: string) {
    super(
      `Unsupported operation: ${operation}`,
      "UNSUPPORTED_OPERATION",
      providerId,
      undefined,
      false
    );
  }
}

/**
 * Hardware wallet specific errors
 */
export class HardwareWalletError extends SignatureProviderError {
  constructor(
    message: string,
    providerId?: string,
    recoverable: boolean = true
  ) {
    super(message, "HARDWARE_WALLET_ERROR", providerId, undefined, recoverable);
  }
}

export class DeviceNotFoundError extends HardwareWalletError {
  constructor(providerId?: string) {
    super("Hardware wallet device not found", providerId, true);
  }

  public readonly code = "DEVICE_NOT_FOUND";
}

export class DeviceBusyError extends HardwareWalletError {
  constructor(providerId?: string) {
    super("Hardware wallet device is busy", providerId, true);
  }

  public readonly code = "DEVICE_BUSY";
}

export class DeviceLockedError extends HardwareWalletError {
  constructor(providerId?: string) {
    super("Hardware wallet device is locked", providerId, true);
  }

  public readonly code = "DEVICE_LOCKED";
}

/**
 * Provider registration and validation errors
 */
export class ProviderAlreadyRegisteredError extends SignatureProviderError {
  constructor(providerId: string) {
    super(
      `Provider with ID '${providerId}' is already registered`,
      "PROVIDER_ALREADY_REGISTERED",
      providerId,
      undefined,
      false
    );
  }
}

export class InvalidProviderImplementationError extends SignatureProviderError {
  constructor(providerId: string, details: string) {
    super(
      `Provider ${providerId} ${details}`,
      "INVALID_PROVIDER_IMPLEMENTATION",
      providerId,
      undefined,
      false
    );
  }
}

export class InvalidProviderIdError extends SignatureProviderError {
  constructor(message: string) {
    super(message, "INVALID_PROVIDER_ID", undefined, undefined, false);
  }
}

export class InvalidProviderMetadataError extends SignatureProviderError {
  constructor(providerId: string, details: string) {
    super(
      `Provider ${providerId} ${details}`,
      "INVALID_PROVIDER_METADATA",
      providerId,
      undefined,
      false
    );
  }
}

/**
 * Generic provider errors for factory and other operations
 */
export class ProviderCreationError extends SignatureProviderError {
  constructor(message: string, providerId?: string) {
    super(message, "PROVIDER_CREATION_FAILED", providerId, undefined, false);
  }
}

export class UnsupportedProviderTypeError extends SignatureProviderError {
  constructor(providerType: string) {
    super(
      `Unsupported provider type: ${providerType}`,
      "UNSUPPORTED_PROVIDER_TYPE",
      undefined,
      undefined,
      false
    );
  }
}

export class AllProvidersFailedError extends SignatureProviderError {
  constructor(message: string) {
    super(message, "ALL_PROVIDERS_FAILED", undefined, undefined, false);
  }
}

/**
 * Utility functions for error handling
 */
export class SignatureProviderErrorUtils {
  /**
   * Check if an error is recoverable (user can retry the operation)
   */
  static isRecoverable(error: unknown): boolean {
    if (error instanceof SignatureProviderError) {
      return error.recoverable;
    }
    return false;
  }

  /**
   * Get user-friendly error message with recovery suggestions
   */
  static getErrorMessage(error: unknown): string {
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
  static fromError(
    error: unknown,
    providerId?: string,
    chainId?: ChainId
  ): SignatureProviderError {
    if (error instanceof SignatureProviderError) {
      return error;
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return new SigningError(message, providerId, chainId, true);
  }
}
