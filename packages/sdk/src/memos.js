"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateHex32 = validateHex32;
exports.validateMemoHash = validateMemoHash;
exports.validateMemoReturn = validateMemoReturn;
exports.buildMemoHash = buildMemoHash;
exports.buildMemoReturn = buildMemoReturn;
/**
 * Validates if a string is a valid 32-byte hex string (64 characters).
 * @param value The string to validate.
 * @returns True if valid, false otherwise.
 */
function validateHex32(value) {
  if (typeof value !== "string") return false;
  const hexRegex = /^[0-9a-fA-F]{64}$/;
  return hexRegex.test(value);
}
/**
 * Validates if a string is a valid Stellar 'Hash' memo (32-byte hex).
 */
function validateMemoHash(value) {
  return validateHex32(value);
}
/**
 * Validates if a string is a valid Stellar 'Return' memo (32-byte hex).
 */
function validateMemoReturn(value) {
  return validateHex32(value);
}
/**
 * Builds a 32-byte Buffer from a hex string.
 * Throws an error if the input is not a valid 32-byte hex string.
 * @param value The hex string.
 * @returns A Buffer containing the 32 bytes.
 */
function buildMemoHash(value) {
  if (!validateMemoHash(value)) {
    throw new Error(
      "Invalid Hash memo: must be a 64-character hex string (32 bytes)"
    );
  }
  return Buffer.from(value, "hex");
}
/**
 * Builds a 32-byte Buffer from a hex string.
 * Throws an error if the input is not a valid 32-byte hex string.
 * @param value The hex string.
 * @returns A Buffer containing the 32 bytes.
 */
function buildMemoReturn(value) {
  if (!validateMemoReturn(value)) {
    throw new Error(
      "Invalid Return memo: must be a 64-character hex string (32 bytes)"
    );
  }
  return Buffer.from(value, "hex");
}
