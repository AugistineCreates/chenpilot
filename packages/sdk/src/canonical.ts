/**
 * Canonical serialization module for cross-runtime deterministic encoding.
 *
 * This module provides a language-neutral canonicalization algorithm that can
 * be implemented consistently across TypeScript, Go, Rust, and other runtimes.
 *
 * Canonicalization rules:
 * 1. Object keys are sorted lexicographically (Unicode code point order)
 * 2. Arrays preserve order (order is semantically meaningful)
 * 3. Undefined values are omitted
 * 4. Null values are preserved
 * 5. Strings are JSON-encoded with proper escaping
 * 6. Numbers are serialized as-is (no trailing zeros for integers)
 * 7. Booleans are serialized as true/false
 *
 * @version 1.0.0
 */

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue | undefined };

/**
 * Canonicalize a value into a deterministic string representation.
 *
 * @param value - The value to canonicalize
 * @returns A deterministic string representation
 *
 * @example
 * ```typescript
 * canonicalize({ z: 1, a: 2 }) // '{"a":2,"z":1}'
 * canonicalize([3, 1, 2])      // '[3,1,2]'
 * canonicalize({ a: undefined, b: 1 }) // '{"b":1}'
 * ```
 */
export function canonicalize(value: CanonicalValue): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    return JSON.stringify(normalizeUnicode(value));
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item as CanonicalValue)).join(",")}]`;
  }

  // Object: sort keys and recurse
  const entries = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalize(value[key] as CanonicalValue)}`
    );

  return `{${entries.join(",")}}`;
}

/**
 * Compute a SHA-256 digest of the canonical representation.
 *
 * @param value - The value to hash
 * @returns A hex-encoded SHA-256 digest
 *
 * @example
 * ```typescript
 * const digest = computeDigest({ a: 1, b: 2 });
 * // Returns a 64-character hex string
 * ```
 */
export function computeDigest(value: CanonicalValue): string {
  const { createHash } = require("crypto");
  return createHash("sha256")
    .update(canonicalize(value), "utf8")
    .digest("hex");
}

/**
 * Encode a string to Base64URL (URL-safe Base64 without padding).
 *
 * @param input - The string to encode
 * @returns Base64URL-encoded string
 *
 * @example
 * ```typescript
 * toBase64Url("Hello, World!") // "SGVsbG8sIFdvcmxkIQ"
 * ```
 */
export function toBase64Url(input: string): string {
  const { Buffer } = require("buffer");
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Decode a Base64URL-encoded string.
 *
 * @param input - The Base64URL-encoded string
 * @returns Decoded string
 *
 * @example
 * ```typescript
 * fromBase64Url("SGVsbG8sIFdvcmxkIQ") // "Hello, World!"
 * ```
 */
export function fromBase64Url(input: string): string {
  const { Buffer } = require("buffer");
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  return Buffer.from(base64 + padding, "base64").toString("utf8");
}

/**
 * Normalize a string to Unicode NFC form.
 * This ensures consistent representation across runtimes.
 *
 * @param input - The string to normalize
 * @returns NFC-normalized string
 *
 * @example
 * ```typescript
 * normalizeUnicode("e\u0301") // "\u00e9" (é as single codepoint)
 * ```
 */
export function normalizeUnicode(input: string): string {
  return input.normalize("NFC");
}

/**
 * Canonicalize a value with Unicode normalization applied to all strings.
 *
 * @param value - The value to canonicalize
 * @returns A deterministic string representation with normalized Unicode
 */
export function canonicalizeWithNormalization(value: CanonicalValue): string {
  if (typeof value === "string") {
    return JSON.stringify(normalizeUnicode(value));
  }

  return canonicalize(value);
}
