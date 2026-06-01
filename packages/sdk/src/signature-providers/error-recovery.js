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
exports.signatureProviderErrorRecovery =
  exports.SignatureProviderErrorRecovery =
  exports.NetworkErrorRecoveryStrategy =
  exports.HardwareWalletErrorRecoveryStrategy =
  exports.AuthenticationErrorRecoveryStrategy =
  exports.ConnectionErrorRecoveryStrategy =
    void 0;
const errors_1 = require("./errors");
/**
 * Recovery strategy for connection-related errors
 */
class ConnectionErrorRecoveryStrategy {
  canRecover(error) {
    return error instanceof errors_1.ConnectionError && error.recoverable;
  }
  recover(error_1) {
    return __awaiter(this, arguments, void 0, function* (error, context = {}) {
      var _a, _b;
      const retryCount =
        (_a = context.retryCount) !== null && _a !== void 0 ? _a : 0;
      const maxRetries =
        (_b = context.maxRetries) !== null && _b !== void 0 ? _b : 3;
      if (retryCount >= maxRetries) {
        return {
          success: false,
          shouldRetry: false,
          instructions: [
            "Maximum retry attempts reached. Please check your connection and try again later.",
          ],
        };
      }
      if (error instanceof errors_1.ConnectionTimeoutError) {
        // Exponential backoff for timeout errors
        const retryAfterMs = Math.min(1000 * Math.pow(2, retryCount), 10000);
        return {
          success: false,
          shouldRetry: true,
          retryAfterMs,
          instructions: [
            "Connection timed out.",
            `Retrying in ${retryAfterMs / 1000} seconds...`,
            "Ensure your internet connection is stable.",
          ],
        };
      }
      if (error instanceof errors_1.ProviderNotFoundError) {
        return {
          success: false,
          shouldRetry: false,
          instructions: [
            "Wallet provider not found.",
            "Please ensure the wallet extension is installed and enabled.",
            "Refresh the page and try again.",
          ],
        };
      }
      // Generic connection error
      return {
        success: false,
        shouldRetry: retryCount < maxRetries,
        retryAfterMs: 2000,
        instructions: [
          "Connection failed.",
          "Please check your internet connection.",
          "Ensure the wallet is accessible.",
        ],
      };
    });
  }
  getRecoveryInstructions(error) {
    if (error instanceof errors_1.ConnectionTimeoutError) {
      return [
        "Connection timed out",
        "Check your internet connection",
        "Try again in a few moments",
      ];
    }
    if (error instanceof errors_1.ProviderNotFoundError) {
      return [
        "Wallet not found",
        "Install the wallet extension",
        "Enable the wallet in your browser",
        "Refresh the page",
      ];
    }
    return [
      "Connection failed",
      "Check your internet connection",
      "Ensure wallet is accessible",
    ];
  }
}
exports.ConnectionErrorRecoveryStrategy = ConnectionErrorRecoveryStrategy;
/**
 * Recovery strategy for authentication-related errors
 */
class AuthenticationErrorRecoveryStrategy {
  canRecover(error) {
    return error instanceof errors_1.AuthenticationError;
  }
  recover(error_1) {
    return __awaiter(this, arguments, void 0, function* (error, context = {}) {
      var _a, _b;
      if (error instanceof errors_1.UserRejectedError) {
        return {
          success: false,
          shouldRetry: false,
          instructions: [
            "Transaction was cancelled by user.",
            "Please approve the transaction in your wallet to continue.",
          ],
        };
      }
      const retryCount =
        (_a = context.retryCount) !== null && _a !== void 0 ? _a : 0;
      const maxRetries =
        (_b = context.maxRetries) !== null && _b !== void 0 ? _b : 2;
      if (retryCount >= maxRetries) {
        return {
          success: false,
          shouldRetry: false,
          instructions: [
            "Authentication failed multiple times.",
            "Please check your wallet settings and try again.",
          ],
        };
      }
      return {
        success: false,
        shouldRetry: true,
        retryAfterMs: 1000,
        instructions: [
          "Authentication failed.",
          "Please check your wallet connection.",
          "Ensure you are logged into your wallet.",
        ],
      };
    });
  }
  getRecoveryInstructions(error) {
    if (error instanceof errors_1.UserRejectedError) {
      return [
        "Transaction cancelled",
        "Approve the transaction in your wallet",
        "Check transaction details carefully",
      ];
    }
    return [
      "Authentication failed",
      "Check wallet connection",
      "Ensure wallet is unlocked",
    ];
  }
}
exports.AuthenticationErrorRecoveryStrategy =
  AuthenticationErrorRecoveryStrategy;
/**
 * Recovery strategy for hardware wallet errors
 */
class HardwareWalletErrorRecoveryStrategy {
  canRecover(error) {
    return error instanceof errors_1.HardwareWalletError;
  }
  recover(error_1) {
    return __awaiter(this, arguments, void 0, function* (error, _context = {}) {
      void _context;
      if (error instanceof errors_1.DeviceNotFoundError) {
        return {
          success: false,
          shouldRetry: true,
          retryAfterMs: 3000,
          instructions: [
            "Hardware wallet not detected.",
            "Connect your hardware wallet via USB.",
            "Ensure the device is powered on.",
            "Try a different USB port or cable.",
          ],
        };
      }
      if (error instanceof errors_1.DeviceLockedError) {
        return {
          success: false,
          shouldRetry: true,
          retryAfterMs: 1000,
          instructions: [
            "Hardware wallet is locked.",
            "Enter your PIN on the device.",
            "Ensure the correct app is open on the device.",
          ],
        };
      }
      if (error instanceof errors_1.DeviceBusyError) {
        return {
          success: false,
          shouldRetry: true,
          retryAfterMs: 2000,
          instructions: [
            "Hardware wallet is busy.",
            "Complete any pending operations on the device.",
            "Close other applications using the device.",
          ],
        };
      }
      // Generic hardware wallet error
      return {
        success: false,
        shouldRetry: true,
        retryAfterMs: 2000,
        instructions: [
          "Hardware wallet error occurred.",
          "Check device connection.",
          "Ensure correct app is open on device.",
        ],
      };
    });
  }
  getRecoveryInstructions(error) {
    if (error instanceof errors_1.DeviceNotFoundError) {
      return [
        "Connect hardware wallet",
        "Check USB connection",
        "Power on the device",
      ];
    }
    if (error instanceof errors_1.DeviceLockedError) {
      return [
        "Unlock hardware wallet",
        "Enter PIN on device",
        "Open correct app",
      ];
    }
    if (error instanceof errors_1.DeviceBusyError) {
      return [
        "Device is busy",
        "Complete pending operations",
        "Close other apps using device",
      ];
    }
    return [
      "Hardware wallet error",
      "Check device connection",
      "Ensure device is ready",
    ];
  }
}
exports.HardwareWalletErrorRecoveryStrategy =
  HardwareWalletErrorRecoveryStrategy;
/**
 * Recovery strategy for network-related errors
 */
class NetworkErrorRecoveryStrategy {
  canRecover(error) {
    return error instanceof errors_1.NetworkError;
  }
  recover(error_1) {
    return __awaiter(this, arguments, void 0, function* (error, context = {}) {
      var _a, _b;
      const retryCount =
        (_a = context.retryCount) !== null && _a !== void 0 ? _a : 0;
      const maxRetries =
        (_b = context.maxRetries) !== null && _b !== void 0 ? _b : 5;
      if (retryCount >= maxRetries) {
        return {
          success: false,
          shouldRetry: false,
          instructions: [
            "Network error persists after multiple attempts.",
            "Please check your internet connection.",
            "Try again later when network conditions improve.",
          ],
        };
      }
      // Exponential backoff with jitter
      const baseDelay = 1000;
      const jitter = Math.random() * 500;
      const retryAfterMs = Math.min(
        baseDelay * Math.pow(2, retryCount) + jitter,
        30000
      );
      return {
        success: false,
        shouldRetry: true,
        retryAfterMs,
        instructions: [
          "Network error occurred.",
          `Retrying in ${Math.round(retryAfterMs / 1000)} seconds...`,
          "Check your internet connection.",
        ],
      };
    });
  }
  getRecoveryInstructions(_error) {
    void _error;
    return [
      "Network error",
      "Check internet connection",
      "Try again in a moment",
    ];
  }
}
exports.NetworkErrorRecoveryStrategy = NetworkErrorRecoveryStrategy;
/**
 * Comprehensive error recovery manager
 */
class SignatureProviderErrorRecovery {
  constructor() {
    this.strategies = [
      new ConnectionErrorRecoveryStrategy(),
      new AuthenticationErrorRecoveryStrategy(),
      new HardwareWalletErrorRecoveryStrategy(),
      new NetworkErrorRecoveryStrategy(),
    ];
  }
  /**
   * Add a custom recovery strategy
   */
  addStrategy(strategy) {
    this.strategies.push(strategy);
  }
  /**
   * Remove a recovery strategy
   */
  removeStrategy(strategy) {
    const index = this.strategies.indexOf(strategy);
    if (index > -1) {
      this.strategies.splice(index, 1);
    }
  }
  /**
   * Attempt to recover from an error
   */
  recover(error_1) {
    return __awaiter(this, arguments, void 0, function* (error, context = {}) {
      // Convert to SignatureProviderError if needed
      const providerError =
        error instanceof errors_1.SignatureProviderError
          ? error
          : errors_1.SignatureProviderErrorUtils.fromError(
              error,
              context.providerId,
              context.chainId
            );
      // Find appropriate recovery strategy
      const strategy = this.strategies.find((s) => s.canRecover(providerError));
      if (!strategy) {
        return {
          success: false,
          shouldRetry:
            errors_1.SignatureProviderErrorUtils.isRecoverable(providerError),
          instructions: [
            errors_1.SignatureProviderErrorUtils.getErrorMessage(providerError),
            "No specific recovery strategy available.",
          ],
        };
      }
      try {
        return yield strategy.recover(providerError, context);
      } catch (recoveryError) {
        return {
          success: false,
          shouldRetry: false,
          newError:
            errors_1.SignatureProviderErrorUtils.fromError(recoveryError),
          instructions: [
            "Error recovery failed.",
            "Please try again or contact support.",
          ],
        };
      }
    });
  }
  /**
   * Get recovery instructions for an error without attempting recovery
   */
  getRecoveryInstructions(error) {
    const providerError =
      error instanceof errors_1.SignatureProviderError
        ? error
        : errors_1.SignatureProviderErrorUtils.fromError(error);
    const strategy = this.strategies.find((s) => s.canRecover(providerError));
    if (strategy) {
      return strategy.getRecoveryInstructions(providerError);
    }
    return [
      errors_1.SignatureProviderErrorUtils.getErrorMessage(providerError),
      "Please try again or contact support.",
    ];
  }
  /**
   * Check if an error is recoverable
   */
  canRecover(error) {
    const providerError =
      error instanceof errors_1.SignatureProviderError
        ? error
        : errors_1.SignatureProviderErrorUtils.fromError(error);
    return this.strategies.some((s) => s.canRecover(providerError));
  }
}
exports.SignatureProviderErrorRecovery = SignatureProviderErrorRecovery;
// Global error recovery instance
exports.signatureProviderErrorRecovery = new SignatureProviderErrorRecovery();
