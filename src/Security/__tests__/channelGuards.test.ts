import { evaluateBotAbusePolicy, evaluateRealtimeAbusePolicy } from "../abusePrevention/channelGuards";
import { AbusePreventionService } from "../abusePrevention/AbusePreventionService";

describe("channelGuards", () => {
  let mockService: jest.Mocked<AbusePreventionService>;

  beforeEach(() => {
    // Mock the evaluate method
    mockService = {
      evaluate: jest.fn(),
    } as unknown as jest.Mocked<AbusePreventionService>;
  });

  describe("evaluateBotAbusePolicy", () => {
    it("should apply bot surface and return evaluation result", async () => {
      mockService.evaluate.mockResolvedValueOnce({ decision: "allow" });

      const result = await evaluateBotAbusePolicy("test-action", { userId: "user-1" }, { meta: "data" }, mockService);

      expect(mockService.evaluate).toHaveBeenCalledWith({
        surface: "bot",
        action: "test-action",
        subject: { userId: "user-1" },
        metadata: { meta: "data" },
      });
      expect(result).toEqual({ decision: "allow" });
    });

    it("should handle guard rejection", async () => {
      mockService.evaluate.mockResolvedValueOnce({
        decision: "deny",
        reason: "Rate limit exceeded",
      });

      const result = await evaluateBotAbusePolicy("test-action", { userId: "user-2" }, {}, mockService);

      expect(result).toEqual({
        decision: "deny",
        reason: "Rate limit exceeded",
      });
    });

    it("should use default policy service if no service is provided", async () => {
      // By importing the default instance we could spy on it, but it's simpler to just ensure it doesn't throw.
      // This tests the default parameter behavior.
      const result = await evaluateBotAbusePolicy("default-test", { userId: "user-3" });
      // Since it's using the real service, we just expect it to return a valid object format.
      expect(result.decision).toBeDefined();
    });
  });

  describe("evaluateRealtimeAbusePolicy", () => {
    it("should apply realtime surface and return evaluation result", async () => {
      mockService.evaluate.mockResolvedValueOnce({ decision: "allow" });

      const result = await evaluateRealtimeAbusePolicy("test-action", { userId: "user-1" }, { meta: "data" }, mockService);

      expect(mockService.evaluate).toHaveBeenCalledWith({
        surface: "realtime",
        action: "test-action",
        subject: { userId: "user-1" },
        metadata: { meta: "data" },
      });
      expect(result).toEqual({ decision: "allow" });
    });

    it("should handle guard rejection", async () => {
      mockService.evaluate.mockResolvedValueOnce({
        decision: "deny",
        reason: "IP blocked",
      });

      const result = await evaluateRealtimeAbusePolicy("test-action", { userId: "user-2" }, {}, mockService);

      expect(result).toEqual({
        decision: "deny",
        reason: "IP blocked",
      });
    });
    
    it("should use default policy service if no service is provided", async () => {
      const result = await evaluateRealtimeAbusePolicy("default-test", { userId: "user-3" });
      expect(result.decision).toBeDefined();
    });
  });
});
