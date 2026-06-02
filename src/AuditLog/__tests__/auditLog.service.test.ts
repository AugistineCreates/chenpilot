import { auditLogService } from "../auditLog.service";
import { AuditAction, AuditSeverity } from "../auditLog.entity";
import AppDataSource from "../../config/Datasource";

let mockDb: any[] = [];

jest.mock("../../config/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock("../../config/Datasource", () => {
  const repo = {
    create: jest.fn((d: any) => ({
      id: d.id || Math.random().toString(36).substring(2),
      createdAt: d.createdAt || new Date(),
      ...d
    })),
    save: jest.fn(async (e: any) => {
      mockDb.push(e);
      return e;
    }),
    find: jest.fn(async (options: any) => {
      let results = [...mockDb];
      if (options && options.where) {
        results = results.filter(item => {
          for (const key of Object.keys(options.where)) {
            if (item[key] !== options.where[key]) return false;
          }
          return true;
        });
      }
      if (options && options.order) {
        if (options.order.createdAt === "ASC") {
          results.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        } else {
          results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
      }
      if (options && options.take) {
        results = results.slice(0, options.take);
      }
      return results;
    }),
    findOne: jest.fn(async (options: any) => {
      let results = [...mockDb];
      if (options && options.where) {
        results = results.filter(item => {
          for (const key of Object.keys(options.where)) {
            if (item[key] !== options.where[key]) return false;
          }
          return true;
        });
      }
      if (options && options.order) {
        if (options.order.createdAt === "ASC") {
          results.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        } else {
          results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
      }
      return results[0] || null;
    }),
  };

  let qbFilters: Array<(item: any) => boolean> = [];
  let qbParams: Record<string, any> = {};
  let qbOrderBy: string = "DESC";
  let qbSkip: number = 0;
  let qbTake: number = 50;

  const qb = {
    where: jest.fn().mockImplementation((queryStr: string, params?: any) => {
      qbFilters = [];
      qbParams = { ...qbParams, ...params };
      parseQueryStr(queryStr);
      return qb;
    }),
    andWhere: jest.fn().mockImplementation((queryStr: string, params?: any) => {
      qbParams = { ...qbParams, ...params };
      parseQueryStr(queryStr);
      return qb;
    }),
    orderBy: jest.fn().mockImplementation((col: string, order: "ASC" | "DESC" = "DESC") => {
      qbOrderBy = order;
      return qb;
    }),
    skip: jest.fn().mockImplementation((val: number) => {
      qbSkip = val;
      return qb;
    }),
    take: jest.fn().mockImplementation((val: number) => {
      qbTake = val;
      return qb;
    }),
    limit: jest.fn().mockImplementation((val: number) => {
      qbTake = val;
      return qb;
    }),
    delete: jest.fn().mockImplementation(() => {
      qbFilters = [];
      return qb;
    }),
    execute: jest.fn().mockImplementation(async () => {
      const initialCount = mockDb.length;
      mockDb = mockDb.filter(item => {
        const keep = !qbFilters.every(fn => fn(item));
        return keep;
      });
      const affected = initialCount - mockDb.length;
      return { affected };
    }),
    getCount: jest.fn().mockImplementation(async () => {
      const filtered = mockDb.filter(item => qbFilters.every(fn => fn(item)));
      return filtered.length;
    }),
    getMany: jest.fn().mockImplementation(async () => {
      let filtered = mockDb.filter(item => qbFilters.every(fn => fn(item)));
      if (qbOrderBy === "ASC") {
        filtered.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      } else {
        filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      return filtered.slice(qbSkip, qbSkip + qbTake);
    }),
  };

  function parseQueryStr(queryStr: string) {
    if (queryStr.includes("audit.userId = :userId")) {
      qbFilters.push((item) => item.userId === qbParams.userId);
    }
    if (queryStr.includes("audit.action = :action")) {
      qbFilters.push((item) => item.action === qbParams.action);
    }
    if (queryStr.includes("audit.category = :category")) {
      qbFilters.push((item) => item.category === qbParams.category);
    }
    if (queryStr.includes("audit.severity = :severity")) {
      qbFilters.push((item) => item.severity === qbParams.severity);
    }
    if (queryStr.includes("audit.success = :success")) {
      qbFilters.push((item) => item.success === qbParams.success);
    }
    if (queryStr.includes("audit.actorId = :actorId")) {
      qbFilters.push((item) => item.actorId === qbParams.actorId);
    }
    if (queryStr.includes("audit.createdAt >= :startDate")) {
      qbFilters.push((item) => item.createdAt >= qbParams.startDate);
    }
    if (queryStr.includes("audit.createdAt <= :endDate")) {
      qbFilters.push((item) => item.createdAt <= qbParams.endDate);
    }
    if (queryStr.includes("createdAt < :cutoffDate")) {
      qbFilters.push((item) => item.createdAt < qbParams.cutoffDate);
    }
    if (queryStr.includes("audit.severity IN (:...severities)")) {
      qbFilters.push((item) => qbParams.severities.includes(item.severity));
    }
  }

  const resetMockDb = () => {
    mockDb = [];
    qbFilters = [];
    qbParams = {};
    qbOrderBy = "DESC";
    qbSkip = 0;
    qbTake = 50;
  };

  (repo as any)._resetMockDb = resetMockDb;
  (repo as any).createQueryBuilder = jest.fn().mockReturnValue(qb);

  return {
    __esModule: true,
    default: {
      getRepository: jest.fn().mockReturnValue(repo),
      isInitialized: true,
      initialize: jest.fn().mockResolvedValue(true),
      destroy: jest.fn().mockResolvedValue(true),
    },
    AppDataSource: {
      getRepository: jest.fn().mockReturnValue(repo),
      isInitialized: true,
      initialize: jest.fn().mockResolvedValue(true),
      destroy: jest.fn().mockResolvedValue(true),
    },
  };
});

describe("AuditLogService", () => {
  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
  });

  afterAll(async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  beforeEach(() => {
    const ds = require("../../config/Datasource");
    ds.default.getRepository()._resetMockDb();
  });

  describe("log", () => {
    it("should create an audit log entry", async () => {
      const log = await auditLogService.log({
        userId: "test-user-123",
        action: AuditAction.LOGIN_SUCCESS,
        severity: AuditSeverity.INFO,
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0",
        metadata: { username: "testuser" },
      });

      expect(log.id).toBeDefined();
      expect(log.userId).toBe("test-user-123");
      expect(log.action).toBe(AuditAction.LOGIN_SUCCESS);
      expect(log.severity).toBe(AuditSeverity.INFO);
      expect(log.success).toBe(true);
    });

    it("should create a failed action log", async () => {
      const log = await auditLogService.log({
        action: AuditAction.LOGIN_FAILED,
        severity: AuditSeverity.WARNING,
        success: false,
        errorMessage: "Invalid credentials",
        metadata: { username: "unknown" },
      });

      expect(log.success).toBe(false);
      expect(log.errorMessage).toBe("Invalid credentials");
    });
  });

  describe("query", () => {
    beforeEach(async () => {
      // Create test data
      await auditLogService.log({
        userId: "user-1",
        action: AuditAction.LOGIN_SUCCESS,
        severity: AuditSeverity.INFO,
      });

      await auditLogService.log({
        userId: "user-1",
        action: AuditAction.LOGIN_FAILED,
        severity: AuditSeverity.WARNING,
        success: false,
      });

      await auditLogService.log({
        userId: "user-2",
        action: AuditAction.TRADE_CONFIRMED,
        severity: AuditSeverity.INFO,
      });
    });

    it("should query logs by userId", async () => {
      const { logs } = await auditLogService.query({
        userId: "user-1",
      });

      expect(logs.length).toBeGreaterThan(0);
      expect(logs.every((log) => log.userId === "user-1")).toBe(true);
    });

    it("should query logs by action", async () => {
      const { logs } = await auditLogService.query({
        action: AuditAction.LOGIN_FAILED,
      });

      expect(logs.every((log) => log.action === AuditAction.LOGIN_FAILED)).toBe(
        true
      );
    });

    it("should query logs by severity", async () => {
      const { logs } = await auditLogService.query({
        severity: AuditSeverity.WARNING,
      });

      expect(logs.every((log) => log.severity === AuditSeverity.WARNING)).toBe(
        true
      );
    });

    it("should query logs by success status", async () => {
      const { logs } = await auditLogService.query({
        success: false,
      });

      expect(logs.every((log) => log.success === false)).toBe(true);
    });

    it("should apply pagination", async () => {
      const { logs } = await auditLogService.query({
        limit: 2,
        offset: 0,
      });

      expect(logs.length).toBeLessThanOrEqual(2);
    });
  });

  describe("getUserAuditLogs", () => {
    it("should get logs for a specific user", async () => {
      const userId = "test-user-456";

      await auditLogService.log({
        userId,
        action: AuditAction.USER_CREATED,
        severity: AuditSeverity.INFO,
      });

      const { logs } = await auditLogService.getUserAuditLogs(userId);

      expect(logs.length).toBeGreaterThan(0);
      expect(logs.every((log) => log.userId === userId)).toBe(true);
    });
  });

  describe("getFailedAuthAttempts", () => {
    it("should get failed authentication attempts", async () => {
      const userId = "test-user-789";

      await auditLogService.log({
        userId,
        action: AuditAction.LOGIN_FAILED,
        severity: AuditSeverity.WARNING,
        success: false,
      });

      const attempts = await auditLogService.getFailedAuthAttempts(userId, 24);

      expect(attempts.length).toBeGreaterThan(0);
      expect(
        attempts.every((log) => log.action === AuditAction.LOGIN_FAILED)
      ).toBe(true);
    });
  });

  describe("getSecurityEvents", () => {
    it("should get security events", async () => {
      await auditLogService.log({
        action: AuditAction.UNAUTHORIZED_ACCESS,
        severity: AuditSeverity.CRITICAL,
        success: false,
      });

      const events = await auditLogService.getSecurityEvents(24, 100);

      expect(Array.isArray(events)).toBe(true);
      expect(
        events.every(
          (log) =>
            log.severity === AuditSeverity.WARNING ||
            log.severity === AuditSeverity.CRITICAL
        )
      ).toBe(true);
    });
  });

  describe("deleteOldLogs", () => {
    it("should delete logs older than specified days", async () => {
      const deletedCount = await auditLogService.deleteOldLogs(365);
      expect(typeof deletedCount).toBe("number");
    });
  });
});
