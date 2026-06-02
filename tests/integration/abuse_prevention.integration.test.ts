import { AbusePreventionService } from "../../src/Security/abusePrevention";

describe("Abuse prevention policy integration", () => {
  it("applies deny policies consistently across API, bot, and realtime surfaces", async () => {
    const service = new AbusePreventionService({
      rules: [
        {
          id: "known-abusive-user",
          surfaces: ["api", "bot", "realtime"],
          actions: ["*"],
          decision: "deny",
          reason: "Known abusive account",
          match: ({ subject }) => subject.userId === "blocked-user",
        },
      ],
    });

    for (const surface of ["api", "bot", "realtime"] as const) {
      await expect(
        service.evaluate({
          surface,
          action: "query",
          subject: { userId: "blocked-user" },
        })
      ).resolves.toMatchObject({
        allowed: false,
        decision: "deny",
        policyId: "known-abusive-user",
      });
    }
  });

  it("enforces rate limits without depending on Express middleware", async () => {
    const service = new AbusePreventionService({
      rateLimits: [
        {
          id: "bot-command-test",
          surfaces: ["bot"],
          actions: ["*"],
          maxRequests: 2,
          windowMs: 1000,
          keyBy: ["userId"],
        },
      ],
    });

    const context = {
      surface: "bot" as const,
      action: "swap",
      subject: { userId: "user-1" },
      now: 1000,
    };

    expect(await service.evaluate(context)).toMatchObject({ allowed: true });
    expect(await service.evaluate({ ...context, now: 1100 })).toMatchObject({
      allowed: true,
    });
    expect(await service.evaluate({ ...context, now: 1200 })).toMatchObject({
      allowed: false,
      decision: "throttle",
      retryAfterMs: 800,
    });
    expect(await service.evaluate({ ...context, now: 2101 })).toMatchObject({
      allowed: true,
    });
  });
});
