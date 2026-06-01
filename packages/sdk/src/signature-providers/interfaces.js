"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseSignatureProvider = void 0;
/**
 * Base abstract class that provides common functionality for SignatureProvider implementations.
 * Concrete providers can extend this class to inherit shared behavior.
 */
class BaseSignatureProvider {
  constructor(providerId, metadata) {
    this.connectionState = null;
    this.connectionCallbacks = [];
    this.accountCallbacks = [];
    this.providerId = providerId;
    this.metadata = metadata;
  }
  // Common implementation for connection state
  isConnected() {
    var _a, _b;
    return (_b =
      (_a = this.connectionState) === null || _a === void 0
        ? void 0
        : _a.isConnected) !== null && _b !== void 0
      ? _b
      : false;
  }
  // Event handling implementation
  onConnectionChange(callback) {
    this.connectionCallbacks.push(callback);
  }
  onAccountChange(callback) {
    this.accountCallbacks.push(callback);
  }
  // Protected helper methods for subclasses
  notifyConnectionChange(connected) {
    this.connectionCallbacks.forEach((callback) => {
      try {
        callback(connected);
      } catch (error) {
        console.error("Error in connection change callback:", error);
      }
    });
  }
  notifyAccountChange(accounts) {
    this.accountCallbacks.forEach((callback) => {
      try {
        callback(accounts);
      } catch (error) {
        console.error("Error in account change callback:", error);
      }
    });
  }
}
exports.BaseSignatureProvider = BaseSignatureProvider;
