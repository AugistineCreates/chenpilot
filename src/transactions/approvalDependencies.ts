import { createHash } from "crypto";

/**
 * Approvals bound to the economic inputs they were granted under.
 *
 * Every material input carries a version. The versions are hashed into the
 * approval digest, so any revision (asset metadata, issuer status, route, fee
 * policy, contract version) invalidates the approval. `submitWithApproval`
 * re-reads the dependencies immediately before submitting, so an invalidation
 * that races the approval can never reach submission.
 */

export interface ApprovalDependencies {
  assetMetadataVersion: string;
  issuerStatusVersion: string;
  routeVersion: string;
  feePolicyVersion: string;
  contractVersion: string;
}

export type DependencyName = keyof ApprovalDependencies;

export const DEPENDENCY_NAMES: readonly DependencyName[] = [
  "assetMetadataVersion",
  "issuerStatusVersion",
  "routeVersion",
  "feePolicyVersion",
  "contractVersion",
];

const REAPPROVAL_REASONS: Record<DependencyName, string> = {
  assetMetadataVersion: "Asset details changed since you approved.",
  issuerStatusVersion: "The asset issuer's status changed since you approved.",
  routeVersion: "The execution route changed since you approved.",
  feePolicyVersion: "Fees changed since you approved.",
  contractVersion: "The contract was upgraded since you approved.",
};

export interface Approval {
  digest: string;
  dependencies: ApprovalDependencies;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function approvalDigest(payload: unknown, dependencies: ApprovalDependencies): string {
  return createHash("sha256").update(canonical({ payload, dependencies })).digest("hex");
}

export function createApproval(payload: unknown, dependencies: ApprovalDependencies): Approval {
  return { digest: approvalDigest(payload, { ...dependencies }), dependencies: { ...dependencies } };
}

export type ApprovalCheck =
  | { valid: true }
  | { valid: false; changed: DependencyName[]; reasons: string[] };

export function checkApproval(
  approval: Approval,
  payload: unknown,
  current: ApprovalDependencies,
): ApprovalCheck {
  const changed = DEPENDENCY_NAMES.filter((n) => approval.dependencies[n] !== current[n]);
  if (changed.length === 0 && approvalDigest(payload, current) === approval.digest) {
    return { valid: true };
  }
  if (changed.length === 0) {
    return { valid: false, changed: [], reasons: ["The transaction changed since you approved."] };
  }
  return { valid: false, changed, reasons: changed.map((n) => REAPPROVAL_REASONS[n]) };
}

export class ReapprovalRequiredError extends Error {
  constructor(readonly check: Extract<ApprovalCheck, { valid: false }>) {
    super(`Reapproval required: ${check.reasons.join(" ")}`);
    this.name = "ReapprovalRequiredError";
  }
}

/**
 * Re-reads the current dependencies right before submission and refuses to
 * submit if any changed. `readDependencies` must read from the same source of
 * truth the submission path uses.
 */
export async function submitWithApproval<T>(
  approval: Approval,
  payload: unknown,
  readDependencies: () => Promise<ApprovalDependencies>,
  submit: () => Promise<T>,
): Promise<T> {
  const check = checkApproval(approval, payload, await readDependencies());
  if (!check.valid) throw new ReapprovalRequiredError(check);
  return submit();
}
