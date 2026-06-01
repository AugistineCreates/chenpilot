/**
 * Validates if a string is a valid 32-byte hex string (64 characters).
 * @param value The string to validate.
 * @returns True if valid, false otherwise.
 */
export function validateHex32(value: string): boolean {
  if (typeof value !== "string") return false;
  const hexRegex = /^[0-9a-fA-F]{64}$/;
  return hexRegex.test(value);
}

/**
 * Validates if a string is a valid Stellar 'Hash' memo (32-byte hex).
 */
export function validateMemoHash(value: string): boolean {
  return validateHex32(value);
}

/**
 * Validates if a string is a valid Stellar 'Return' memo (32-byte hex).
 */
export function validateMemoReturn(value: string): boolean {
  return validateHex32(value);
}

/**
 * Builds a 32-byte Buffer from a hex string.
 * Throws an error if the input is not a valid 32-byte hex string.
 * @param value The hex string.
 * @returns A Buffer containing the 32 bytes.
 */
export function buildMemoHash(value: string): Buffer {
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
export function buildMemoReturn(value: string): Buffer {
  if (!validateMemoReturn(value)) {
    throw new Error(
      "Invalid Return memo: must be a 64-character hex string (32 bytes)"
    );
  }
  return Buffer.from(value, "hex");
}
