import { withTradeLockHeartbeat } from "../../src/services/lock/tradeLockHeartbeat";

describe("withTradeLockHeartbeat", () => {
  it("extends the lock while a slow multi-hop operation exceeds the initial TTL", async () => {
    const extensions: number[] = [];
    const startedAt = Date.now();

    await withTradeLockHeartbeat(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 75);
        }),
      () => {
        extensions.push(Date.now());
      },
      {
        ttlMs: 30,
        heartbeatIntervalMs: 10,
      }
    );

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(75);
    expect(extensions.length).toBeGreaterThanOrEqual(5);
  });

  it("rejects when extending the lock fails", async () => {
    const extensionError = new Error("redis unavailable");

    await expect(
      withTradeLockHeartbeat(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 100);
          }),
        () => {
          throw extensionError;
        },
        {
          ttlMs: 60,
          heartbeatIntervalMs: 10,
        }
      )
    ).rejects.toBe(extensionError);
  });
});
