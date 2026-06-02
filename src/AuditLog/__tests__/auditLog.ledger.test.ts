/**
 * auditLog.ledger.test.ts  (Issue #344 — Security-Grade Audit Ledger)
 *
 * Integration + security tests for AuditLogService.
 * Uses jest.mock with self-contained factories (no outer variable references)
 * to avoid hoisting issues; spies are accessed via jest.mocked().
 */

import { AuditLogService } from "../../../src/AuditLog/auditLog.service";
import {
  EventCategory,
  AuthAction,
  ExecutionAction,
  PolicyAction,
  AdminAction,
  IntegrationAction,
  AuditEventSeverity,
} from "../../../src/AuditLog/auditEvent.types";
import { REDACTED_SENTINEL } from "../../../src/AuditLog/auditLog.redaction";
import { AuditAction, AuditSeverity } from "../../../src/AuditLog/auditLog.entity";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// All factories are self-contained (no outer var refs) to survive jest.mock hoisting.

jest.mock("../../config/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

// Mocked repo — we'll swap individual method implementations in beforeEach
// via jest.fn() stored inside a module-level object that we create AFTER mocks run.
let _repoMethods: {
  create: jest.Mock;
  save: jest.Mock;
  findOne: jest.Mock;
  find: jest.Mock;
  qb: {
    andWhere: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    skip: jest.Mock;
    take: jest.Mock;
    limit: jest.Mock;
    getCount: jest.Mock;
    getMany: jest.Mock;
    select: jest.Mock;
  };
  createQueryBuilder: jest.Mock;
};

jest.mock("../../config/Datasource", () => {
  // Build the fluent query-builder stub inline
  const qb: Record<string, jest.Mock> = {
    andWhere: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    limit: jest.fn(),
    getCount: jest.fn().mockResolvedValue(0),
    getMany: jest.fn().mockResolvedValue([]),
    select: jest.fn(),
  };
  // Make every chaining call return qb itself
  (["andWhere", "where", "orderBy", "skip", "take", "limit", "select"] as const).forEach(
    (k) => qb[k].mockReturnValue(qb)
  );

  const repo = {
    create: jest.fn((d: unknown) => d),
    save: jest.fn(async (e: unknown) => e),
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  };

  return {
    __esModule: true,
    default: {
      getRepository: jest.fn().mockReturnValue(repo),
      isInitialized: true,
    },
    AppDataSource: {
      getRepository: jest.fn().mockReturnValue(repo),
      isInitialized: true,
    },
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Grab the repo mock from the already-mocked Datasource module */
function getRepo() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ds = require("../../config/Datasource");
  return ds.default.getRepository();
}

function getQb() {
  return getRepo().createQueryBuilder();
}

function makePersistedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee",
    correlationId: "corr-001",
    action: AuthAction.LOGIN_SUCCESS,
    category: EventCategory.AUTH,
    severity: AuditEventSeverity.INFO,
    actorId: "user-abc",
    userId: "user-abc",
    success: true,
    createdAt: new Date("2024-06-01T00:00:00Z"),
    eventHash: "a".repeat(64),
    previousHash: undefined,
    ...overrides,
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("AuditLogService — Security-Grade Ledger", () => {
  let service: AuditLogService;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset defaults
    const repo = getRepo();
    const qb = getQb();

    repo.findOne.mockResolvedValue(null);
    repo.save.mockImplementation(async (e: unknown) => e);
    repo.find.mockResolvedValue([]);

    qb.getMany.mockResolvedValue([]);
    qb.getCount.mockResolvedValue(0);

    service = new AuditLogService();
  });

  // ── logEvent — basic ingestion ─────────────────────────────────────────────

  describe("logEvent", () => {
    it("persists with correct category and correlationId", async () => {
      const repo = getRepo();
      await service.logEvent({
        action: AuthAction.LOGIN_SUCCESS,
        actor: { userId: "u-1", ipAddress: "1.2.3.4" },
        correlationId: "trace-001",
        success: true,
      });

      expect(repo.save).toHaveBeenCalledTimes(1);
      const call = repo.create.mock.calls[0][0];
      expect(call.category).toBe(EventCategory.AUTH);
      expect(call.correlationId).toBe("trace-001");
      expect(call.action).toBe(AuthAction.LOGIN_SUCCESS);
      expect(call.userId).toBe("u-1");
      expect(call.success).toBe(true);
    });

    it("computes a 64-char SHA-256 eventHash", async () => {
      const repo = getRepo();
      await service.logEvent({ action: AuthAction.LOGIN_SUCCESS });
      const call = repo.create.mock.calls[0][0];
      expect(typeof call.eventHash).toBe("string");
      expect(call.eventHash).toHaveLength(64);
    });

    it("generates a correlationId when none supplied", async () => {
      const repo = getRepo();
      await service.logEvent({ action: AuthAction.LOGOUT });
      const call = repo.create.mock.calls[0][0];
      expect(typeof call.correlationId).toBe("string");
      expect(call.correlationId.length).toBeGreaterThan(0);
    });

    it("chains previousHash from the latest stored event", async () => {
      const repo = getRepo();
      repo.findOne.mockResolvedValue({ eventHash: "prev-hash-" + "0".repeat(54) });
      await service.logEvent({ action: AuthAction.TOKEN_REFRESH });
      const call = repo.create.mock.calls[0][0];
      expect(call.previousHash).toBe("prev-hash-" + "0".repeat(54));
    });

    it("sets previousHash to undefined when chain is empty", async () => {
      const repo = getRepo();
      repo.findOne.mockResolvedValue(null);
      await service.logEvent({ action: AuthAction.LOGIN_SUCCESS });
      const call = repo.create.mock.calls[0][0];
      expect(call.previousHash).toBeUndefined();
    });
  });

  // ── Category inference ─────────────────────────────────────────────────────

  describe("Category inference from action prefix", () => {
    const cases: [string, EventCategory][] = [
      [AuthAction.LOGIN_FAILED, EventCategory.AUTH],
      [AuthAction.MFA_SUCCESS, EventCategory.AUTH],
      [AdminAction.USER_CREATED, EventCategory.ADMIN],
      [AdminAction.ROLE_ASSIGNED, EventCategory.ADMIN],
      [ExecutionAction.TRADE_CONFIRMED, EventCategory.EXECUTION],
      [ExecutionAction.SWAP_EXECUTED, EventCategory.EXECUTION],
      [PolicyAction.UNAUTHORIZED_ACCESS, EventCategory.POLICY],
      [PolicyAction.RATE_LIMIT_EXCEEDED, EventCategory.POLICY],
      [IntegrationAction.WEBHOOK_SENT, EventCategory.INTEGRATION],
      [IntegrationAction.SOROBAN_CALL, EventCategory.INTEGRATION],
    ];

    test.each(cases)("action '%s' → category %s", async (action, expected) => {
      const repo = getRepo();
      await service.logEvent({ action: action as AuthAction });
      const call = repo.create.mock.calls[0][0];
      expect(call.category).toBe(expected);
    });
  });

  // ── PII Redaction ──────────────────────────────────────────────────────────

  describe("PII / secret redaction in metadata", () => {
    it("scrubs password from metadata before persistence", async () => {
      const repo = getRepo();
      await service.logEvent({
        action: AuthAction.LOGIN_FAILED,
        metadata: { username: "alice", password: "s3cr3t!" },
      });
      const call = repo.create.mock.calls[0][0];
      expect(call.metadata.password).toBe(REDACTED_SENTINEL);
      expect(call.metadata.username).toBe("alice");
    });

    it("scrubs api_key from nested metadata", async () => {
      const repo = getRepo();
      await service.logEvent({
        action: AdminAction.SETTINGS_CHANGED,
        metadata: { config: { api_key: "sk_live_secret_key" } },
      });
      const call = repo.create.mock.calls[0][0];
      expect(call.metadata.config.api_key).toBe(REDACTED_SENTINEL);
    });

    it("scrubs email addresses from string values", async () => {
      const repo = getRepo();
      await service.logEvent({
        action: PolicyAction.SENSITIVE_DATA_ACCESS,
        metadata: { note: "Accessed by admin@corp.com" },
      });
      const call = repo.create.mock.calls[0][0];
      expect(call.metadata.note as string).not.toContain("admin@corp.com");
    });

    it("preserves non-sensitive numeric metadata", async () => {
      const repo = getRepo();
      await service.logEvent({
        action: ExecutionAction.TRADE_CONFIRMED,
        metadata: { amount: 500, asset: "XLM" },
      });
      const call = repo.create.mock.calls[0][0];
      expect(call.metadata.amount).toBe(500);
      expect(call.metadata.asset).toBe("XLM");
    });

    it("scrubs secret field from metadata", async () => {
      const repo = getRepo();
      await service.logEvent({
        action: IntegrationAction.WEBHOOK_SENT,
        metadata: { secret: "webhook-signing-key-xyz" },
      });
      const call = repo.create.mock.calls[0][0];
      expect(call.metadata.secret).toBe(REDACTED_SENTINEL);
    });
  });

  // ── getByCorrelationId ─────────────────────────────────────────────────────

  describe("getByCorrelationId", () => {
    it("returns events ordered ASC by createdAt", async () => {
      const repo = getRepo();
      const events = [
        makePersistedEvent({ action: AuthAction.LOGIN_SUCCESS }),
        makePersistedEvent({ action: ExecutionAction.TRADE_INITIATED }),
      ];
      repo.find.mockResolvedValue(events);

      const result = await service.getByCorrelationId("trace-x");

      expect(repo.find).toHaveBeenCalledWith({
        where: { correlationId: "trace-x" },
        order: { createdAt: "ASC" },
      });
      expect(result).toHaveLength(2);
    });

    it("returns empty array when no events for correlationId", async () => {
      const repo = getRepo();
      repo.find.mockResolvedValue([]);
      const result = await service.getByCorrelationId("no-such");
      expect(result).toEqual([]);
    });
  });

  // ── getByCategory ──────────────────────────────────────────────────────────

  describe("getByCategory", () => {
    it("filters by the correct category value", async () => {
      const qb = getQb();
      qb.getMany.mockResolvedValue([makePersistedEvent()]);

      await service.getByCategory(EventCategory.EXECUTION, 24, 50);

      expect(qb.where).toHaveBeenCalledWith(
        "audit.category = :category",
        expect.objectContaining({ category: EventCategory.EXECUTION })
      );
    });
  });

  // ── getActorTimeline ───────────────────────────────────────────────────────

  describe("getActorTimeline", () => {
    it("queries by actorId and returns total + events", async () => {
      const qb = getQb();
      qb.getCount.mockResolvedValue(7);
      qb.getMany.mockResolvedValue([makePersistedEvent(), makePersistedEvent()]);

      const result = await service.getActorTimeline("actor-999", 10, 0);

      expect(qb.where).toHaveBeenCalledWith(
        "audit.actorId = :actorId",
        { actorId: "actor-999" }
      );
      expect(result.total).toBe(7);
      expect(result.events).toHaveLength(2);
    });
  });

  // ── verifyChainIntegrity ───────────────────────────────────────────────────

  describe("verifyChainIntegrity", () => {
    it("reports intact with 0 checked when event list is empty", async () => {
      const repo = getRepo();
      repo.find.mockResolvedValue([]);

      const result = await service.verifyChainIntegrity(100);

      expect(result.intact).toBe(true);
      expect(result.checkedCount).toBe(0);
    });

    it("skips events with no eventHash", async () => {
      const repo = getRepo();
      repo.find.mockResolvedValue([
        makePersistedEvent({ eventHash: undefined }),
      ]);

      const result = await service.verifyChainIntegrity(100);
      expect(result.intact).toBe(true);
      expect(result.checkedCount).toBe(0);
    });
  });

  // ── queryEvents ────────────────────────────────────────────────────────────

  describe("queryEvents", () => {
    it("returns { events, total } shape", async () => {
      const qb = getQb();
      qb.getCount.mockResolvedValue(3);
      qb.getMany.mockResolvedValue([
        makePersistedEvent(),
        makePersistedEvent(),
        makePersistedEvent(),
      ]);

      const result = await service.queryEvents({
        category: EventCategory.AUTH,
        limit: 10,
      });

      expect(result).toHaveProperty("events");
      expect(result).toHaveProperty("total", 3);
      expect(result.events).toHaveLength(3);
    });

    it("filters by correlationId when provided", async () => {
      const qb = getQb();
      qb.getCount.mockResolvedValue(0);
      qb.getMany.mockResolvedValue([]);

      await service.queryEvents({ correlationId: "trace-abc" });

      expect(qb.andWhere).toHaveBeenCalledWith(
        "audit.correlationId = :correlationId",
        { correlationId: "trace-abc" }
      );
    });
  });

  // ── Legacy shims ───────────────────────────────────────────────────────────

  describe("Legacy log() shim", () => {
    it("accepts old CreateAuditLogParams and delegates to logEvent", async () => {
      const repo = getRepo();
      const result = await service.log({
        userId: "u-legacy",
        action: AuditAction.LOGIN_SUCCESS,
        severity: AuditSeverity.INFO,
        ipAddress: "127.0.0.1",
        metadata: { username: "legacyUser" },
      });

      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
    });
  });

  describe("Legacy query() shim", () => {
    it("returns { logs, total } shape", async () => {
      const qb = getQb();
      qb.getCount.mockResolvedValue(2);
      qb.getMany.mockResolvedValue([makePersistedEvent(), makePersistedEvent()]);

      const result = await service.query({ userId: "u-1", limit: 10 });

      expect(result).toHaveProperty("logs");
      expect(result).toHaveProperty("total", 2);
    });
  });
});
