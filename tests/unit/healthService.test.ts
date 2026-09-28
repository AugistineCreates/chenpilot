import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// ── Mock all external I/O before importing the module under test ──────────────

// Pool driver stub – default: 2 active out of 10 max (healthy, 20% saturated).
const mockPool = {
  totalCount: 2,
  idleCount: 0,
  waitingCount: 0,
  connect: jest.fn<() => Promise<{ release(): void }>>().mockResolvedValue({
    release: jest.fn<() => void>(),
  }),
};

jest.mock("../../src/config/Datasource", () => ({
  __esModule: true,
  default: {
    isInitialized: true,
    query: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([{ ok: 1 }]),
    driver: { master: mockPool },
  },
  getPoolStats: jest.fn(() => ({
    maxConnections: 10,
    activeConnections: mockPool.totalCount - mockPool.idleCount,
    idleConnections: mockPool.idleCount,
    waitingRequests: mockPool.waitingCount,
    saturationRatio: (mockPool.totalCount - mockPool.idleCount) / 10,
  })),
}));

const mockRedisClient = {
  connect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  ping: jest.fn<() => Promise<string>>().mockResolvedValue("PONG"),
  quit: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
};
jest.mock("redis", () => ({
  createClient: jest.fn(() => mockRedisClient),
}));

jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => ({
    verify: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  })),
}));

jest.mock("../../src/config/config", () => ({
  __esModule: true,
  default: {
    apiKey: "sk-ant-test-key",
    stellar: {
      network: "testnet",
      horizonUrl: "https://horizon-testnet.stellar.org",
    },
    redis: { host: "localhost", port: 6379, db: 0, password: undefined },
    email: {
      host: "smtp.example.com",
      port: 587,
      user: "",
      pass: "",
      from: "noreply@chenpilot.com",
    },
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────────
import { HealthService, OverallStatus } from "../../src/services/healthService";
import AppDataSource from "../../src/config/Datasource";

describe("HealthService", () => {
  let service: HealthService;

  beforeEach(() => {
    service = new HealthService();
    jest.clearAllMocks();
    // Restore defaults after clearAllMocks
    (AppDataSource.query as jest.Mock).mockResolvedValue([{ ok: 1 }]);
    mockPool.totalCount = 2;
    mockPool.idleCount = 0;
    mockPool.waitingCount = 0;
    mockPool.connect.mockResolvedValue({ release: jest.fn<() => void>() });
    mockRedisClient.connect.mockResolvedValue(undefined);
    mockRedisClient.ping.mockResolvedValue("PONG");
    mockRedisClient.quit.mockResolvedValue(undefined);
    // Re-wire getPoolStats to reflect current mockPool state
    const { getPoolStats } = jest.requireMock(
      "../../src/config/Datasource"
    ) as { getPoolStats: jest.Mock };
    getPoolStats.mockImplementation(() => ({
      maxConnections: 10,
      activeConnections: mockPool.totalCount - mockPool.idleCount,
      idleConnections: mockPool.idleCount,
      waitingRequests: mockPool.waitingCount,
      saturationRatio: (mockPool.totalCount - mockPool.idleCount) / 10,
    }));
  });

  describe("getFullReport()", () => {
    it("returns HEALTHY or DEGRADED when critical deps are UP", async () => {
      const report = await service.getFullReport();

      // Critical deps must be UP
      expect(report.dependencies.database.status).toBe("UP");
      expect(report.dependencies.redis.status).toBe("UP");
      // Overall is at least not UNHEALTHY
      expect(report.overallStatus).not.toBe<OverallStatus>("UNHEALTHY");
      expect(report.timestamp).toBeDefined();
      expect(typeof report.uptime).toBe("number");
    });

    it("returns UNHEALTHY when database is DOWN", async () => {
      (AppDataSource.query as jest.Mock).mockRejectedValueOnce(
        new Error("connection refused")
      );

      const report = await service.getFullReport();

      expect(report.overallStatus).toBe<OverallStatus>("UNHEALTHY");
      expect(report.dependencies.database.status).toBe("DOWN");
      expect(report.dependencies.database.error).toContain(
        "connection refused"
      );
    });

    it("returns UNHEALTHY when database is not initialized", async () => {
      const ds = AppDataSource as unknown as { isInitialized: boolean };
      ds.isInitialized = false;

      const report = await service.getFullReport();

      expect(report.overallStatus).toBe<OverallStatus>("UNHEALTHY");
      expect(report.dependencies.database.status).toBe("DOWN");

      ds.isInitialized = true; // restore
    });

    it("returns UNHEALTHY when Redis is DOWN", async () => {
      mockRedisClient.connect.mockRejectedValueOnce(
        new Error("redis unreachable")
      );

      const report = await service.getFullReport();

      expect(report.overallStatus).toBe<OverallStatus>("UNHEALTHY");
      expect(report.dependencies.redis.status).toBe("DOWN");
    });

    it("returns DEGRADED when a non-critical dep (horizon) is DOWN", async () => {
      const { mockStellarSdk } = await import("../stellar.mock");
      const origServer = mockStellarSdk.Horizon.Server;
      mockStellarSdk.Horizon.Server = jest.fn(() => ({
        ledgers: () => ({
          limit: () => ({
            call: jest
              .fn<() => Promise<never>>()
              .mockRejectedValue(new Error("horizon unreachable")),
          }),
        }),
      }));

      const report = await service.getFullReport();

      expect(report.overallStatus).toBe<OverallStatus>("DEGRADED");
      expect(report.dependencies.horizon.status).toBe("DOWN");

      mockStellarSdk.Horizon.Server = origServer;
    });

    it("returns DEGRADED when email is not configured (smtp.example.com)", async () => {
      const report = await service.getFullReport();
      expect(report.dependencies.email.status).toBe("DEGRADED");
    });

    it("includes latencyMs >= 0 for each dependency", async () => {
      const report = await service.getFullReport();
      for (const dep of Object.values(report.dependencies)) {
        expect(typeof dep.latencyMs).toBe("number");
        expect(dep.latencyMs).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ── Pool saturation & wait-time regression tests ──────────────────────────
  describe("connection-pool diagnostics", () => {
    it("surfaces pool stats in database detail when pool is healthy", async () => {
      // Default: 2 active / 10 max — healthy, no waiting requests.
      const report = await service.getFullReport();
      const db = report.dependencies.database;

      expect(db.status).toBe("UP");
      expect(db.detail).toBeDefined();
      const detail = db.detail as Record<string, unknown>;
      expect(detail).toHaveProperty("pool");
      const pool = detail.pool as Record<string, unknown>;
      expect(pool).toMatchObject({
        maxConnections: 10,
        activeConnections: 2,
        idleConnections: 0,
        waitingRequests: 0,
      });
      expect(typeof pool.saturationRatio).toBe("number");
    });

    it("includes acquireMs (connection wait-time) in database detail", async () => {
      const report = await service.getFullReport();
      const detail = report.dependencies.database.detail as Record<
        string,
        unknown
      >;
      expect(detail).toHaveProperty("acquireMs");
      expect(typeof detail.acquireMs).toBe("number");
      expect((detail.acquireMs as number) >= 0).toBe(true);
    });

    it("returns DEGRADED when waitingRequests > 0 (pool exhausted)", async () => {
      // Simulate: all 10 connections busy, 3 callers waiting.
      mockPool.totalCount = 10;
      mockPool.idleCount = 0;
      mockPool.waitingCount = 3;
      const { getPoolStats } = jest.requireMock(
        "../../src/config/Datasource"
      ) as { getPoolStats: jest.Mock };
      getPoolStats.mockReturnValueOnce({
        maxConnections: 10,
        activeConnections: 10,
        idleConnections: 0,
        waitingRequests: 3,
        saturationRatio: 1.0,
      });

      const report = await service.getFullReport();
      const db = report.dependencies.database;

      expect(db.status).toBe("DEGRADED");
      expect(db.error).toMatch(/saturated/);
      const pool = (db.detail as Record<string, unknown>).pool as Record<
        string,
        unknown
      >;
      expect(pool.waitingRequests).toBe(3);
    });

    it("returns DEGRADED when saturationRatio >= 0.8 (pre-exhaustion)", async () => {
      // Simulate: 8 of 10 connections active, nobody waiting yet.
      const { getPoolStats } = jest.requireMock(
        "../../src/config/Datasource"
      ) as { getPoolStats: jest.Mock };
      getPoolStats.mockReturnValueOnce({
        maxConnections: 10,
        activeConnections: 8,
        idleConnections: 2,
        waitingRequests: 0,
        saturationRatio: 0.8,
      });

      const report = await service.getFullReport();
      const db = report.dependencies.database;

      expect(db.status).toBe("DEGRADED");
      expect(db.error).toMatch(/saturated/);
    });

    it("returns UP when saturationRatio < 0.8 and no waiting requests", async () => {
      // Simulate: 5 of 10 connections active — 50% saturated, healthy.
      const { getPoolStats } = jest.requireMock(
        "../../src/config/Datasource"
      ) as { getPoolStats: jest.Mock };
      getPoolStats.mockReturnValueOnce({
        maxConnections: 10,
        activeConnections: 5,
        idleConnections: 5,
        waitingRequests: 0,
        saturationRatio: 0.5,
      });

      const report = await service.getFullReport();
      expect(report.dependencies.database.status).toBe("UP");
    });
  });
});

// ── HTTP endpoint integration tests ──────────────────────────────────────────
import request from "supertest";
import express from "express";

describe("Health HTTP endpoints", () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();

    app.get("/health", (_req, res) => {
      res
        .status(200)
        .json({ status: "UP", timestamp: new Date().toISOString() });
    });

    app.get("/ready", async (_req, res) => {
      try {
        const svc = new HealthService();
        const report = await svc.getFullReport();
        const httpStatus = report.overallStatus === "UNHEALTHY" ? 503 : 200;
        res.status(httpStatus).json(report);
      } catch {
        res.status(503).json({ overallStatus: "UNHEALTHY" });
      }
    });
  });

  it("GET /health always returns 200", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("UP");
  });

  it("GET /ready returns 200 when healthy", async () => {
    // Restore mocks for this test
    (AppDataSource.query as jest.Mock).mockResolvedValue([{ ok: 1 }]);
    mockRedisClient.connect.mockResolvedValue(undefined);
    mockRedisClient.ping.mockResolvedValue("PONG");

    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(["HEALTHY", "DEGRADED"]).toContain(res.body.overallStatus);
  });

  it("GET /ready returns 503 when database is DOWN", async () => {
    (AppDataSource.query as jest.Mock).mockRejectedValueOnce(
      new Error("db down")
    );

    const res = await request(app).get("/ready");
    expect(res.status).toBe(503);
    expect(res.body.overallStatus).toBe("UNHEALTHY");
  });
});
