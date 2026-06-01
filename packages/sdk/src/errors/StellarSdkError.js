"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StellarSdkError = void 0;
class StellarSdkError extends Error {
  constructor(details) {
    super(details.message);
    this.name = "StellarSdkError";
    this.code = details.code;
    this.action = details.action;
    this.rawCode = details.rawCode;
  }
}
exports.StellarSdkError = StellarSdkError;
