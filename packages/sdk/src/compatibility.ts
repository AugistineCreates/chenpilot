/**
 * SDK ↔ deployed-contract compatibility testing and guardrails (#570).
 *
 * SDK releases must be validated against the contract versions they are used
 * with and against the capability metadata a backend advertises. This module
 * provides:
 *
 *  - a small semver comparator (no runtime dependency),
 *  - a {@link CompatibilityMatrix} describing which SDK version ranges support
 *    which contract versions and which capabilities they require, and
 *  - {@link checkCompatibility} / {@link assertCompatible} guardrails that
 *    return a structured result or throw a typed {@link SdkError}.
 */

import { ErrorRegistry, SdkErrorCode } from "./errorRegistry";

// ─── Minimal semver ───────────────────────────────────────────────────────────

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/** Parse a `major.minor.patch` string, ignoring any pre-release/build suffix. */
export function parseSemVer(version: string): SemVer {
  const core = version.trim().replace(/^v/, "").split(/[-+]/)[0];
  const [major = 0, minor = 0, patch = 0] = core.split(".").map((n) => {
    const parsed = Number.parseInt(n, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  return { major, minor, patch };
}

/** Compare two semver strings: negative if a<b, 0 if equal, positive if a>b. */
export function compareSemVer(a: string, b: string): number {
  const pa = parseSemVer(a);
  const pb = parseSemVer(b);
  return pa.major - pb.major || pa.minor - pb.minor || pa.patch - pb.patch;
}

/** Whether `version` is within `[min, max]` (inclusive). Missing bound = open. */
export function isVersionInRange(
  version: string,
  range: SdkVersionRange
): boolean {
  if (range.min && compareSemVer(version, range.min) < 0) return false;
  if (range.max && compareSemVer(version, range.max) > 0) return false;
  return true;
}

// ─── Matrix model ─────────────────────────────────────────────────────────────

/** Inclusive SDK version range. */
export interface SdkVersionRange {
  /** Minimum supported SDK version (inclusive). */
  min?: string;
  /** Maximum supported SDK version (inclusive). */
  max?: string;
}

/** One row of the compatibility matrix. */
export interface CompatibilityMatrixEntry {
  /** Contract name or id. */
  contract: string;
  /** Deployed contract version this row describes. */
  contractVersion: string;
  /** SDK versions that support this contract version. */
  sdkRange: SdkVersionRange;
  /** Capabilities the SDK expects this contract version to expose. */
  requiredCapabilities?: string[];
}

/** A single compatibility problem. */
export interface CompatibilityIssue {
  /** Registered SDK error code describing the problem. */
  code: SdkErrorCode | string;
  /** Human-readable explanation. */
  message: string;
}

/** Result of a compatibility check. */
export interface CompatibilityResult {
  /** True when there are no issues. */
  compatible: boolean;
  /** SDK version that was checked. */
  sdkVersion: string;
  /** Contract that was checked. */
  contract: string;
  /** Contract version that was checked. */
  contractVersion: string;
  /** Problems found (empty when compatible). */
  issues: CompatibilityIssue[];
}

/** Inputs to {@link checkCompatibility}. */
export interface CompatibilityQuery {
  /** SDK version in use. */
  sdkVersion: string;
  /** Contract name or id. */
  contract: string;
  /** Deployed contract version to validate against. */
  contractVersion: string;
  /**
   * Capabilities the backend advertises for this contract. When provided, the
   * matrix's `requiredCapabilities` are checked against this set.
   */
  backendCapabilities?: string[];
}

/**
 * A registry of compatibility rows, keyed by `(contract, contractVersion)`.
 * Populate it from static release metadata or backend responses, then run
 * {@link check} / {@link assert} for each SDK ↔ contract pairing.
 */
export class CompatibilityMatrix {
  private entries = new Map<string, CompatibilityMatrixEntry>();

  constructor(entries: CompatibilityMatrixEntry[] = []) {
    for (const e of entries) this.register(e);
  }

  private static key(contract: string, contractVersion: string): string {
    return `${contract}@${contractVersion}`;
  }

  /** Add or replace a matrix row. */
  register(entry: CompatibilityMatrixEntry): this {
    this.entries.set(
      CompatibilityMatrix.key(entry.contract, entry.contractVersion),
      entry
    );
    return this;
  }

  /** All rows recorded for a contract. */
  entriesFor(contract: string): CompatibilityMatrixEntry[] {
    return [...this.entries.values()].filter((e) => e.contract === contract);
  }

  /** Run a structured compatibility check. Never throws. */
  check(query: CompatibilityQuery): CompatibilityResult {
    const issues: CompatibilityIssue[] = [];
    const entry = this.entries.get(
      CompatibilityMatrix.key(query.contract, query.contractVersion)
    );

    if (!entry) {
      issues.push({
        code: "CONTRACT_VERSION_UNSUPPORTED",
        message: `No compatibility entry for ${query.contract}@${query.contractVersion}`,
      });
      return this.result(query, issues);
    }

    if (!isVersionInRange(query.sdkVersion, entry.sdkRange)) {
      issues.push({
        code: "COMPATIBILITY_ERROR",
        message:
          `SDK ${query.sdkVersion} is outside the supported range ` +
          `[${entry.sdkRange.min ?? "*"}, ${entry.sdkRange.max ?? "*"}] ` +
          `for ${query.contract}@${query.contractVersion}`,
      });
    }

    const required = entry.requiredCapabilities ?? [];
    if (required.length > 0 && query.backendCapabilities) {
      const advertised = new Set(query.backendCapabilities);
      const missing = required.filter((c) => !advertised.has(c));
      if (missing.length > 0) {
        issues.push({
          code: "CAPABILITY_UNSUPPORTED",
          message:
            `${query.contract}@${query.contractVersion} is missing required ` +
            `capabilities: ${missing.join(", ")}`,
        });
      }
    }

    return this.result(query, issues);
  }

  /**
   * Guardrail: run {@link check} and throw a typed {@link SdkError} on the first
   * issue. Returns the {@link CompatibilityResult} when compatible.
   */
  assert(query: CompatibilityQuery): CompatibilityResult {
    const result = this.check(query);
    if (!result.compatible) {
      const first = result.issues[0];
      throw ErrorRegistry.createError(first.code, {
        message: first.message,
        details: {
          sdkVersion: query.sdkVersion,
          contract: query.contract,
          contractVersion: query.contractVersion,
          issues: result.issues,
        },
      });
    }
    return result;
  }

  private result(
    query: CompatibilityQuery,
    issues: CompatibilityIssue[]
  ): CompatibilityResult {
    return {
      compatible: issues.length === 0,
      sdkVersion: query.sdkVersion,
      contract: query.contract,
      contractVersion: query.contractVersion,
      issues,
    };
  }
}

/** One-off structured compatibility check against a matrix. */
export function checkCompatibility(
  matrix: CompatibilityMatrix,
  query: CompatibilityQuery
): CompatibilityResult {
  return matrix.check(query);
}

/** One-off guardrail that throws on incompatibility. */
export function assertCompatible(
  matrix: CompatibilityMatrix,
  query: CompatibilityQuery
): CompatibilityResult {
  return matrix.assert(query);
}
