import AppDataSource from "../../config/Datasource";
import { webhookIdempotencyService } from "../webhookIdempotency.service";

/**
 * Integration tests for webhook idempotency
 * Verifies that duplicate webhook deliveries are properly handled
 */

describe("Webhook Idempotency Integration Tests", () => {
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

  afterEach(async () => {
    // Clean up test data
    const repository = AppDataSource.getRepository("WebhookIdempotency");
    await repository
      .createQueryBuilder()
      .delete()
      .where("metadata->>'test' = :test", { test: "true" })
      .execute();
  });

  describe("checkAndMark", () => {
    it("should process a new webhook", async () => {
      const webhookId = `test_${Date.now()}`;
      const isNew = await webhookIdempotencyService.checkAndMark(
        webhookId,
        "telegram",
        { test: true, timestamp: new Date().toISOString() }
      );

      expect(isNew).toBe(true);
    });

    it("should reject duplicate webhooks", async () => {
      const webhookId = `test_dup_${Date.now()}`;

      // First call should be new
      const isNew1 = await webhookIdempotencyService.checkAndMark(
        webhookId,
        "telegram",
        { test: true }
      );
      expect(isNew1).toBe(true);

      // Second call with same ID should be duplicate
      const isNew2 = await webhookIdempotencyService.checkAndMark(
        webhookId,
        "telegram",
        { test: true }
      );
      expect(isNew2).toBe(false);
    });

    it("should allow same webhook ID with different platform", async () => {
      const webhookId = `test_plat_${Date.now()}`;

      // First platform
      const isNew1 = await webhookIdempotencyService.checkAndMark(
        webhookId,
        "telegram",
        { test: true }
      );
      expect(isNew1).toBe(true);

      // Different platform should be new
      const isNew2 = await webhookIdempotencyService.checkAndMark(
        webhookId,
        "discord",
        { test: true }
      );
      expect(isNew2).toBe(true);
    });
  });

  describe("isDuplicate", () => {
    it("should identify existing webhooks as duplicates", async () => {
      const webhookId = `test_exist_${Date.now()}`;

      // First create a webhook
      await webhookIdempotencyService.markProcessed(webhookId, "telegram");

      // Check if it's duplicate
      const isDup = await webhookIdempotencyService.isDuplicate(
        webhookId,
        "telegram"
      );
      expect(isDup).toBe(true);
    });

    it("should identify non-existing webhooks", async () => {
      const isDup = await webhookIdempotencyService.isDuplicate(
        "nonexistent_webhook_12345",
        "telegram"
      );
      expect(isDup).toBe(false);
    });
  });

  describe("markProcessed", () => {
    it("should mark a webhook as processed", async () => {
      const webhookId = `test_mark_${Date.now()}`;

      // Mark as processed
      await webhookIdempotencyService.markProcessed(webhookId, "telegram");

      // Verify it's now in the system
      const isDup = await webhookIdempotencyService.isDuplicate(
        webhookId,
        "telegram"
      );
      expect(isDup).toBe(true);
    });
  });

  describe("Duplicate webhook delivery scenario", () => {
    it("should prevent duplicate side effects from repeated webhook delivery", async () => {
      const webhookId = `test_scenario_${Date.now()}`;
      const platform = "telegram";
      const metadata = {
        test: true,
        messageId: "12345",
        userId: "user-123",
      };

      // Simulate first webhook delivery
      const firstDelivery = await webhookIdempotencyService.checkAndMark(
        webhookId,
        platform,
        metadata
      );
      expect(firstDelivery).toBe(true); // Should be processed

      // Simulate duplicate delivery (network retry)
      const secondDelivery = await webhookIdempotencyService.checkAndMark(
        webhookId,
        platform,
        metadata
      );
      expect(secondDelivery).toBe(false); // Should be rejected

      // Verify the duplicate is identified
      const isDuplicate = await webhookIdempotencyService.isDuplicate(
        webhookId,
        platform
      );
      expect(isDuplicate).toBe(true);
    });

    it("should handle rapid successive duplicate deliveries", async () => {
      const webhookId = `test_rapid_${Date.now()}`;
      const platform = "telegram";

      // First delivery
      const first = await webhookIdempotencyService.checkAndMark(
        webhookId,
        platform,
        { test: true }
      );
      expect(first).toBe(true);

      // Simulate rapid retries
      const results = await Promise.all([
        webhookIdempotencyService.checkAndMark(webhookId, platform, {
          test: true,
        }),
        webhookIdempotencyService.checkAndMark(webhookId, platform, {
          test: true,
        }),
        webhookIdempotencyService.checkAndMark(webhookId, platform, {
          test: true,
        }),
      ]);

      // All should be duplicates
      expect(results).toEqual([false, false, false]);
    });

    it("should support multiple platforms independently", async () => {
      const webhookId = `test_multi_${Date.now()}`;
      const platforms = ["telegram", "discord", "slack"];

      // Process same webhook ID across different platforms
      for (const platform of platforms) {
        const isNew = await webhookIdempotencyService.checkAndMark(
          webhookId,
          platform,
          { test: true }
        );
        expect(isNew).toBe(true);
      }

      // Verify each platform now has the webhook
      for (const platform of platforms) {
        const isDup = await webhookIdempotencyService.isDuplicate(
          webhookId,
          platform
        );
        expect(isDup).toBe(true);
      }

      // Verify duplicate attempts are still rejected per platform
      for (const platform of platforms) {
        const isNew = await webhookIdempotencyService.checkAndMark(
          webhookId,
          platform,
          { test: true }
        );
        expect(isNew).toBe(false);
      }
    });
  });
});
