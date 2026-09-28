/**
 * Change control for executable prompt and policy configuration (Issue #665).
 *
 * A prompt or policy revision changes financial behaviour at runtime, so the
 * control plane treats it exactly like code:
 *
 *  - revisions are content-addressed (SHA-256 digest) and signed by their author,
 *  - activation needs a signed approval quorum from distinct, non-author reviewers,
 *  - production refuses unversioned mutations outright,
 *  - rollouts are staged across canary cohorts with an automatic rollback verdict,
 *  - emergency changes are time-bounded and land in a hash-chained audit trail.
 *
 * The module is deliberately free of I/O so the policy can be unit-tested and
 * reused by the TypeORM-backed services.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type ChangeEnvironment = "development" | "staging" | "production";

/** Fields that make up the immutable, signed identity of a revision. */
const REVISION_FIELDS = [
  "id",
  "name",
  "type",
  "version",
  "content",
  "author",
  "createdAt",
  "changeTicket",
  "emergency",
  "emergencyExpiresAt",
] as const;

export interface RevisionPayload {
  id: string;
  name: string;
  type: string;
  version: string;
  content: string;
  /** GitHub login / operator id of the person who authored the revision. */
  author: string;
  /** ISO-8601 timestamp the revision was authored at. */
  createdAt: string;
  /** Change-management ticket id; mandatory in production. */
  changeTicket?: string;
  /** Emergency (break-glass) revisions are time-bounded. */
  emergency?: boolean;
  /** ISO-8601 expiry; mandatory for emergency revisions. */
  emergencyExpiresAt?: string;
}

export interface RevisionApproval {
  approver: string;
  /** ISO-8601 timestamp the approval was recorded at. */
  approvedAt: string;
  signature: string;
}

export interface SignedRevision extends RevisionPayload {
  digest: string;
  signature: string;
  approvals: RevisionApproval[];
}

export interface ChangeControlPolicy {
  environment: ChangeEnvironment;
  /** HMAC key used to sign and verify revisions and approvals. */
  secret: string;
  /** Distinct approvals required on top of the author signature. */
  approvalsRequired: number;
  requireChangeTicket: boolean;
}

export type ChangeControlErrorCode =
  | "MISSING_AUTHOR"
  | "SIGNATURE_INVALID"
  | "APPROVAL_SIGNATURE_INVALID"
  | "DUPLICATE_APPROVAL"
  | "SELF_APPROVAL"
  | "QUORUM_NOT_MET"
  | "MISSING_CHANGE_TICKET"
  | "UNVERSIONED_MUTATION"
  | "MISSING_SIGNING_KEY"
  | "EMERGENCY_TTL_EXCEEDED"
  | "EMERGENCY_EXPIRED"
  | "EMERGENCY_NOT_BOUND"
  | "INVALID_CANARY_PLAN"
  | "ROLLBACK_TARGET_UNAVAILABLE"
  | "AUDIT_TRAIL_BROKEN";

export class PromptChangeControlError extends Error {
  readonly code: ChangeControlErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: ChangeControlErrorCode,
    message: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "PromptChangeControlError";
    this.code = code;
    this.details = details;
  }
}

/**
 * HTTP status for a change-control rejection, so API routes can return a
 * structured response instead of a generic 500.
 */
export function changeControlHttpStatus(
  error: PromptChangeControlError
): number {
  switch (error.code) {
    case "MISSING_AUTHOR":
    case "SIGNATURE_INVALID":
    case "APPROVAL_SIGNATURE_INVALID":
    case "SELF_APPROVAL":
    case "DUPLICATE_APPROVAL":
    case "MISSING_CHANGE_TICKET":
    case "UNVERSIONED_MUTATION":
    case "MISSING_SIGNING_KEY":
    case "EMERGENCY_NOT_BOUND":
      return 403;
    case "EMERGENCY_TTL_EXCEEDED":
    case "EMERGENCY_EXPIRED":
    case "ROLLBACK_TARGET_UNAVAILABLE":
    case "AUDIT_TRAIL_BROKEN":
      return 409;
    case "QUORUM_NOT_MET":
    case "INVALID_CANARY_PLAN":
      return 422;
  }
}

/** Maximum lifetime of a break-glass emergency change: one hour. */
export const MAX_EMERGENCY_TTL_MS = 60 * 60 * 1000;
export const MAX_EMERGENCY_TTL_SECONDS = MAX_EMERGENCY_TTL_MS / 1000;
/** Emergency changes still require one reviewer that is not the author. */
export const EMERGENCY_APPROVALS_REQUIRED = 1;
/** Emergency reasons must be descriptive enough to audit. */
export const MIN_EMERGENCY_REASON_LENGTH = 10;
export const EMERGENCY_TICKET_PREFIX = "INC-";

function canonicalize(value: unknown): string {
  if (value === undefined || value === null) {
    return "null";
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(",")}}`;
}

function hmac(secret: string, material: string): string {
  return createHmac("sha256", secret).update(material).digest("hex");
}

/** Constant-time string comparison that never throws on length mismatch. */
function safeEqual(left: unknown, right: unknown): boolean {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * SHA-256 over the canonical revision material. Only the declared
 * `REVISION_FIELDS` participate, so injecting extra keys cannot change the
 * digest of an already-signed revision.
 */
export function revisionDigest(payload: RevisionPayload): string {
  const material: Record<string, unknown> = {};
  for (const field of REVISION_FIELDS) {
    material[field] = payload[field] ?? null;
  }
  return createHash("sha256").update(canonicalize(material)).digest("hex");
}

/** Sign a revision, binding the content digest to its author. */
export function signRevision(
  payload: RevisionPayload,
  secret: string,
  approvals: RevisionApproval[] = []
): SignedRevision {
  if (!payload.author || !payload.author.trim()) {
    throw new PromptChangeControlError(
      "MISSING_AUTHOR",
      "A revision must record its author before it can be signed",
      { revisionId: payload.id }
    );
  }
  const digest = revisionDigest(payload);
  return {
    ...payload,
    digest,
    signature: hmac(secret, `${digest}:${payload.author}`),
    approvals: [...approvals],
  };
}

/** Verify that the revision signature matches its content and author. */
export function verifyRevisionSignature(
  revision: SignedRevision,
  secret: string
): boolean {
  if (!revision.author || !revision.author.trim()) {
    return false;
  }
  return safeEqual(
    hmac(secret, `${revisionDigest(revision)}:${revision.author}`),
    revision.signature
  );
}

export function approvalMaterial(
  revisionId: string,
  digest: string,
  approver: string,
  approvedAt: string
): string {
  return `${revisionId}:${digest}:${approver}:${approvedAt}`;
}

/** Record a review approval bound to the exact revision digest. */
export function signApproval(
  revision: SignedRevision,
  approver: string,
  approvedAt: string,
  secret: string
): RevisionApproval {
  return {
    approver,
    approvedAt,
    signature: hmac(
      secret,
      approvalMaterial(revision.id, revision.digest, approver, approvedAt)
    ),
  };
}

export function verifyApproval(
  revision: SignedRevision,
  approval: RevisionApproval,
  secret: string
): boolean {
  return safeEqual(
    hmac(
      secret,
      approvalMaterial(revision.id, revision.digest, approval.approver, approval.approvedAt)
    ),
    approval.signature
  );
}

function checkQuorum(revision: SignedRevision, policy: ChangeControlPolicy): number {
  const required = revision.emergency
    ? EMERGENCY_APPROVALS_REQUIRED
    : policy.approvalsRequired;
  const seen = new Set<string>();
  const valid: RevisionApproval[] = [];

  for (const approval of revision.approvals ?? []) {
    if (!approval || !approval.approver) {
      throw new PromptChangeControlError(
        "APPROVAL_SIGNATURE_INVALID",
        "Every approval must name its approver",
        { revisionId: revision.id }
      );
    }
    if (seen.has(approval.approver)) {
      throw new PromptChangeControlError(
        "DUPLICATE_APPROVAL",
        "A reviewer may only sign a revision once",
        { revisionId: revision.id, approver: approval.approver }
      );
    }
    seen.add(approval.approver);
    if (approval.approver === revision.author) {
      throw new PromptChangeControlError(
        "SELF_APPROVAL",
        "An author may not approve their own revision",
        { revisionId: revision.id, approver: approval.approver }
      );
    }
    if (!verifyApproval(revision, approval, policy.secret)) {
      throw new PromptChangeControlError(
        "APPROVAL_SIGNATURE_INVALID",
        "Approval signature does not match the revision digest",
        { revisionId: revision.id, approver: approval.approver }
      );
    }
    valid.push(approval);
  }

  if (valid.length < required) {
    throw new PromptChangeControlError(
      "QUORUM_NOT_MET",
      `Revision requires ${required} independent approval(s), received ${valid.length}`,
      { revisionId: revision.id, required, received: valid.length }
    );
  }

  return valid.length;
}

function assertEmergencyWindow(
  revision: SignedRevision,
  now: Date
): void {
  if (!revision.emergency) {
    return;
  }
  if (!revision.emergencyExpiresAt) {
    throw new PromptChangeControlError(
      "EMERGENCY_NOT_BOUND",
      "Emergency revisions must carry an explicit expiry",
      { revisionId: revision.id }
    );
  }
  const issuedAt = Date.parse(revision.createdAt);
  const expiresAt = Date.parse(revision.emergencyExpiresAt);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(issuedAt)) {
    throw new PromptChangeControlError(
      "EMERGENCY_NOT_BOUND",
      "Emergency revisions need parseable ISO-8601 timestamps",
      { revisionId: revision.id }
    );
  }
  if (expiresAt - issuedAt > MAX_EMERGENCY_TTL_MS) {
    throw new PromptChangeControlError(
      "EMERGENCY_TTL_EXCEEDED",
      `Emergency revision may not outlive ${MAX_EMERGENCY_TTL_SECONDS}s`,
      { revisionId: revision.id, ttlMs: expiresAt - issuedAt }
    );
  }
  if (expiresAt <= now.getTime()) {
    throw new PromptChangeControlError(
      "EMERGENCY_EXPIRED",
      "Emergency revision has expired",
      { revisionId: revision.id, expiresAt: revision.emergencyExpiresAt }
    );
  }
}

/**
 * Full authorisation check: signature, approval quorum, change ticket and (for
 * emergency revisions) the time-bounded window.
 */
export function assertRevisionAuthorized(
  revision: SignedRevision,
  policy: ChangeControlPolicy,
  now: Date = new Date()
): void {
  if (!verifyRevisionSignature(revision, policy.secret)) {
    throw new PromptChangeControlError(
      "SIGNATURE_INVALID",
      "Revision signature is missing or does not match its content",
      { revisionId: revision.id }
    );
  }
  checkQuorum(revision, policy);
  if (policy.requireChangeTicket && !revision.changeTicket?.trim()) {
    throw new PromptChangeControlError(
      "MISSING_CHANGE_TICKET",
      "Production revisions must reference a change ticket",
      { revisionId: revision.id }
    );
  }
  assertEmergencyWindow(revision, now);
}

/**
 * Gate every mutation of live prompt/policy state. In production the mutation
 * must be driven by a signed, approved revision — direct unversioned writes are
 * rejected.
 */
export function assertMutationAllowed(
  policy: ChangeControlPolicy,
  revision: SignedRevision | null | undefined,
  now: Date = new Date()
): void {
  if (policy.environment !== "production") {
    if (revision) {
      assertRevisionAuthorized(revision, policy, now);
    }
    return;
  }
  if (!policy.secret) {
    throw new PromptChangeControlError(
      "MISSING_SIGNING_KEY",
      "Production change control requires PROMPT_CHANGE_CONTROL_SECRET",
      { environment: policy.environment }
    );
  }
  if (!revision) {
    throw new PromptChangeControlError(
      "UNVERSIONED_MUTATION",
      "Production prompt/policy mutations require a signed, approved revision",
      { environment: policy.environment }
    );
  }
  assertRevisionAuthorized(revision, policy, now);
}

/** Resolve the change-control policy from the process environment. */
export function policyFromEnv(
  env: Record<string, string | undefined> = process.env
): ChangeControlPolicy {
  const rawEnvironment = env.PROMPT_CHANGE_CONTROL_ENV ?? env.NODE_ENV ?? "development";
  const environment = (
    ["development", "staging", "production"].includes(rawEnvironment)
      ? rawEnvironment
      : "production"
  ) as ChangeEnvironment;
  const parsedQuorum = Number.parseInt(
    env.PROMPT_CHANGE_APPROVALS_REQUIRED ?? "2",
    10
  );

  return {
    environment,
    secret: env.PROMPT_CHANGE_CONTROL_SECRET ?? "",
    approvalsRequired: Number.isFinite(parsedQuorum) && parsedQuorum > 0 ? parsedQuorum : 2,
    requireChangeTicket: environment === "production",
  };
}

// ---------------------------------------------------------------------------
// Staged rollout: canary cohorts + automatic rollback
// ---------------------------------------------------------------------------

export interface CanaryCohort {
  name: string;
  /** Share of production traffic, 0 < percentage <= 100. */
  percentage: number;
}

export interface CanaryPlan {
  revisionId: string;
  rollbackRevisionId: string;
  stages: CanaryCohort[];
  maxPercentPerStage: number;
}

export interface CanaryMetrics {
  total: number;
  successRate: number;
}

export interface RollbackPolicy {
  autoRollbackThreshold: number;
  minExecutionsBeforePolicy: number;
}

export type CanaryAction = "hold" | "promote" | "rollback";

export interface CanaryVerdict {
  action: CanaryAction;
  reason: string;
  successRatePercent: number;
  executions: number;
}

/**
 * Build a staged canary rollout. Cohorts must be unique, strictly widening and
 * never exceed 100% of traffic.
 */
export function planCanaryRollout(
  revisionId: string,
  rollbackRevisionId: string,
  cohorts: CanaryCohort[]
): CanaryPlan {
  if (!revisionId || !rollbackRevisionId || revisionId === rollbackRevisionId) {
    throw new PromptChangeControlError(
      "ROLLBACK_TARGET_UNAVAILABLE",
      "A canary rollout needs a distinct rollback revision",
      { revisionId, rollbackRevisionId }
    );
  }
  if (!cohorts.length) {
    throw new PromptChangeControlError(
      "INVALID_CANARY_PLAN",
      "A canary rollout needs at least one cohort",
      { revisionId }
    );
  }

  const names = new Set<string>();
  let previous = 0;
  for (const cohort of cohorts) {
    if (!cohort.name || names.has(cohort.name)) {
      throw new PromptChangeControlError(
        "INVALID_CANARY_PLAN",
        "Canary cohort names must be unique",
        { revisionId, name: cohort.name }
      );
    }
    names.add(cohort.name);
    if (
      !Number.isFinite(cohort.percentage) ||
      cohort.percentage <= 0 ||
      cohort.percentage > 100
    ) {
      throw new PromptChangeControlError(
        "INVALID_CANARY_PLAN",
        "Canary cohort percentages must be within (0, 100]",
        { revisionId, name: cohort.name, percentage: cohort.percentage }
      );
    }
    if (cohort.percentage <= previous) {
      throw new PromptChangeControlError(
        "INVALID_CANARY_PLAN",
        "Canary cohorts must widen monotonically",
        { revisionId, name: cohort.name, percentage: cohort.percentage }
      );
    }
    previous = cohort.percentage;
  }

  return {
    revisionId,
    rollbackRevisionId,
    stages: cohorts.map((cohort) => ({ ...cohort })),
    maxPercentPerStage: previous,
  };
}

/** Next cohort to expose, or null once the plan is fully rolled out. */
export function nextCanaryStage(
  plan: CanaryPlan,
  currentCohortName: string | null
): CanaryCohort | null {
  const index = plan.stages.findIndex((stage) => stage.name === currentCohortName);
  if (index === -1) {
    return plan.stages[0] ?? null;
  }
  return plan.stages[index + 1] ?? null;
}

/**
 * Automatic rollback verdict: hold until the policy has enough executions,
 * roll back when the success rate drops below the threshold, otherwise promote.
 */
export function evaluateCanaryHealth(
  metrics: CanaryMetrics,
  policy: RollbackPolicy
): CanaryVerdict {
  const executions = metrics.total;
  const successRatePercent = Math.round(metrics.successRate * 10000) / 100;

  if (executions < policy.minExecutionsBeforePolicy) {
    return {
      action: "hold",
      reason: "insufficient-executions",
      successRatePercent,
      executions,
    };
  }
  if (successRatePercent < policy.autoRollbackThreshold) {
    return {
      action: "rollback",
      reason: "success-rate-below-threshold",
      successRatePercent,
      executions,
    };
  }
  return {
    action: "promote",
    reason: "success-rate-within-threshold",
    successRatePercent,
    executions,
  };
}

/** Rollback is only possible when the target exists and is not the candidate. */
export function assertRollbackTargetAvailable(
  plan: CanaryPlan,
  availableRevisionIds: readonly string[]
): void {
  if (
    plan.rollbackRevisionId === plan.revisionId ||
    !availableRevisionIds.includes(plan.rollbackRevisionId)
  ) {
    throw new PromptChangeControlError(
      "ROLLBACK_TARGET_UNAVAILABLE",
      "Rollback revision is missing or identical to the candidate",
      {
        revisionId: plan.revisionId,
        rollbackRevisionId: plan.rollbackRevisionId,
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Break-glass emergency changes
// ---------------------------------------------------------------------------

export interface EmergencyGrantInput {
  changeId: string;
  author: string;
  approver: string;
  reason: string;
  ticket: string;
  issuedAt: string;
  ttlSeconds: number;
}

export interface EmergencyGrantFields {
  changeId: string;
  author: string;
  approver: string;
  reason: string;
  ticket: string;
  issuedAt: string;
  expiresAt: string;
}

export interface EmergencyGrant extends EmergencyGrantFields {
  signature: string;
}

function emergencyMaterial(grant: EmergencyGrantFields): string {
  return canonicalize({
    changeId: grant.changeId,
    author: grant.author,
    approver: grant.approver,
    reason: grant.reason,
    ticket: grant.ticket,
    issuedAt: grant.issuedAt,
    expiresAt: grant.expiresAt,
  });
}

/**
 * Issue a time-bounded break-glass grant. Emergency changes still need a
 * distinct reviewer, a real incident ticket and a bounded TTL.
 */
export function createEmergencyGrant(
  input: EmergencyGrantInput,
  secret: string
): EmergencyGrant {
  if (!input.author || !input.approver || input.author === input.approver) {
    throw new PromptChangeControlError(
      "SELF_APPROVAL",
      "Emergency changes require a reviewer that is not the author",
      { changeId: input.changeId }
    );
  }
  if (!input.ticket?.startsWith(EMERGENCY_TICKET_PREFIX)) {
    throw new PromptChangeControlError(
      "MISSING_CHANGE_TICKET",
      `Emergency changes require a ${EMERGENCY_TICKET_PREFIX}* incident ticket`,
      { changeId: input.changeId, ticket: input.ticket }
    );
  }
  if (!input.reason || input.reason.trim().length < MIN_EMERGENCY_REASON_LENGTH) {
    throw new PromptChangeControlError(
      "EMERGENCY_NOT_BOUND",
      "Emergency changes require an auditable reason",
      { changeId: input.changeId }
    );
  }
  if (
    !Number.isFinite(input.ttlSeconds) ||
    input.ttlSeconds <= 0 ||
    input.ttlSeconds > MAX_EMERGENCY_TTL_SECONDS
  ) {
    throw new PromptChangeControlError(
      "EMERGENCY_TTL_EXCEEDED",
      `Emergency TTL must be within (0, ${MAX_EMERGENCY_TTL_SECONDS}] seconds`,
      { changeId: input.changeId, ttlSeconds: input.ttlSeconds }
    );
  }

  const issuedAtMs = Date.parse(input.issuedAt);
  if (!Number.isFinite(issuedAtMs)) {
    throw new PromptChangeControlError(
      "EMERGENCY_NOT_BOUND",
      "Emergency changes need a parseable ISO-8601 issuedAt",
      { changeId: input.changeId }
    );
  }

  const unsigned: EmergencyGrantFields = {
    changeId: input.changeId,
    author: input.author,
    approver: input.approver,
    reason: input.reason.trim(),
    ticket: input.ticket,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(issuedAtMs + input.ttlSeconds * 1000).toISOString(),
  };

  return {
    ...unsigned,
    signature: hmac(secret, emergencyMaterial(unsigned)),
  };
}

export function verifyEmergencyGrant(grant: EmergencyGrant, secret: string): boolean {
  return safeEqual(
    hmac(secret, emergencyMaterial(grant)),
    grant.signature
  );
}

/** Reject expired or tampered break-glass grants. */
export function assertEmergencyGrantActive(
  grant: EmergencyGrant,
  now: Date = new Date(),
  secret?: string
): void {
  if (secret && !verifyEmergencyGrant(grant, secret)) {
    throw new PromptChangeControlError(
      "SIGNATURE_INVALID",
      "Emergency grant signature is invalid",
      { changeId: grant.changeId }
    );
  }
  if (Date.parse(grant.expiresAt) <= now.getTime()) {
    throw new PromptChangeControlError(
      "EMERGENCY_EXPIRED",
      "Emergency grant has expired and access must be re-approved",
      { changeId: grant.changeId, expiresAt: grant.expiresAt }
    );
  }
}

// ---------------------------------------------------------------------------
// Append-only audit trail
// ---------------------------------------------------------------------------

export interface AuditRecord {
  sequence: number;
  at: string;
  actor: string;
  action: string;
  subject: string;
  previousHash: string | null;
  hash: string;
}

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  subject: string;
}

/**
 * Append a record to the audit chain. Each hash covers the previous hash, so
 * removing or editing history invalidates every subsequent record.
 */
export function appendAuditRecord(
  previous: AuditRecord | null,
  entry: AuditEntry
): AuditRecord {
  const sequence = previous ? previous.sequence + 1 : 1;
  const previousHash = previous ? previous.hash : null;
  const hash = createHash("sha256")
    .update(
      canonicalize({
        sequence,
        at: entry.at,
        actor: entry.actor,
        action: entry.action,
        subject: entry.subject,
        previousHash,
      })
    )
    .digest("hex");

  return { ...entry, sequence, previousHash, hash };
}

export function verifyAuditTrail(records: readonly AuditRecord[]): boolean {
  let previous: AuditRecord | null = null;
  for (const record of records) {
    const expected = appendAuditRecord(previous, {
      at: record.at,
      actor: record.actor,
      action: record.action,
      subject: record.subject,
    });
    if (expected.hash !== record.hash || expected.sequence !== record.sequence) {
      return false;
    }
    previous = record;
  }
  return true;
}

export function assertAuditTrailIntact(records: readonly AuditRecord[]): void {
  if (!verifyAuditTrail(records)) {
    throw new PromptChangeControlError(
      "AUDIT_TRAIL_BROKEN",
      "Audit trail hash chain is broken",
      { records: records.length }
    );
  }
}

export const promptChangeControl = {
  revisionDigest,
  signRevision,
  verifyRevisionSignature,
  signApproval,
  verifyApproval,
  assertRevisionAuthorized,
  assertMutationAllowed,
  changeControlHttpStatus,
  policyFromEnv,
  planCanaryRollout,
  nextCanaryStage,
  evaluateCanaryHealth,
  assertRollbackTargetAvailable,
  createEmergencyGrant,
  verifyEmergencyGrant,
  assertEmergencyGrantActive,
  appendAuditRecord,
  verifyAuditTrail,
  assertAuditTrailIntact,
};

export default promptChangeControl;
