/**
 * Trustline operations for the unified advanced operations package.
 *
 * `trustline.ts` already provides a rich workflow builder that talks to
 * Horizon. This module supplies the network-free descriptor, validation and
 * normalization layer that the workflow builder and the offline signing
 * pipeline can both consume, so trustlines validate identically whether or
 * not a Horizon connection is available.
 */

import {
  AdvancedOperationKind,
  type TrustlineOperation,
  type TrustlineParams,
  type ValidationIssue,
  type ValidationReport,
} from "./types";
import {
  MAX_TRUST_LIMIT,
  error,
  isAccountId,
  isAmount,
  isAssetCode,
  toReport,
  warning,
} from "./validation";

type TrustlineKind = TrustlineOperation["kind"];

/** Build a descriptor that establishes a new trustline. */
export function createTrustline(
  params: TrustlineParams,
  metadata?: Record<string, unknown>
): TrustlineOperation {
  return { kind: AdvancedOperationKind.TRUSTLINE_CREATE, params, metadata };
}

/** Build a descriptor that changes the limit of an existing trustline. */
export function updateTrustlineLimit(
  params: TrustlineParams,
  metadata?: Record<string, unknown>
): TrustlineOperation {
  return { kind: AdvancedOperationKind.TRUSTLINE_UPDATE, params, metadata };
}

/**
 * Build a descriptor that removes a trustline.
 *
 * The limit is forced to `"0"`, which is how Stellar expresses removal.
 */
export function removeTrustline(
  params: Omit<TrustlineParams, "limit">,
  metadata?: Record<string, unknown>
): TrustlineOperation {
  return {
    kind: AdvancedOperationKind.TRUSTLINE_REMOVE,
    params: { ...params, limit: "0" },
    metadata,
  };
}

/** Validate trustline parameters for a given operation kind. */
export function validateTrustlineParams(
  kind: TrustlineKind,
  params: TrustlineParams
): ValidationReport {
  const issues: ValidationIssue[] = [];

  if (!params || typeof params !== "object") {
    return toReport([
      error("", "MISSING_PARAMS", "Trustline parameters are required"),
    ]);
  }

  if (!isAssetCode(params.assetCode)) {
    issues.push(
      error(
        "assetCode",
        "INVALID_ASSET_CODE",
        "Asset code must be 1–12 alphanumeric characters"
      )
    );
  } else if (params.assetCode.toUpperCase() === "XLM") {
    issues.push(
      error(
        "assetCode",
        "NATIVE_ASSET_NOT_TRUSTABLE",
        "The native asset (XLM) does not require a trustline"
      )
    );
  }

  if (!isAccountId(params.assetIssuer)) {
    issues.push(
      error(
        "assetIssuer",
        "INVALID_ACCOUNT_ID",
        "Asset issuer must be a valid Stellar account id (G...)"
      )
    );
  }

  if (params.account !== undefined && !isAccountId(params.account)) {
    issues.push(
      error(
        "account",
        "INVALID_ACCOUNT_ID",
        "Account must be a valid Stellar account id (G...)"
      )
    );
  }

  if (
    params.account !== undefined &&
    isAccountId(params.account) &&
    params.account === params.assetIssuer
  ) {
    issues.push(
      error(
        "account",
        "SELF_TRUSTLINE",
        "An issuing account cannot hold a trustline to its own asset"
      )
    );
  }

  if (kind === AdvancedOperationKind.TRUSTLINE_REMOVE) {
    if (params.limit !== undefined && Number(params.limit) !== 0) {
      issues.push(
        error(
          "limit",
          "INVALID_REMOVAL_LIMIT",
          "Removing a trustline requires a limit of 0"
        )
      );
    }
  } else if (params.limit !== undefined) {
    if (!isAmount(params.limit)) {
      issues.push(
        error(
          "limit",
          "INVALID_LIMIT",
          "Limit must be a non-negative decimal with at most 7 decimal places"
        )
      );
    } else if (Number(params.limit) === 0) {
      issues.push(
        warning(
          "limit",
          "ZERO_LIMIT_REMOVES_TRUSTLINE",
          "A limit of 0 removes the trustline; use removeTrustline to be explicit"
        )
      );
    } else if (Number(params.limit) > Number(MAX_TRUST_LIMIT)) {
      issues.push(
        error(
          "limit",
          "LIMIT_EXCEEDS_MAXIMUM",
          `Limit must not exceed ${MAX_TRUST_LIMIT}`
        )
      );
    }
  }

  return toReport(issues);
}

/**
 * Normalize trustline parameters.
 *
 * Asset codes keep their case (Stellar treats them case-sensitively) but are
 * trimmed, and an omitted limit is defaulted to the protocol maximum so
 * downstream consumers never have to special-case `undefined`.
 *
 * @throws {Error} when `params` fail {@link validateTrustlineParams}.
 */
export function normalizeTrustlineParams(
  kind: TrustlineKind,
  params: TrustlineParams
): Record<string, unknown> {
  const report = validateTrustlineParams(kind, params);
  if (!report.valid) {
    throw new Error(
      `Invalid trustline: ${report.errors.map((issue) => issue.message).join("; ")}`
    );
  }

  const limit =
    kind === AdvancedOperationKind.TRUSTLINE_REMOVE
      ? "0"
      : (params.limit ?? MAX_TRUST_LIMIT);

  return {
    assetCode: params.assetCode.trim(),
    assetIssuer: params.assetIssuer.trim(),
    limit,
    ...(params.account ? { account: params.account.trim() } : {}),
  };
}

/** One-line human-readable description, used in plan summaries and reviews. */
export function describeTrustline(
  kind: TrustlineKind,
  params: TrustlineParams
): string {
  const asset = `${params.assetCode}:${params.assetIssuer}`;
  switch (kind) {
    case AdvancedOperationKind.TRUSTLINE_CREATE:
      return `Create trustline to ${asset} (limit ${params.limit ?? MAX_TRUST_LIMIT})`;
    case AdvancedOperationKind.TRUSTLINE_UPDATE:
      return `Update trustline limit for ${asset} to ${params.limit ?? MAX_TRUST_LIMIT}`;
    case AdvancedOperationKind.TRUSTLINE_REMOVE:
      return `Remove trustline to ${asset}`;
  }
}
