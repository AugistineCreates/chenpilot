/**
 * Change-control regression suite for executable prompt/policy configuration
 * (Issue #665).
 *
 * Covers the four acceptance criteria:
 *  1. immutable authorship + signed approval evidence per revision,
 *  2. unversioned mutation is impossible in production,
 *  3. canary cohorts with an automatic rollback verdict,
 *  4. emergency changes are time-bounded and land in a tamper-evident audit trail.
 */
import {
  MAX_EMERGENCY_TTL_SECONDS,
  PromptChangeControlError,
  appendAuditRecord,
  assertAuditTrailIntact,
  assertEmergencyGrantActive,
  assertMutationAllowed,
  assertRevisionAuthorized,
  assertRollbackTargetAvailable,
  changeControlHttpStatus,
  createEmergencyGrant,
  evaluateCanaryHealth,
  nextCanaryStage,
  planCanaryRollout,
  policyFromEnv,
  revisionDigest,
  signApproval,
  signRevision,
  verifyApproval,
  verifyAuditTrail,
  verifyEmergencyGrant,
  verifyRevisionSignature,
  type AuditRecord,
  type ChangeControlErrorCode,
  type ChangeControlPolicy,
  type RevisionApproval,
  type RevisionPayload,
  type SignedRevision,
} from "../PromptChangeControl";

const SECRET = "unit-test-change-control-key";
const AUTHOR = "alice-dev";
const REVIEWER_ONE = "bob-reviewer";
const REVIEWER_TWO = "carol-reviewer";
const TICKET = "CHG-1234";
const CREATED_AT = "2026-03-01T10:00:00.000Z";
const NOW = new Date("2026-03-01T10:10:00.000Z");

function payload(overrides: Partial<RevisionPayload> = {}): RevisionPayload {
  return {
    id: "rev-1",
    name: "risk-decision-prompt",
    type: "prompt",
    version: "v2",
    content: "Evaluate the borrower and return a decision.",
    author: AUTHOR,
    createdAt: CREATED_AT,
    changeTicket: TICKET,
    ...overrides,
  } as RevisionPayload;
}

function policy(overrides: Partial<ChangeControlPolicy> = {}): ChangeControlPolicy {
  return {
    environment: "production",
    secret: SECRET,
    approvalsRequired: 2,
    requireChangeTicket: true,
    ...overrides,
  };
}

function approved(
  overrides: Partial<RevisionPayload> = {},
  approvers: string[] = [REVIEWER_ONE, REVIEWER_TWO]
): SignedRevision {
  const base = signRevision(payload(overrides), SECRET);
  const approvals = approvers.map((approver, index) =>
    signApproval(base, approver, `2026-03-01T1${index}:30:00.000Z`, SECRET)
  );
  return { ...base, approvals };
}

function expectCode(fn: () => unknown, code: ChangeControlErrorCode): PromptChangeControlError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(PromptChangeControlError);
    expect((error as PromptChangeControlError).code).toBe(code);
    return error as PromptChangeControlError;
  }
  throw new Error(`expected change-control error ${code}`);
}

describe("PromptChangeControl — authorship evidence", () => {
  it("derives a stable digest independently of key ordering", () => {
    const ordered = revisionDigest(payload());
    const reordered = revisionDigest({
      createdAt: CREATED_AT,
      content: "Evaluate the borrower and return a decision.",
      version: "v2",
      type: "prompt",
      id: "rev-1",
      author: AUTHOR,
      name: "risk-decision-prompt",
      changeTicket: TICKET,
    });

    expect(reordered).toBe(ordered);
    expect(ordered).toMatch(/^[0-9a-f]{64}$/);
  });

  it("binds the signature to the author and the content digest", () => {
    const revision = signRevision(payload(), SECRET);

    expect(verifyRevisionSignature(revision, SECRET)).toBe(true);
    expect(verifyRevisionSignature(revision, "other-key")).toBe(false);
    expect(verifyRevisionSignature({ ...revision, author: REVIEWER_ONE }, SECRET)).toBe(false);
    expect(verifyRevisionSignature({ ...revision, content: "tampered" }, SECRET)).toBe(false);
  });

  it("ignores undeclared extra keys when hashing", () => {
    const revision = signRevision(payload(), SECRET);
    const injected = {
      ...revision,
      isActive: true,
      rolloutPolicy: { autoRollbackThreshold: 1 },
    } as SignedRevision;

    expect(revisionDigest(injected)).toBe(revision.digest);
    expect(verifyRevisionSignature(injected, SECRET)).toBe(true);
  });

  it("refuses to sign a revision without an author", () => {
    const error = expectCode(
      () => signRevision(payload({ author: "   " }), SECRET),
      "MISSING_AUTHOR"
    );
    expect(error.details).toEqual({ revisionId: "rev-1" });
  });

  it("accepts an approval only for the exact revision digest", () => {
    const revision = signRevision(payload(), SECRET);
    const approval = signApproval(revision, REVIEWER_ONE, "2026-03-01T11:00:00.000Z", SECRET);

    expect(verifyApproval(revision, approval, SECRET)).toBe(true);
    expect(verifyApproval({ ...revision, digest: "0".repeat(64) }, approval, SECRET)).toBe(false);
    expect(verifyApproval(revision, { ...approval, signature: "deadbeef" }, SECRET)).toBe(false);
  });
});

describe("PromptChangeControl — approval quorum", () => {
  it("authorises a signed revision with a full, independent quorum", () => {
    expect(() => assertRevisionAuthorized(approved(), policy(), NOW)).not.toThrow();
  });

  it("rejects a tampered revision signature", () => {
    const revision = approved();
    expectCode(
      () => assertRevisionAuthorized({ ...revision, version: "v3" }, policy(), NOW),
      "SIGNATURE_INVALID"
    );
  });

  it("rejects self-approval, duplicates and forged approvals", () => {
    const selfApproved = approved({}, [AUTHOR, REVIEWER_TWO]);
    expectCode(() => assertRevisionAuthorized(selfApproved, policy(), NOW), "SELF_APPROVAL");

    const duplicated = approved({}, [REVIEWER_ONE, REVIEWER_ONE]);
    expectCode(() => assertRevisionAuthorized(duplicated, policy(), NOW), "DUPLICATE_APPROVAL");

    const forged: RevisionApproval[] = [
      { approver: REVIEWER_ONE, approvedAt: "2026-03-01T11:00:00.000Z", signature: "nope" },
    ];
    expectCode(
      () =>
        assertRevisionAuthorized(
          { ...signRevision(payload(), SECRET), approvals: forged },
          policy({ approvalsRequired: 1 }),
          NOW
        ),
      "APPROVAL_SIGNATURE_INVALID"
    );

    const anonymous: RevisionApproval[] = [
      { approver: "", approvedAt: "2026-03-01T11:00:00.000Z", signature: "nope" },
    ];
    expectCode(
      () =>
        assertRevisionAuthorized(
          { ...signRevision(payload(), SECRET), approvals: anonymous },
          policy({ approvalsRequired: 1 }),
          NOW
        ),
      "APPROVAL_SIGNATURE_INVALID"
    );
  });

  it("enforces the configured quorum size", () => {
    const error = expectCode(
      () => assertRevisionAuthorized(approved({}, [REVIEWER_ONE]), policy(), NOW),
      "QUORUM_NOT_MET"
    );
    expect(error.details).toEqual({ revisionId: "rev-1", required: 2, received: 1 });
  });

  it("requires a change ticket whenever the policy demands it", () => {
    const revision = approved({ changeTicket: "  " });
    expectCode(() => assertRevisionAuthorized(revision, policy(), NOW), "MISSING_CHANGE_TICKET");
    expect(() =>
      assertRevisionAuthorized(revision, policy({ requireChangeTicket: false }), NOW)
    ).not.toThrow();
  });
});

describe("PromptChangeControl — production mutation gate", () => {
  it("blocks unversioned mutation in production", () => {
    expectCode(() => assertMutationAllowed(policy(), undefined, NOW), "UNVERSIONED_MUTATION");
    expectCode(() => assertMutationAllowed(policy(), null, NOW), "UNVERSIONED_MUTATION");
  });

  it("fails closed when production has no signing key configured", () => {
    expectCode(
      () => assertMutationAllowed(policy({ secret: "" }), approved(), NOW),
      "MISSING_SIGNING_KEY"
    );
  });

  it("allows production mutation driven by a signed, approved revision", () => {
    expect(() => assertMutationAllowed(policy(), approved(), NOW)).not.toThrow();
  });

  it("keeps development and staging unversioned mutations working", () => {
    const dev = policy({ environment: "development", requireChangeTicket: false, secret: "" });
    expect(() => assertMutationAllowed(dev, undefined, NOW)).not.toThrow();

    const staging = policy({ environment: "staging", requireChangeTicket: false });
    expect(() => assertMutationAllowed(staging, undefined, NOW)).not.toThrow();
    expect(() => assertMutationAllowed(staging, undefined, NOW)).not.toThrow();
  });

  it("still validates a revision that is supplied outside production", () => {
    const staging = policy({ environment: "staging", requireChangeTicket: false });
    expectCode(
      () => assertMutationAllowed(staging, approved({}, [REVIEWER_ONE]), NOW),
      "QUORUM_NOT_MET"
    );
  });
});

describe("PromptChangeControl — policy resolution", () => {
  it("defaults to an unversioned-friendly development policy", () => {
    const resolved = policyFromEnv({});

    expect(resolved.environment).toBe("development");
    expect(resolved.approvalsRequired).toBe(2);
    expect(resolved.requireChangeTicket).toBe(false);
    expect(resolved.secret).toBe("");
  });

  it("inherits production from NODE_ENV and demands a ticket", () => {
    const resolved = policyFromEnv({
      NODE_ENV: "production",
      PROMPT_CHANGE_CONTROL_SECRET: "s3cret",
    });

    expect(resolved.environment).toBe("production");
    expect(resolved.requireChangeTicket).toBe(true);
    expect(resolved.secret).toBe("s3cret");
  });

  it("honours an explicit environment and quorum override", () => {
    const resolved = policyFromEnv({
      PROMPT_CHANGE_CONTROL_ENV: "staging",
      PROMPT_CHANGE_APPROVALS_REQUIRED: "3",
    });

    expect(resolved.environment).toBe("staging");
    expect(resolved.approvalsRequired).toBe(3);
    expect(resolved.requireChangeTicket).toBe(false);
  });

  it("fails closed for unknown environments and invalid quorums", () => {
    expect(policyFromEnv({ PROMPT_CHANGE_CONTROL_ENV: "qa" }).environment).toBe("production");
    expect(policyFromEnv({ PROMPT_CHANGE_CONTROL_ENV: "qa" }).requireChangeTicket).toBe(true);
    expect(policyFromEnv({ PROMPT_CHANGE_APPROVALS_REQUIRED: "abc" }).approvalsRequired).toBe(2);
    expect(policyFromEnv({ PROMPT_CHANGE_APPROVALS_REQUIRED: "0" }).approvalsRequired).toBe(2);
  });
});

describe("PromptChangeControl — canary rollout", () => {
  const cohorts = [
    { name: "canary-internal", percentage: 1 },
    { name: "canary-early", percentage: 5 },
    { name: "canary-broad", percentage: 25 },
  ];

  it("plans widening, uniquely named cohorts", () => {
    const plan = planCanaryRollout("rev-2", "rev-1", cohorts);

    expect(plan.stages).toEqual(cohorts);
    expect(plan.maxPercentPerStage).toBe(25);
    expect(nextCanaryStage(plan, null)).toEqual(cohorts[0]);
    expect(nextCanaryStage(plan, "canary-early")).toEqual(cohorts[2]);
    expect(nextCanaryStage(plan, "canary-broad")).toBeNull();
  });

  it("rejects unsafe plans", () => {
    expectCode(
      () => planCanaryRollout("rev-2", "rev-2", cohorts),
      "ROLLBACK_TARGET_UNAVAILABLE"
    );
    expectCode(() => planCanaryRollout("rev-2", "rev-1", []), "INVALID_CANARY_PLAN");
    expectCode(
      () =>
        planCanaryRollout("rev-2", "rev-1", [
          { name: "a", percentage: 5 },
          { name: "a", percentage: 10 },
        ]),
      "INVALID_CANARY_PLAN"
    );
    expectCode(
      () => planCanaryRollout("rev-2", "rev-1", [{ name: "a", percentage: 0 }]),
      "INVALID_CANARY_PLAN"
    );
    expectCode(
      () => planCanaryRollout("rev-2", "rev-1", [{ name: "a", percentage: 101 }]),
      "INVALID_CANARY_PLAN"
    );
    expectCode(
      () =>
        planCanaryRollout("rev-2", "rev-1", [
          { name: "a", percentage: 25 },
          { name: "b", percentage: 5 },
        ]),
      "INVALID_CANARY_PLAN"
    );
  });

  it("holds until the rollback policy has enough executions", () => {
    const verdict = evaluateCanaryHealth(
      { total: 4, successRate: 0.5 },
      { autoRollbackThreshold: 80, minExecutionsBeforePolicy: 5 }
    );

    expect(verdict.action).toBe("hold");
    expect(verdict.reason).toBe("insufficient-executions");
    expect(verdict.successRatePercent).toBe(50);
  });

  it("automatically rolls back when the canary success rate drops", () => {
    const verdict = evaluateCanaryHealth(
      { total: 40, successRate: 0.79 },
      { autoRollbackThreshold: 80, minExecutionsBeforePolicy: 20 }
    );

    expect(verdict.action).toBe("rollback");
    expect(verdict.reason).toBe("success-rate-below-threshold");
    expect(verdict.successRatePercent).toBe(79);
  });

  it("promotes at the threshold boundary", () => {
    const verdict = evaluateCanaryHealth(
      { total: 20, successRate: 0.8 },
      { autoRollbackThreshold: 80, minExecutionsBeforePolicy: 20 }
    );

    expect(verdict.action).toBe("promote");
    expect(verdict.executions).toBe(20);
  });

  it("requires an available, distinct rollback revision", () => {
    const plan = planCanaryRollout("rev-2", "rev-1", cohorts);

    expect(() => assertRollbackTargetAvailable(plan, ["rev-1", "rev-2"])).not.toThrow();
    expectCode(() => assertRollbackTargetAvailable(plan, ["rev-2"]), "ROLLBACK_TARGET_UNAVAILABLE");
  });
});

describe("PromptChangeControl — emergency changes", () => {
  const grantInput = {
    changeId: "emg-1",
    author: AUTHOR,
    approver: REVIEWER_ONE,
    reason: "Mitigate live mispricing incident in the risk prompt",
    ticket: "INC-4242",
    issuedAt: "2026-03-01T11:00:00.000Z",
    ttlSeconds: 1800,
  };

  it("issues a signed, time-bounded grant", () => {
    const grant = createEmergencyGrant(grantInput, SECRET);

    expect(grant.expiresAt).toBe("2026-03-01T11:30:00.000Z");
    expect(verifyEmergencyGrant(grant, SECRET)).toBe(true);
    expect(() => assertEmergencyGrantActive(grant, NOW, SECRET)).not.toThrow();
  });

  it("expires grants instead of letting them linger", () => {
    const grant = createEmergencyGrant(grantInput, SECRET);

    expectCode(
      () => assertEmergencyGrantActive(grant, new Date("2026-03-01T11:30:00.000Z"), SECRET),
      "EMERGENCY_EXPIRED"
    );
    expectCode(
      () => assertEmergencyGrantActive(grant, new Date("2026-03-01T12:00:00.000Z"), SECRET),
      "EMERGENCY_EXPIRED"
    );
  });

  it("detects a tampered grant", () => {
    const grant = createEmergencyGrant(grantInput, SECRET);

    expectCode(
      () => assertEmergencyGrantActive({ ...grant, reason: "totally unrelated" }, NOW, SECRET),
      "SIGNATURE_INVALID"
    );
  });

  it("keeps the break-glass bar high", () => {
    expectCode(
      () => createEmergencyGrant({ ...grantInput, approver: AUTHOR }, SECRET),
      "SELF_APPROVAL"
    );
    expectCode(
      () => createEmergencyGrant({ ...grantInput, ticket: "CHG-1" }, SECRET),
      "MISSING_CHANGE_TICKET"
    );
    expectCode(
      () => createEmergencyGrant({ ...grantInput, reason: "oops" }, SECRET),
      "EMERGENCY_NOT_BOUND"
    );
    expectCode(
      () => createEmergencyGrant({ ...grantInput, ttlSeconds: 0 }, SECRET),
      "EMERGENCY_TTL_EXCEEDED"
    );
    expectCode(
      () => createEmergencyGrant({ ...grantInput, ttlSeconds: MAX_EMERGENCY_TTL_SECONDS + 1 }, SECRET),
      "EMERGENCY_TTL_EXCEEDED"
    );
  });

  it("requires a single independent approval and an expiry on emergency revisions", () => {
    const live = approved(
      { emergency: true, emergencyExpiresAt: "2026-03-01T10:45:00.000Z" },
      [REVIEWER_ONE]
    );
    expect(() => assertRevisionAuthorized(live, policy(), NOW)).not.toThrow();

    const unbounded = approved({ emergency: true }, [REVIEWER_ONE]);
    expectCode(() => assertRevisionAuthorized(unbounded, policy(), NOW), "EMERGENCY_NOT_BOUND");

    const tooLong = approved(
      { emergency: true, emergencyExpiresAt: "2026-03-01T13:00:00.000Z" },
      [REVIEWER_ONE]
    );
    expectCode(() => assertRevisionAuthorized(tooLong, policy(), NOW), "EMERGENCY_TTL_EXCEEDED");

    const expired = approved(
      { emergency: true, emergencyExpiresAt: "2026-03-01T10:05:00.000Z" },
      [REVIEWER_ONE]
    );
    expectCode(() => assertRevisionAuthorized(expired, policy(), NOW), "EMERGENCY_EXPIRED");
  });
});

describe("PromptChangeControl — audit trail", () => {
  function trail(): AuditRecord[] {
    const first = appendAuditRecord(null, {
      at: "2026-03-01T10:00:00.000Z",
      actor: AUTHOR,
      action: "revision.signed",
      subject: "rev-1",
    });
    const second = appendAuditRecord(first, {
      at: "2026-03-01T11:00:00.000Z",
      actor: REVIEWER_ONE,
      action: "revision.approved",
      subject: "rev-1",
    });
    return [
      first,
      second,
      appendAuditRecord(second, {
        at: "2026-03-01T11:30:00.000Z",
        actor: REVIEWER_TWO,
        action: "revision.activated",
        subject: "rev-1",
      }),
    ];
  }

  it("chains montone sequence numbers and hashes", () => {
    const records = trail();

    expect(records.map((record) => record.sequence)).toEqual([1, 2, 3]);
    expect(records[0].previousHash).toBeNull();
    expect(records[1].previousHash).toBe(records[0].hash);
    expect(verifyAuditTrail(records)).toBe(true);
  });

  it("detects edits, deletions and reordering", () => {
    const records = trail();

    expect(verifyAuditTrail([{ ...records[0], action: "revision.deleted" }, ...records.slice(1)])).toBe(
      false
    );
    expect(verifyAuditTrail([records[0], records[2]])).toBe(false);
    expect(verifyAuditTrail([records[1], records[0], records[2]])).toBe(false);
    expectCode(() => assertAuditTrailIntact([records[1], records[0], records[2]]), "AUDIT_TRAIL_BROKEN");
  });

  it("treats an empty trail as intact", () => {
    expect(verifyAuditTrail([])).toBe(true);
    expect(() => assertAuditTrailIntact([])).not.toThrow();
  });
});

describe("PromptChangeControl — API error mapping", () => {
  it("maps policy rejections to 403 and conflicts to 409", () => {
    expect(changeControlHttpStatus(new PromptChangeControlError("UNVERSIONED_MUTATION", "x"))).toBe(403);
    expect(changeControlHttpStatus(new PromptChangeControlError("MISSING_SIGNING_KEY", "x"))).toBe(403);
    expect(changeControlHttpStatus(new PromptChangeControlError("SELF_APPROVAL", "x"))).toBe(403);
    expect(changeControlHttpStatus(new PromptChangeControlError("EMERGENCY_EXPIRED", "x"))).toBe(409);
    expect(changeControlHttpStatus(new PromptChangeControlError("ROLLBACK_TARGET_UNAVAILABLE", "x"))).toBe(409);
    expect(changeControlHttpStatus(new PromptChangeControlError("QUORUM_NOT_MET", "x"))).toBe(422);
    expect(changeControlHttpStatus(new PromptChangeControlError("INVALID_CANARY_PLAN", "x"))).toBe(422);
  });

  it("maps every declared error code to a client error status", () => {
    const codes: ChangeControlErrorCode[] = [
      "MISSING_AUTHOR",
      "SIGNATURE_INVALID",
      "APPROVAL_SIGNATURE_INVALID",
      "DUPLICATE_APPROVAL",
      "SELF_APPROVAL",
      "QUORUM_NOT_MET",
      "MISSING_CHANGE_TICKET",
      "UNVERSIONED_MUTATION",
      "MISSING_SIGNING_KEY",
      "EMERGENCY_TTL_EXCEEDED",
      "EMERGENCY_EXPIRED",
      "EMERGENCY_NOT_BOUND",
      "INVALID_CANARY_PLAN",
      "ROLLBACK_TARGET_UNAVAILABLE",
      "AUDIT_TRAIL_BROKEN",
    ];

    for (const code of codes) {
      const status = changeControlHttpStatus(new PromptChangeControlError(code, "x"));
      expect([403, 409, 422]).toContain(status);
    }
  });
});
