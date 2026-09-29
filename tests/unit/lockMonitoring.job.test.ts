import {
  getLockStatuses,
  monitorLocks,
} from "../../src/jobs/lockMonitoring.job";

const mockRedis = {
  scan: jest.fn(),
  pipeline: jest.fn(),
};

jest.mock("../../src/services/redis/client", () => ({
  getRedisClient: jest.fn(() => mockRedis),
}));

describe("lock monitoring job", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("detects locks older than their expected TTL", async () => {
    const createdAt = Date.now() - 60_000;
    mockRedis.scan.mockResolvedValueOnce([
      "0",
      ["lock:stuck-resource", "lock:active-resource"],
    ]);
    mockRedis.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      ttl: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, `user-1:id:${createdAt}`],
        [null, 20],
        [null, `user-2:id:${Date.now()}`],
        [null, 20],
      ]),
    });

    const result = await getLockStatuses({
      expectedTtlMs: 30_000,
      staleGraceMs: 0,
    });

    expect(result).toHaveLength(2);
    expect(result[0].stale).toBe(true);
    expect(result[0].ownerId).toBe("user-1");
    expect(result[1].stale).toBe(false);
    expect(mockRedis.scan).toHaveBeenCalledWith(
      "0",
      "MATCH",
      "lock:*",
      "COUNT",
      100
    );
  });

  it("logs an alert for every stale lock", async () => {
    mockRedis.scan.mockResolvedValueOnce(["0", ["lock:stuck"]]);
    mockRedis.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      ttl: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, `owner:id:${Date.now() - 90_000}`],
        [null, 10],
      ]),
    });
    const logger = { warn: jest.fn(), error: jest.fn() };

    await monitorLocks({
      expectedTtlMs: 30_000,
      staleGraceMs: 0,
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      "Stale Redis lock detected",
      expect.objectContaining({ key: "lock:stuck", ownerId: "owner" })
    );
  });
});
