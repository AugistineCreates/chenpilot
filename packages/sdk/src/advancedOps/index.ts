/**
 * Unified advanced Stellar operations.
 *
 * Memo, trustline and claimable-balance helpers previously lived in three
 * unrelated modules with three different validation styles and three
 * different result shapes. This package gives them one descriptor model, one
 * validation vocabulary and one composition pattern, while leaving the
 * original modules exported so existing callers keep working.
 *
 * @example
 * ```ts
 * import {
 *   AdvancedOperationComposer,
 *   createTrustline,
 *   textMemo,
 * } from "@chen-pilot/sdk-core";
 *
 * const plan = new AdvancedOperationComposer()
 *   .add(createTrustline({ assetCode: "USDC", assetIssuer: issuer }))
 *   .add(textMemo("onboarding"))
 *   .compose();
 * ```
 */

export * from "./types";

export {
  MAX_MEMO_ID,
  MAX_MEMO_TEXT_BYTES,
  MAX_TRUST_LIMIT,
  STELLAR_AMOUNT_PRECISION,
  isAccountId,
  isAmount,
  isAssetCode,
  isBalanceId,
  isHex32,
  isPositiveAmount,
  isUint64,
  mergeReports,
  scopeReport,
  toReport,
  utf8ByteLength,
} from "./validation";

export {
  describeMemo,
  hashMemo,
  idMemo,
  memoValueToBuffer,
  noMemo,
  normalizeMemoParams,
  returnMemo,
  textMemo,
  validateMemoParams,
} from "./memoOperations";

export {
  createTrustline,
  describeTrustline,
  normalizeTrustlineParams,
  removeTrustline,
  updateTrustlineLimit,
  validateTrustlineParams,
} from "./trustlineOperations";

export {
  claimBalance,
  createClaimableBalance,
  describeClaimableBalanceClaim,
  describeClaimableBalanceCreate,
  isNativeAsset,
  normalizeClaimableBalanceClaimParams,
  normalizeClaimableBalanceCreateParams,
  validateClaimableBalanceClaimParams,
  validateClaimableBalanceCreateParams,
} from "./claimableBalanceOperations";

export {
  AdvancedOperationComposer,
  MAX_OPERATIONS_PER_TRANSACTION,
  composeOperations,
  describeOperation,
  familyOf,
  validateOperation,
} from "./composer";
