import crypto from "crypto";
import AppDataSource from "../../config/Datasource";
import { WebhookReplayTracker } from "../WebhookReplayTracker";
import { VerificationResult } from "../WebhookSignatureService";
import { WebhookIdempotency } from "../webhookIdempotency.entity";

/**
 * Integration tests for WebhookReplayTracker
 *
 * AC: Tests cover duplicate delivery, replay attacks, and cross-instance protection
 */
describe("WebhookReplayTracker Integration Tests", () => {
  let tracker: WebhookReplayTracker;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
  });

  beforeEach(async () => {
    tracker = new WebhookReplayTracker();
    // Clean up test data
    const repository = AppDataSource.getRepository(WebhookIdempotency);
    await repository.delete({});
  });

  afterAll(async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  describe("Duplicate Delivery Detection", () => {
    it("should detect duplicate webhook delivery with same ID", async () => {
      const provider = "telegram";
      const webhookId = `test_webhook_${Date.now()}`;
      const payload = { update_id: 12345, message: { text: "test" } };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const verificationResult: VerificationResult = {
        valid: true,
        provider,
        timestamp: new Date(),
      };

      // First delivery
      const firstCheck = await tracker.checkReplay(
        provider,
        webhookId,
        rawBody,
        verificationResult
      );

      expect(firstCheck.isReplay).toBe(false);
      expect(firstCheck.isDuplicate).toBe(false);

      await tracker.recordWebhook(
        provider,
        webhookId,
        rawBody,
        verificationResult
      );

      // Second delivery (duplicate)
      const secondCheck = await tracker.checkReplay(
        provider,
        webhookId,
        rawBody,
        verificationResult
      );

      expect(secondCheck.isReplay).toBe(false);
      expect(secondCheck.isDuplicate).toBe(true);
      expect(secondCheck.reason).toBe("Duplicate webhook delivery");
      expect(secondCheck.existingRecord).toBeDefined();
      expect(secondCheck.existingRecord?.webhookId).toBe(webhookId);
    });

    it("should allow same webhook ID from different platforms", async () => {
      const webhookId = `shared_id_${Date.now()}`;
      const payload = { id: webhookId, data: "test" };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const telegramResult: VerificationResult = {
        valid: true,
        provider: "telegram",
      };

      const discordResult: VerificationResult = {
        valid: true,
        provider: "discord",
      };

      // Record for Telegram
      await tracker.recordWebhook(
        "telegram",
        webhookId,
        rawBody,
        telegramResult
      );

      // Check for Discord (should not be duplicate)
      const discordCheck = await tracker.checkReplay(
        "discord",
        webhookId,
        rawBody,
        discordResult
      );

      expect(discordCheck.isReplay).toBe(false);
      expect(discordCheck.isDuplicate).toBe(false);
    });

    it("should handle rapid successive duplicate deliveries", async () => {
      const provider = "stellar";
      const webhookId = `rapid_test_${Date.now()}`;
      const payload = { id: webhookId, transaction: "abc123" };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const verificationResult: VerificationResult = {
        valid: true,
        provider,
      };

      // Record first delivery
      await tracker.recordWebhook(
        provider,
        webhookId,
        rawBody,
        verificationResult
      );

      // Simulate rapid successive deliveries
      const checks = await Promise.all([
        tracker.checkReplay(provider, webhookId, rawBody, verificationResult),
        tracker.checkReplay(provider, webhookId, rawBody, verificationResult),
        tracker.checkReplay(provider, webhookId, rawBody, verificationResult),
      ]);

      // All should be detected as duplicates
      checks.forEach((check) => {
        expect(check.isDuplicate).toBe(true);
        expect(check.isReplay).toBe(false);
      });
    });
  });

  describe("Payload Mutation Detection", () => {
    it("should detect payload mutation with same webhook ID", async () => {
      const provider = "github";
      const webhookId = `mutation_test_${Date.now()}`;

      const originalPayload = { id: webhookId, amount: 100 };
      const mutatedPayload = { id: webhookId, amount: 9999 };

      const originalBody = Buffer.from(JSON.stringify(originalPayload));
      const mutatedBody = Buffer.from(JSON.stringify(mutatedPayload));

      const verificationResult: VerificationResult = {
        valid: true,
        provider,
      };

      // Record original
      await tracker.recordWebhook(
        provider,
        webhookId,
        originalBody,
        verificationResult
      );

      // Attempt with mutated payload
      const mutationCheck = await tracker.checkReplay(
        provider,
        webhookId,
        mutatedBody,
        verificationResult
      );

      expect(mutationCheck.isReplay).toBe(true);
      expect(mutationCheck.isDuplicate).toBe(false);
      expect(mutationCheck.reason).toContain("Payload mutation");
      expect(mutationCheck.existingRecord).toBeDefined();
    });

    it("should compute different hashes for different payloads", async () => {
      const provider = "test";
      const webhookId1 = `hash_test_1_${Date.now()}`;
      const webhookId2 = `hash_test_2_${Date.now()}`;

      const payload1 = { id: webhookId1, value: "a" };
      const payload2 = { id: webhookId2, value: "b" };

      const body1 = Buffer.from(JSON.stringify(payload1));
      const body2 = Buffer.from(JSON.stringify(payload2));

      const hash1 = crypto.createHash("sha256").update(body1).digest("hex");
      const hash2 = crypto.createHash("sha256").update(body2).digest("hex");

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("Signature Replay Detection", () => {
    it("should detect signature reused with different webhook ID", async () => {
      const provider = "stripe";
      const webhookId1 = `sig_test_1_${Date.now()}`;
      const webhookId2 = `sig_test_2_${Date.now()}`;

      const payload = { event: "payment.succeeded", amount: 100 };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const timestamp = new Date();
      const verificationResult: VerificationResult = {
        valid: true,
        provider,
        timestamp,
      };

      // Record first webhook
      await tracker.recordWebhook(
        provider,
        webhookId1,
        rawBody,
        verificationResult
      );

      // Attempt to replay with different webhook ID
      const replayCheck = await tracker.checkReplay(
        provider,
        webhookId2,
        rawBody,
        verificationResult
      );

      expect(replayCheck.isReplay).toBe(true);
      expect(replayCheck.isDuplicate).toBe(false);
      expect(replayCheck.reason).toContain("Signature replay");
      expect(replayCheck.existingRecord?.webhookId).toBe(webhookId1);
    });
  });

  describe("Payload Replay Detection", () => {
    it("should detect same payload with different webhook ID within time window", async () => {
      const provider = "telegram";
      const webhookId1 = `payload_test_1_${Date.now()}`;
      const webhookId2 = `payload_test_2_${Date.now()}`;

      const payload = { message: { text: "identical content" } };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const verificationResult: VerificationResult = {
        valid: true,
        provider,
      };

      // Record first webhook
      await tracker.recordWebhook(
        provider,
        webhookId1,
        rawBody,
        verificationResult
      );

      // Attempt with different ID but same payload (within 1 hour window)
      const replayCheck = await tracker.checkReplay(
        provider,
        webhookId2,
        rawBody,
        verificationResult
      );

      expect(replayCheck.isReplay).toBe(true);
      expect(replayCheck.reason).toContain("Payload replay");
      expect(replayCheck.existingRecord?.webhookId).toBe(webhookId1);
    });
  });

  describe("Cross-Instance Protection", () => {
    it("should share replay protection across multiple tracker instances", async () => {
      const tracker1 = new WebhookReplayTracker();
      const tracker2 = new WebhookReplayTracker();

      const provider = "discord";
      const webhookId = `cross_instance_${Date.now()}`;
      const payload = { id: webhookId, type: "MESSAGE_CREATE" };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const verificationResult: VerificationResult = {
        valid: true,
        provider,
      };

      // Instance 1 records webhook
      await tracker1.recordWebhook(
        provider,
        webhookId,
        rawBody,
        verificationResult
      );

      // Instance 2 should detect duplicate
      const check = await tracker2.checkReplay(
        provider,
        webhookId,
        rawBody,
        verificationResult
      );

      expect(check.isDuplicate).toBe(true);
      expect(check.isReplay).toBe(false);
    });

    it("should handle concurrent writes from multiple instances", async () => {
      const provider = "stellar";
      const webhookId = `concurrent_${Date.now()}`;
      const payload = { id: webhookId };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const verificationResult: VerificationResult = {
        valid: true,
        provider,
      };

      // Simulate concurrent writes from 3 instances
      const results = await Promise.allSettled([
        tracker.recordWebhook(provider, webhookId, rawBody, verificationResult),
        tracker.recordWebhook(provider, webhookId, rawBody, verificationResult),
        tracker.recordWebhook(provider, webhookId, rawBody, verificationResult),
      ]);

      // At least one should succeed (first write wins)
      const successCount = results.filter((r) => r.status === "fulfilled").length;
      expect(successCount).toBeGreaterThanOrEqual(1);

      // Verify only one record exists
      const repository = AppDataSource.getRepository(WebhookIdempotency);
      const records = await repository.find({
        where: { webhookId, platform: provider },
      });

      expect(records).toHaveLength(1);
    });
  });

  describe("Timestamp Tracking", () => {
    it("should store and retrieve webhook timestamps", async () => {
      const provider = "stellar";
      const webhookId = `timestamp_test_${Date.now()}`;
      const payload = { id: webhookId };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const timestamp = new Date();
      const verificationResult: VerificationResult = {
        valid: true,
        provider,
        timestamp,
      };

      await tracker.recordWebhook(
        provider,
        webhookId,
        rawBody,
        verificationResult
      );

      const check = await tracker.checkReplay(
        provider,
        webhookId,
        rawBody,
        verificationResult
      );

      expect(check.isDuplicate).toBe(true);
      expect(check.existingRecord?.timestamp).toBeDefined();
      expect(check.existingRecord?.timestamp?.getTime()).toBeCloseTo(
        timestamp.getTime(),
        -2
      ); // Within 100ms
    });
  });

  describe("Metadata Storage", () => {
    it("should store verification metadata with webhook record", async () => {
      const provider = "github";
      const webhookId = `metadata_test_${Date.now()}`;
      const payload = { id: webhookId };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const verificationResult: VerificationResult = {
        valid: true,
        provider,
        usedPreviousSecret: true,
        timestampSkewMs: 1500,
      };

      const customMetadata = {
        deliveryAttempt: 1,
        source: "test",
      };

      await tracker.recordWebhook(
        provider,
        webhookId,
        rawBody,
        verificationResult,
        customMetadata
      );

      const repository = AppDataSource.getRepository(WebhookIdempotency);
      const record = await repository.findOne({
        where: { webhookId, platform: provider },
      });

      expect(record).toBeDefined();
      expect(record?.metadata).toBeDefined();
      expect((record?.metadata as any)?.signatureValid).toBe(true);
      expect((record?.metadata as any)?.usedPreviousSecret).toBe(true);
      expect((record?.metadata as any)?.timestampSkewMs).toBe(1500);
      expect((record?.metadata as any)?.deliveryAttempt).toBe(1);
      expect((record?.metadata as any)?.source).toBe("test");
    });
  });

  describe("Statistics", () => {
    it("should provide accurate statistics", async () => {
      const provider1 = "telegram";
      const provider2 = "discord";

      // Create multiple records
      for (let i = 0; i < 3; i++) {
        const webhookId = `stats_telegram_${i}_${Date.now()}`;
        const rawBody = Buffer.from(JSON.stringify({ id: webhookId }));
        await tracker.recordWebhook(provider1, webhookId, rawBody, {
          valid: true,
          provider: provider1,
        });
      }

      for (let i = 0; i < 2; i++) {
        const webhookId = `stats_discord_${i}_${Date.now()}`;
        const rawBody = Buffer.from(JSON.stringify({ id: webhookId }));
        await tracker.recordWebhook(provider2, webhookId, rawBody, {
          valid: true,
          provider: provider2,
        });
      }

      const stats = await tracker.getStats();

      expect(stats.totalRecords).toBeGreaterThanOrEqual(5);
      expect(stats.recordsByPlatform[provider1]).toBeGreaterThanOrEqual(3);
      expect(stats.recordsByPlatform[provider2]).toBeGreaterThanOrEqual(2);
      expect(stats.oldestRecord).toBeDefined();
      expect(stats.newestRecord).toBeDefined();
    });
  });

  describe("Cleanup", () => {
    it("should clean up old webhook records", async () => {
      const provider = "stellar";
      const webhookId = `cleanup_test_${Date.now()}`;
      const rawBody = Buffer.from(JSON.stringify({ id: webhookId }));

      await tracker.recordWebhook(provider, webhookId, rawBody, {
        valid: true,
        provider,
      });

      // Manually update createdAt to be old
      const repository = AppDataSource.getRepository(WebhookIdempotency);
      const record = await repository.findOne({
        where: { webhookId, platform: provider },
      });

      if (record) {
        record.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
        await repository.save(record);
      }

      // Trigger cleanup manually
      await (tracker as any).cleanup();

      // Record should be deleted
      const deletedRecord = await repository.findOne({
        where: { webhookId, platform: provider },
      });

      expect(deletedRecord).toBeNull();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty payload", async () => {
      const provider = "test";
      const webhookId = `empty_${Date.now()}`;
      const rawBody = Buffer.from("{}");

      const verificationResult: VerificationResult = {
        valid: true,
        provider,
      };

      const check = await tracker.checkReplay(
        provider,
        webhookId,
        rawBody,
        verificationResult
      );

      expect(check.isReplay).toBe(false);
      expect(check.isDuplicate).toBe(false);
    });

    it("should handle very long webhook IDs", async () => {
      const provider = "test";
      const webhookId = "x".repeat(250); // Near max length
      const rawBody = Buffer.from(JSON.stringify({ id: webhookId }));

      const verificationResult: VerificationResult = {
        valid: true,
        provider,
      };

      await tracker.recordWebhook(
        provider,
        webhookId,
        rawBody,
        verificationResult
      );

      const check = await tracker.checkReplay(
        provider,
        webhookId,
        rawBody,
        verificationResult
      );

      expect(check.isDuplicate).toBe(true);
    });

    it("should handle special characters in webhook ID", async () => {
      const provider = "test";
      const webhookId = `special_!@#$%_${Date.now()}`;
      const rawBody = Buffer.from(JSON.stringify({ id: webhookId }));

      const verificationResult: VerificationResult = {
        valid: true,
        provider,
      };

      await tracker.recordWebhook(
        provider,
        webhookId,
        rawBody,
        verificationResult
      );

      const check = await tracker.checkReplay(
        provider,
        webhookId,
        rawBody,
        verificationResult
      );

      expect(check.isDuplicate).toBe(true);
    });
  });
});
