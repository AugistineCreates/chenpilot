/**
 * Shared validation primitives for advanced Stellar operations.
 *
 * Before this module, memo validation lived in `memos.ts` and `memoUtils.ts`,
 * trustline validation returned `string[]` from `trustline.ts`, and claimable
 * balances were barely validated at all. Everything now funnels through these
 * primitives so a given input is judged identically no matter which helper the
 * caller reaches for.
 */

import type { ValidationIssue, ValidationReport } from "./types";

/** Maximum trust limit representable by the Stellar protocol. */
export const MAX_TRUST_LIMIT = "922337203685.4775807";

/** Maximum byte length of a `text` memo. */
export const MAX_MEMO_TEXT_BYTES = 28;

/** Number of decimal places a Stellar amount may carry. */
export const STELLAR_AMOUNT_PRECISION = 7;

/** Largest value a `MEMO_ID` may hold (2^64 - 1). */
export const MAX_MEMO_ID = 18446744073709551615n;

const ACCOUNT_ID_PATTERN = /^G[A-Z2-7]{55}$/;
const ASSET_CODE_PATTERN = /^[a-zA-Z0-9]{1,12}$/;
const HEX_32_PATTERN = /^[0-9a-fA-F]{64}$/;
const BALANCE_ID_PATTERN = /^[0-9a-fA-F]{72}$/;
const AMOUNT_PATTERN = /^\d+(\.\d+)?$/;

/** True when `value` is a well-formed Stellar public account identifier. */
export function isAccountId(value: unknown): value is string {
  return typeof value === "string" && ACCOUNT_ID_PATTERN.test(value);
}

/** True when `value` is a well-formed asset code (1–12 alphanumerics). */
export function isAssetCode(value: unknown): value is string {
  return typeof value === "string" && ASSET_CODE_PATTERN.test(value);
}

/** True when `value` is a 32-byte value encoded as 64 hex characters. */
export function isHex32(value: unknown): value is string {
  return typeof value === "string" && HEX_32_PATTERN.test(value);
}

/** True when `value` is a claimable balance id (36 bytes as 72 hex chars). */
export function isBalanceId(value: unknown): value is string {
  return typeof value === "string" && BALANCE_ID_PATTERN.test(value);
}

/** True when `value` is a non-negative decimal amount within Stellar precision. */
export function isAmount(value: unknown): value is string {
  if (typeof value !== "string" || !AMOUNT_PATTERN.test(value)) return false;
  const [, fraction = ""] = value.split(".");
  return fraction.length <= STELLAR_AMOUNT_PRECISION;
}

/** True when `value` is an amount strictly greater than zero. */
export function isPositiveAmount(value: unknown): value is string {
  return isAmount(value) && Number(value) > 0;
}

/** True when `value` fits in an unsigned 64-bit integer. */
export function isUint64(value: unknown): boolean {
  if (typeof value === "bigint") return value >= 0n && value <= MAX_MEMO_ID;
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 && Number.isSafeInteger(value);
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) return false;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n && parsed <= MAX_MEMO_ID;
  } catch {
    return false;
  }
}

/** Byte length of a string when encoded as UTF-8. */
export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/** Construct an `error`-severity issue. */
export function error(
  field: string,
  code: string,
  message: string
): ValidationIssue {
  return { field, code, message, severity: "error" };
}

/** Construct a `warning`-severity issue. */
export function warning(
  field: string,
  code: string,
  message: string
): ValidationIssue {
  return { field, code, message, severity: "warning" };
}

/** Split a flat issue list into the report shape callers consume. */
export function toReport(issues: ValidationIssue[]): ValidationReport {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return { valid: errors.length === 0, errors, warnings };
}

/** Merge several reports into one, preserving issue order. */
export function mergeReports(reports: ValidationReport[]): ValidationReport {
  return toReport(reports.flatMap((r) => [...r.errors, ...r.warnings]));
}

/** Prefix every issue field with `prefix`, e.g. to scope it to `operations[0]`. */
export function scopeReport(
  report: ValidationReport,
  prefix: string
): ValidationReport {
  const rescope = (issue: ValidationIssue): ValidationIssue => ({
    ...issue,
    field: `${prefix}.${issue.field}`,
  });
  return {
    valid: report.valid,
    errors: report.errors.map(rescope),
    warnings: report.warnings.map(rescope),
  };
}
