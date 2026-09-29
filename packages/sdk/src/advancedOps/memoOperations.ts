/**
 * Memo operations for the unified advanced operations package.
 *
 * Consolidates the overlapping helpers that previously lived in `memos.ts`
 * (hex-string validation and buffer building) and `memoUtils.ts` (Stellar
 * `Memo` construction and comparison) behind a single descriptor-based API
 * that covers all five memo variants rather than only `hash` and `return`.
 *
 * Both legacy modules remain exported for backwards compatibility; this
 * module is the recommended entry point for new code.
 */

import {
  AdvancedOperationKind,
  type MemoKind,
  type MemoOperation,
  type MemoParams,
  type ValidationIssue,
  type ValidationReport,
} from "./types";
import {
  MAX_MEMO_TEXT_BYTES,
  error,
  isHex32,
  isUint64,
  toReport,
  utf8ByteLength,
} from "./validation";

const MEMO_KINDS: readonly MemoKind[] = [
  "none",
  "text",
  "id",
  "hash",
  "return",
];

/** Build a `MEMO_NONE` descriptor. */
export function noMemo(metadata?: Record<string, unknown>): MemoOperation {
  return { kind: AdvancedOperationKind.MEMO_ATTACH, params: { kind: "none" }, metadata };
}

/** Build a `MEMO_TEXT` descriptor. */
export function textMemo(
  value: string,
  metadata?: Record<string, unknown>
): MemoOperation {
  return {
    kind: AdvancedOperationKind.MEMO_ATTACH,
    params: { kind: "text", value },
    metadata,
  };
}

/** Build a `MEMO_ID` descriptor. */
export function idMemo(
  value: string | number | bigint,
  metadata?: Record<string, unknown>
): MemoOperation {
  return {
    kind: AdvancedOperationKind.MEMO_ATTACH,
    params: { kind: "id", value },
    metadata,
  };
}

/** Build a `MEMO_HASH` descriptor from a 64-character hex string. */
export function hashMemo(
  value: string,
  metadata?: Record<string, unknown>
): MemoOperation {
  return {
    kind: AdvancedOperationKind.MEMO_ATTACH,
    params: { kind: "hash", value },
    metadata,
  };
}

/** Build a `MEMO_RETURN` descriptor from a 64-character hex string. */
export function returnMemo(
  value: string,
  metadata?: Record<string, unknown>
): MemoOperation {
  return {
    kind: AdvancedOperationKind.MEMO_ATTACH,
    params: { kind: "return", value },
    metadata,
  };
}

/**
 * Validate memo parameters.
 *
 * Applies the same rules the Stellar protocol enforces, so a memo that passes
 * here will not be rejected at transaction build time for shape reasons.
 */
export function validateMemoParams(params: MemoParams): ValidationReport {
  const issues: ValidationIssue[] = [];

  if (!params || typeof params !== "object") {
    return toReport([error("", "MISSING_PARAMS", "Memo parameters are required")]);
  }

  if (!MEMO_KINDS.includes(params.kind)) {
    return toReport([
      error(
        "kind",
        "INVALID_MEMO_KIND",
        `Memo kind must be one of: ${MEMO_KINDS.join(", ")}`
      ),
    ]);
  }

  if (params.kind === "none") {
    if (params.value !== undefined) {
      issues.push(
        error("value", "UNEXPECTED_VALUE", "A 'none' memo must not carry a value")
      );
    }
    return toReport(issues);
  }

  if (params.value === undefined || params.value === null) {
    return toReport([
      error("value", "MISSING_VALUE", `A '${params.kind}' memo requires a value`),
    ]);
  }

  switch (params.kind) {
    case "text": {
      if (typeof params.value !== "string") {
        issues.push(
          error("value", "INVALID_MEMO_TEXT", "A 'text' memo value must be a string")
        );
        break;
      }
      const bytes = utf8ByteLength(params.value);
      if (bytes > MAX_MEMO_TEXT_BYTES) {
        issues.push(
          error(
            "value",
            "MEMO_TEXT_TOO_LONG",
            `A 'text' memo must be at most ${MAX_MEMO_TEXT_BYTES} bytes (got ${bytes})`
          )
        );
      }
      break;
    }
    case "id": {
      if (!isUint64(params.value)) {
        issues.push(
          error(
            "value",
            "INVALID_MEMO_ID",
            "An 'id' memo must be an unsigned 64-bit integer"
          )
        );
      }
      break;
    }
    case "hash":
    case "return": {
      if (!isHex32(params.value)) {
        issues.push(
          error(
            "value",
            "INVALID_MEMO_HASH",
            `A '${params.kind}' memo must be a 64-character hex string (32 bytes)`
          )
        );
      }
      break;
    }
  }

  return toReport(issues);
}

/**
 * Normalize memo parameters into their canonical wire form.
 *
 * Hex values are lower-cased and `id` values become decimal strings so that
 * two logically identical memos always compare equal.
 *
 * @throws {Error} when `params` fail {@link validateMemoParams}.
 */
export function normalizeMemoParams(params: MemoParams): Record<string, unknown> {
  const report = validateMemoParams(params);
  if (!report.valid) {
    throw new Error(
      `Invalid memo: ${report.errors.map((issue) => issue.message).join("; ")}`
    );
  }

  switch (params.kind) {
    case "none":
      return { kind: "none" };
    case "text":
      return { kind: "text", value: params.value as string };
    case "id":
      return { kind: "id", value: BigInt(params.value as string | number).toString() };
    case "hash":
    case "return":
      return { kind: params.kind, value: (params.value as string).toLowerCase() };
  }
}

/**
 * Decode a 32-byte hex memo value into a `Buffer`.
 *
 * Replaces the near-identical `buildMemoHash` and `buildMemoReturn` helpers
 * from `memos.ts` with a single implementation.
 */
export function memoValueToBuffer(value: string): Buffer {
  if (!isHex32(value)) {
    throw new Error(
      "Invalid memo value: must be a 64-character hex string (32 bytes)"
    );
  }
  return Buffer.from(value, "hex");
}

/** One-line human-readable description, used in plan summaries and reviews. */
export function describeMemo(params: MemoParams): string {
  if (params.kind === "none") return "No memo";
  if (params.kind === "text") return `Text memo "${String(params.value)}"`;
  if (params.kind === "id") return `Id memo ${String(params.value)}`;
  const value = String(params.value ?? "");
  const preview = value.length > 16 ? `${value.slice(0, 16)}…` : value;
  return `${params.kind === "hash" ? "Hash" : "Return"} memo ${preview}`;
}
