/**
 * Claimable balance operations for the unified advanced operations package.
 *
 * `claimableBalance.ts` covers searching and claiming against Horizon but
 * performs almost no input validation. This module adds the descriptor,
 * validation and normalization layer used by the composer and by the offline
 * signing pipeline, matching the treatment memos and trustlines receive.
 */

import {
  AdvancedOperationKind,
  type ClaimableBalanceClaimOperation,
  type ClaimableBalanceClaimParams,
  type ClaimableBalanceCreateOperation,
  type ClaimableBalanceCreateParams,
  type ValidationIssue,
  type ValidationReport,
} from "./types";
import {
  error,
  isAccountId,
  isAssetCode,
  isBalanceId,
  isPositiveAmount,
  toReport,
  warning,
} from "./validation";

const NATIVE_ASSET_CODE = "XLM";

/** Build a descriptor that creates a claimable balance. */
export function createClaimableBalance(
  params: ClaimableBalanceCreateParams,
  metadata?: Record<string, unknown>
): ClaimableBalanceCreateOperation {
  return {
    kind: AdvancedOperationKind.CLAIMABLE_BALANCE_CREATE,
    params,
    metadata,
  };
}

/** Build a descriptor that claims an existing claimable balance. */
export function claimBalance(
  params: ClaimableBalanceClaimParams,
  metadata?: Record<string, unknown>
): ClaimableBalanceClaimOperation {
  return {
    kind: AdvancedOperationKind.CLAIMABLE_BALANCE_CLAIM,
    params,
    metadata,
  };
}

/** True when the asset described by `code`/`issuer` is native XLM. */
export function isNativeAsset(code: string, issuer?: string): boolean {
  return code.toUpperCase() === NATIVE_ASSET_CODE && !issuer;
}

/** Validate the parameters of a claimable balance creation. */
export function validateClaimableBalanceCreateParams(
  params: ClaimableBalanceCreateParams
): ValidationReport {
  const issues: ValidationIssue[] = [];

  if (!params || typeof params !== "object") {
    return toReport([
      error("", "MISSING_PARAMS", "Claimable balance parameters are required"),
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
  } else if (!isNativeAsset(params.assetCode, params.assetIssuer)) {
    if (!isAccountId(params.assetIssuer)) {
      issues.push(
        error(
          "assetIssuer",
          "INVALID_ACCOUNT_ID",
          "A non-native asset requires a valid issuer account id (G...)"
        )
      );
    }
  } else if (params.assetIssuer) {
    issues.push(
      error(
        "assetIssuer",
        "NATIVE_ASSET_HAS_ISSUER",
        "The native asset (XLM) must not specify an issuer"
      )
    );
  }

  if (!isPositiveAmount(params.amount)) {
    issues.push(
      error(
        "amount",
        "INVALID_AMOUNT",
        "Amount must be a positive decimal with at most 7 decimal places"
      )
    );
  }

  if (!Array.isArray(params.claimants) || params.claimants.length === 0) {
    issues.push(
      error(
        "claimants",
        "MISSING_CLAIMANTS",
        "At least one claimant is required"
      )
    );
  } else {
    params.claimants.forEach((claimant, index) => {
      if (!isAccountId(claimant)) {
        issues.push(
          error(
            `claimants[${index}]`,
            "INVALID_ACCOUNT_ID",
            "Claimant must be a valid Stellar account id (G...)"
          )
        );
      }
    });

    const unique = new Set(params.claimants);
    if (unique.size !== params.claimants.length) {
      issues.push(
        warning(
          "claimants",
          "DUPLICATE_CLAIMANTS",
          "Duplicate claimants were supplied; only the first predicate applies"
        )
      );
    }
  }

  return toReport(issues);
}

/** Validate the parameters of a claimable balance claim. */
export function validateClaimableBalanceClaimParams(
  params: ClaimableBalanceClaimParams
): ValidationReport {
  const issues: ValidationIssue[] = [];

  if (!params || typeof params !== "object") {
    return toReport([
      error("", "MISSING_PARAMS", "Claimable balance parameters are required"),
    ]);
  }

  if (!isBalanceId(params.balanceId)) {
    issues.push(
      error(
        "balanceId",
        "INVALID_BALANCE_ID",
        "Balance id must be a 72-character hex string"
      )
    );
  }

  if (!isAccountId(params.claimant)) {
    issues.push(
      error(
        "claimant",
        "INVALID_ACCOUNT_ID",
        "Claimant must be a valid Stellar account id (G...)"
      )
    );
  }

  return toReport(issues);
}

/**
 * Normalize claimable balance creation parameters.
 *
 * @throws {Error} when `params` fail validation.
 */
export function normalizeClaimableBalanceCreateParams(
  params: ClaimableBalanceCreateParams
): Record<string, unknown> {
  const report = validateClaimableBalanceCreateParams(params);
  if (!report.valid) {
    throw new Error(
      `Invalid claimable balance: ${report.errors
        .map((issue) => issue.message)
        .join("; ")}`
    );
  }

  const native = isNativeAsset(params.assetCode, params.assetIssuer);
  return {
    assetCode: native ? NATIVE_ASSET_CODE : params.assetCode.trim(),
    ...(native ? {} : { assetIssuer: (params.assetIssuer ?? "").trim() }),
    native,
    amount: params.amount.trim(),
    claimants: [...new Set(params.claimants.map((c) => c.trim()))],
  };
}

/**
 * Normalize claimable balance claim parameters.
 *
 * @throws {Error} when `params` fail validation.
 */
export function normalizeClaimableBalanceClaimParams(
  params: ClaimableBalanceClaimParams
): Record<string, unknown> {
  const report = validateClaimableBalanceClaimParams(params);
  if (!report.valid) {
    throw new Error(
      `Invalid claimable balance claim: ${report.errors
        .map((issue) => issue.message)
        .join("; ")}`
    );
  }

  return {
    balanceId: params.balanceId.toLowerCase(),
    claimant: params.claimant.trim(),
  };
}

/** One-line human-readable description of a claimable balance creation. */
export function describeClaimableBalanceCreate(
  params: ClaimableBalanceCreateParams
): string {
  const asset = isNativeAsset(params.assetCode, params.assetIssuer)
    ? NATIVE_ASSET_CODE
    : `${params.assetCode}:${params.assetIssuer}`;
  const count = Array.isArray(params.claimants) ? params.claimants.length : 0;
  return `Create claimable balance of ${params.amount} ${asset} for ${count} claimant(s)`;
}

/** One-line human-readable description of a claimable balance claim. */
export function describeClaimableBalanceClaim(
  params: ClaimableBalanceClaimParams
): string {
  const preview = (params.balanceId ?? "").slice(0, 16);
  return `Claim balance ${preview}… as ${params.claimant}`;
}
