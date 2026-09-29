/**
 * Transaction composition for the unified advanced operations package.
 *
 * The composer is the shared pattern the three operation families now agree
 * on: describe operations declaratively, validate them all at once, then emit
 * a normalized plan. It performs no network I/O and constructs no Stellar SDK
 * objects, which keeps it usable from air-gapped hosts and trivially testable.
 */

import {
  AdvancedOperationFamily,
  AdvancedOperationKind,
  type AdvancedOperation,
  type ClaimableBalanceClaimParams,
  type ClaimableBalanceCreateParams,
  type MemoParams,
  type NormalizedOperation,
  type OperationPlan,
  type TrustlineOperation,
  type TrustlineParams,
  type ValidationIssue,
  type ValidationReport,
} from "./types";
import { error, mergeReports, scopeReport, toReport } from "./validation";
import {
  describeMemo,
  normalizeMemoParams,
  validateMemoParams,
} from "./memoOperations";
import {
  describeTrustline,
  normalizeTrustlineParams,
  validateTrustlineParams,
} from "./trustlineOperations";
import {
  describeClaimableBalanceClaim,
  describeClaimableBalanceCreate,
  normalizeClaimableBalanceClaimParams,
  normalizeClaimableBalanceCreateParams,
  validateClaimableBalanceClaimParams,
  validateClaimableBalanceCreateParams,
} from "./claimableBalanceOperations";

/** Stellar caps a single transaction at 100 operations. */
export const MAX_OPERATIONS_PER_TRANSACTION = 100;

/** Map an operation kind onto the family it belongs to. */
export function familyOf(kind: AdvancedOperationKind): AdvancedOperationFamily {
  switch (kind) {
    case AdvancedOperationKind.MEMO_ATTACH:
      return AdvancedOperationFamily.MEMO;
    case AdvancedOperationKind.TRUSTLINE_CREATE:
    case AdvancedOperationKind.TRUSTLINE_UPDATE:
    case AdvancedOperationKind.TRUSTLINE_REMOVE:
      return AdvancedOperationFamily.TRUSTLINE;
    case AdvancedOperationKind.CLAIMABLE_BALANCE_CREATE:
    case AdvancedOperationKind.CLAIMABLE_BALANCE_CLAIM:
      return AdvancedOperationFamily.CLAIMABLE_BALANCE;
  }
}

/** Validate a single operation, whichever family it belongs to. */
export function validateOperation(
  operation: AdvancedOperation
): ValidationReport {
  if (!operation || typeof operation !== "object") {
    return toReport([error("", "MISSING_OPERATION", "Operation is required")]);
  }

  switch (operation.kind) {
    case AdvancedOperationKind.MEMO_ATTACH:
      return scopeReport(
        validateMemoParams(operation.params as MemoParams),
        "params"
      );
    case AdvancedOperationKind.TRUSTLINE_CREATE:
    case AdvancedOperationKind.TRUSTLINE_UPDATE:
    case AdvancedOperationKind.TRUSTLINE_REMOVE:
      return scopeReport(
        validateTrustlineParams(
          operation.kind as TrustlineOperation["kind"],
          operation.params as TrustlineParams
        ),
        "params"
      );
    case AdvancedOperationKind.CLAIMABLE_BALANCE_CREATE:
      return scopeReport(
        validateClaimableBalanceCreateParams(
          operation.params as ClaimableBalanceCreateParams
        ),
        "params"
      );
    case AdvancedOperationKind.CLAIMABLE_BALANCE_CLAIM:
      return scopeReport(
        validateClaimableBalanceClaimParams(
          operation.params as ClaimableBalanceClaimParams
        ),
        "params"
      );
    default:
      return toReport([
        error(
          "kind",
          "UNKNOWN_OPERATION_KIND",
          `Unknown operation kind: ${String((operation as AdvancedOperation).kind)}`
        ),
      ]);
  }
}

/** Produce a one-line description of any supported operation. */
export function describeOperation(operation: AdvancedOperation): string {
  switch (operation.kind) {
    case AdvancedOperationKind.MEMO_ATTACH:
      return describeMemo(operation.params as MemoParams);
    case AdvancedOperationKind.TRUSTLINE_CREATE:
    case AdvancedOperationKind.TRUSTLINE_UPDATE:
    case AdvancedOperationKind.TRUSTLINE_REMOVE:
      return describeTrustline(
        operation.kind as TrustlineOperation["kind"],
        operation.params as TrustlineParams
      );
    case AdvancedOperationKind.CLAIMABLE_BALANCE_CREATE:
      return describeClaimableBalanceCreate(
        operation.params as ClaimableBalanceCreateParams
      );
    case AdvancedOperationKind.CLAIMABLE_BALANCE_CLAIM:
      return describeClaimableBalanceClaim(
        operation.params as ClaimableBalanceClaimParams
      );
    default:
      return "Unknown operation";
  }
}

function normalizeOperation(operation: AdvancedOperation): NormalizedOperation {
  const base = {
    kind: operation.kind,
    family: familyOf(operation.kind),
    ...(operation.metadata ? { metadata: operation.metadata } : {}),
  };

  switch (operation.kind) {
    case AdvancedOperationKind.MEMO_ATTACH:
      return { ...base, params: normalizeMemoParams(operation.params as MemoParams) };
    case AdvancedOperationKind.TRUSTLINE_CREATE:
    case AdvancedOperationKind.TRUSTLINE_UPDATE:
    case AdvancedOperationKind.TRUSTLINE_REMOVE:
      return {
        ...base,
        params: normalizeTrustlineParams(
          operation.kind as TrustlineOperation["kind"],
          operation.params as TrustlineParams
        ),
      };
    case AdvancedOperationKind.CLAIMABLE_BALANCE_CREATE:
      return {
        ...base,
        params: normalizeClaimableBalanceCreateParams(
          operation.params as ClaimableBalanceCreateParams
        ),
      };
    case AdvancedOperationKind.CLAIMABLE_BALANCE_CLAIM:
      return {
        ...base,
        params: normalizeClaimableBalanceClaimParams(
          operation.params as ClaimableBalanceClaimParams
        ),
      };
    default:
      throw new Error(
        `Cannot normalize unknown operation kind: ${String(
          (operation as AdvancedOperation).kind
        )}`
      );
  }
}

/**
 * Fluent builder that accumulates advanced operations and turns them into a
 * validated {@link OperationPlan}.
 *
 * @example
 * ```ts
 * const plan = new AdvancedOperationComposer()
 *   .add(createTrustline({ assetCode: "USDC", assetIssuer }))
 *   .add(textMemo("onboarding"))
 *   .compose();
 * ```
 */
export class AdvancedOperationComposer {
  private readonly operations: AdvancedOperation[] = [];

  constructor(operations: AdvancedOperation[] = []) {
    this.addAll(operations);
  }

  /** Append a single operation. */
  add(operation: AdvancedOperation): this {
    this.operations.push(operation);
    return this;
  }

  /** Append several operations, preserving order. */
  addAll(operations: AdvancedOperation[]): this {
    operations.forEach((operation) => this.add(operation));
    return this;
  }

  /** Number of operations accumulated so far, including any memo. */
  size(): number {
    return this.operations.length;
  }

  /** Discard all accumulated operations. */
  clear(): this {
    this.operations.length = 0;
    return this;
  }

  /** One-line descriptions in the order operations were added. */
  describe(): string[] {
    return this.operations.map(describeOperation);
  }

  /**
   * Validate every accumulated operation plus the transaction-level rules
   * (single memo, operation ceiling). Never throws.
   */
  validate(): ValidationReport {
    const perOperation = this.operations.map((operation, index) =>
      scopeReport(validateOperation(operation), `operations[${index}]`)
    );

    const structural: ValidationIssue[] = [];

    const memoCount = this.operations.filter(
      (operation) => operation.kind === AdvancedOperationKind.MEMO_ATTACH
    ).length;
    if (memoCount > 1) {
      structural.push(
        error(
          "operations",
          "MULTIPLE_MEMOS",
          `A transaction may carry at most one memo (got ${memoCount})`
        )
      );
    }

    const ledgerOperations = this.operations.length - memoCount;
    if (ledgerOperations > MAX_OPERATIONS_PER_TRANSACTION) {
      structural.push(
        error(
          "operations",
          "TOO_MANY_OPERATIONS",
          `A transaction may carry at most ${MAX_OPERATIONS_PER_TRANSACTION} operations (got ${ledgerOperations})`
        )
      );
    }

    if (this.operations.length === 0) {
      structural.push(
        error("operations", "EMPTY_PLAN", "At least one operation is required")
      );
    }

    return mergeReports([...perOperation, toReport(structural)]);
  }

  /**
   * Validate and normalize into an {@link OperationPlan}.
   *
   * @throws {Error} when validation reports any `error`-severity issue.
   */
  compose(): OperationPlan {
    const validation = this.validate();
    if (!validation.valid) {
      throw new Error(
        `Cannot compose operations: ${validation.errors
          .map((issue) => `${issue.field}: ${issue.message}`)
          .join("; ")}`
      );
    }

    const normalized = this.operations.map(normalizeOperation);
    const memo = normalized.find(
      (operation) => operation.kind === AdvancedOperationKind.MEMO_ATTACH
    );
    const operations = normalized.filter(
      (operation) => operation.kind !== AdvancedOperationKind.MEMO_ATTACH
    );

    return {
      operations,
      ...(memo ? { memo } : {}),
      validation,
      summary: this.describe(),
    };
  }
}

/** Convenience wrapper around {@link AdvancedOperationComposer}. */
export function composeOperations(
  operations: AdvancedOperation[]
): OperationPlan {
  return new AdvancedOperationComposer(operations).compose();
}
