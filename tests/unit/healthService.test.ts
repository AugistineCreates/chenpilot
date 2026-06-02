import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// ── Mock all external I/O before importing the module under test ──────────────

jest.mock("../../src/config/Datasource", () => ({
  __esModule: true,
  default: {
    isInitialized: true,
    query: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([{ ok: 1 }]),
  },
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
    mockRedisClient.connect.mockResolvedValue(undefined);
    mockRedisClient.ping.mockResolvedValue("PONG");
    mockRedisClient.quit.mockResolvedValue(undefined);
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
