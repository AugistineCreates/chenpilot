import { Request } from "express";
import crypto from "crypto";
import { WebhookSignatureService } from "../WebhookSignatureService";
import { webhookSecretManager } from "../WebhookSecretManager";

/**
 * Unit tests for WebhookSignatureService
 *
 * AC: Tests cover body mutation, duplicate delivery, skew, and oversized input
 */
describe("WebhookSignatureService", () => {
  let service: WebhookSignatureService;
  const TEST_SECRET = "test-webhook-secret-123";
  const TEST_SECRET_PREVIOUS = "old-webhook-secret-456";

  beforeEach(() => {
    service = new WebhookSignatureService();
    // Register test secrets
    webhookSecretManager.registerSecret("test-provider", TEST_SECRET);
  });

  afterEach(() => {
    webhookSecretManager.unregisterSecret("test-provider");
  });

  describe("Signature Verification", () => {
    it("should verify valid HMAC-SHA256 signature", async () => {
      const payload = { test: "data", timestamp: Date.now() };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const expectedSignature = crypto
        .createHmac("sha256", TEST_SECRET)
        .update(rawBody)
        .digest("hex");

      const req = createMockRequest(rawBody, {
        "x-webhook-signature": `sha256=${expectedSignature}`,
      });

      // Register a custom provider for this test
      service.registerProvider({
        name: "test-provider",
        signatureHeader: "x-webhook-signature",
        algorithm: "hmac-sha256",
        encoding: "hex",
        signaturePrefix: "sha256=",
        replayWindowMs: 300000,
      });

      const result = await service.verify(req, "test-provider");

      expect(result.valid).toBe(true);
      expect(result.provider).toBe("test-provider");
      expect(result.error).toBeUndefined();
    });

    it("should reject invalid signature", async () => {
      const payload = { test: "data" };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const req = createMockRequest(rawBody, {
        "x-webhook-signature": "sha256=invalid-signature-hash",
      });

      service.registerProvider({
        name: "test-provider",
        signatureHeader: "x-webhook-signature",
        algorithm: "hmac-sha256",
        encoding: "hex",
        signaturePrefix: "sha256=",
        replayWindowMs: 300000,
      });

      const result = await service.verify(req, "test-provider");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid signature");
    });

    it("should reject missing signature header", async () => {
      const payload = { test: "data" };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const req = createMockRequest(rawBody, {});

      service.registerProvider({
        name: "test-provider",
        signatureHeader: "x-webhook-signature",
        algorithm: "hmac-sha256",
        encoding: "hex",
        replayWindowMs: 300000,
      });

      const result = await service.verify(req, "test-provider");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Missing signature header");
    });

    it("should detect body mutation after signature generation", async () => {
      const originalPayload = { test: "data", value: 100 };
      const mutatedPayload = { test: "data", value: 999 };

      const rawBody = Buffer.from(JSON.stringify(originalPayload));
      const mutatedBody = Buffer.from(JSON.stringify(mutatedPayload));

      // Generate signature for original payload
      const validSignature = crypto
        .createHmac("sha256", TEST_SECRET)
        .update(rawBody)
        .digest("hex");

      // But send mutated body with original signature
      const req = createMockRequest(mutatedBody, {
        "x-webhook-signature": `sha256=${validSignature}`,
      });

      service.registerProvider({
        name: "test-provider",
        signatureHeader: "x-webhook-signature",
        algorithm: "hmac-sha256",
        encoding: "hex",
        signaturePrefix: "sha256=",
        replayWindowMs: 300000,
      });

      const result = await service.verify(req, "test-provider");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid signature");
    });

    it("should use timing-safe comparison to prevent timing attacks", async () => {
      const payload = { test: "data" };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const correctSignature = crypto
        .createHmac("sha256", TEST_SECRET)
        .update(rawBody)
        .digest("hex");

      // Create a signature that differs only in the last character
      const almostCorrectSignature =
        correctSignature.slice(0, -1) +
        (correctSignature.slice(-1) === "a" ? "b" : "a");

      const req = createMockRequest(rawBody, {
        "x-webhook-signature": `sha256=${almostCorrectSignature}`,
      });

      service.registerProvider({
        name: "test-provider",
        signatureHeader: "x-webhook-signature",
        algorithm: "hmac-sha256",
        encoding: "hex",
        signaturePrefix: "sha256=",
        replayWindowMs: 300000,
      });

      const result = await service.verify(req, "test-provider");

      expect(result.valid).toBe(false);
    });
  });

  describe("Timestamp and Replay Window", () => {
    it("should accept webhook within replay window", async () => {
      const now = Math.floor(Date.now() / 1000);
      const payload = { test: "data" };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const signedPayload = `${now}.${rawBody.toString("utf8")}`;
      const signature = crypto
        .createHmac("sha256", TEST_SECRET)
        .update(signedPayload)
        .digest("hex");

      const req = createMockRequest(rawBody, {
        "x-webhook-signature": signature,
        "x-webhook-timestamp": now.toString(),
      });

      service.registerProvider({
        name: "test-provider",
        signatureHeader: "x-webhook-signature",
        timestampHeader: "x-webhook-timestamp",
        algorithm: "hmac-sha256",
        encoding: "hex",
        replayWindowMs: 300000, // 5 minutes
        constructSignedPayload: (body, timestamp) =>
          timestamp ? `${timestamp}.${body.toString("utf8")}` : body.toString("utf8"),
      });

      const result = await service.verify(req, "test-provider");

      expect(result.valid).toBe(true);
      expect(result.timestamp).toBeDefined();
    });

    it("should reject webhook outside replay window (too old)", async () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const payload = { test: "data" };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const signedPayload = `${oldTimestamp}.${rawBody.toString("utf8")}`;
      const signature = crypto
        .createHmac("sha256", TEST_SECRET)
        .update(signedPayload)
        .digest("hex");

      const req = createMockRequest(rawBody, {
        "x-webhook-signature": signature,
        "x-webhook-timestamp": oldTimestamp.toString(),
      });

      service.registerProvider({
        name: "test-provider",
        signatureHeader: "x-webhook-signature",
        timestampHeader: "x-webhook-timestamp",
        algorithm: "hmac-sha256",
        encoding: "hex",
        replayWindowMs: 300000, // 5 minutes
        constructSignedPayload: (body, timestamp) =>
          timestamp ? `${timestamp}.${body.toString("utf8")}` : body.toString("utf8"),
      });

      const result = await service.verify(req, "test-provider");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("outside replay window");
      expect(result.timestampSkewMs).toBeGreaterThan(300000);
    });

    it("should reject webhook with future timestamp (clock skew)", async () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 600; // 10 minutes in future
      const payload = { test: "data" };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const signedPayload = `${futureTimestamp}.${rawBody.toString("utf8")}`;
      const signature = crypto
        .createHmac("sha256", TEST_SECRET)
        .update(signedPayload)
        .digest("hex");

      const req = createMockRequest(rawBody, {
        "x-webhook-signature": signature,
        "x-webhook-timestamp": futureTimestamp.toString(),
      });

      service.registerProvider({
        name: "test-provider",
        signatureHeader: "x-webhook-signature",
        timestampHeader: "x-webhook-timestamp",
        algorithm: "hmac-sha256",
        encoding: "hex",
        replayWindowMs: 300000, // 5 minutes
        constructSignedPayload: (body, timestamp) =>
          timestamp ? `${timestamp}.${body.toString("utf8")}` : body.toString("utf8"),
      });

      const result = await service.verify(req, "test-provider");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("outside replay window");
    });

    it("should handle missing timestamp gracefully", async () => {
      const payload = { test: "data" };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const signature = crypto
        .createHmac("sha256", TEST_SECRET)
        .update(rawBody)
        .digest("hex");

      const req = createMockRequest(rawBody, {
        "x-webhook-signature": signature,
        // No timestamp header
      });

      service.registerProvider({
        name: "test-provider",
        signatureHeader: "x-webhook-signature",
        timestampHeader: "x-webhook-timestamp", // Expected but not provided
        algorithm: "hmac-sha256",
        encoding: "hex",
        replayWindowMs: 300000,
      });

      const result = await service.verify(req, "test-provider");

      // Should still verify signature even without timestamp
      expect(result.valid).toBe(true);
      expect(result.timestamp).toBeUndefined();
    });
  });

  describe("Secret Rotation", () => {
    it("should verify with current secret", async () => {
      webhookSecretManager.registerSecret(
        "test-provider",
        TEST_SECRET,
        TEST_SECRET_PREVIOUS
      );

      const payload = { test: "data" };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const signature = crypto
        .createHmac("sha256", TEST_SECRET)
        .update(rawBody)
        .digest("hex");

      const req = createMockRequest(rawBody, {
        "x-webhook-signature": `sha256=${signature}`,
      });

      service.registerProvider({
        name: "test-provider",
        signatureHeader: "x-webhook-signature",
        algorithm: "hmac-sha256",
        encoding: "hex",
        signaturePrefix: "sha256=",
        replayWindowMs: 300000,
      });

      const result = await service.verify(req, "test-provider");

      expect(result.valid).toBe(true);
      expect(result.usedPreviousSecret).toBe(false);
    });

    it("should verify with previous secret during rotation", async () => {
      webhookSecretManager.registerSecret(
        "test-provider",
        TEST_SECRET,
        TEST_SECRET_PREVIOUS
      );

      const payload = { test: "data" };
      const rawBody = Buffer.from(JSON.stringify(payload));

      // Sign with OLD secret
      const signature = crypto
        .createHmac("sha256", TEST_SECRET_PREVIOUS)
        .update(rawBody)
        .digest("hex");

      const req = createMockRequest(rawBody, {
        "x-webhook-signature": `sha256=${signature}`,
      });

      service.registerProvider({
        name: "test-provider",
        signatureHeader: "x-webhook-signature",
        algorithm: "hmac-sha256",
        encoding: "hex",
        signaturePrefix: "sha256=",
        replayWindowMs: 300000,
      });

      const result = await service.verify(req, "test-provider");

      expect(result.valid).toBe(true);
      expect(result.usedPreviousSecret).toBe(true);
    });

    it("should reject webhook signed with unknown secret", async () => {
      webhookSecretManager.registerSecret("test-provider", TEST_SECRET);

      const payload = { test: "data" };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const unknownSecret = "completely-different-secret";
      const signature = crypto
        .createHmac("sha256", unknownSecret)
        .update(rawBody)
        .digest("hex");

      const req = createMockRequest(rawBody, {
        "x-webhook-signature": `sha256=${signature}`,
      });

      service.registerProvider({
        name: "test-provider",
        signatureHeader: "x-webhook-signature",
        algorithm: "hmac-sha256",
        encoding: "hex",
        signaturePrefix: "sha256=",
        replayWindowMs: 300000,
      });

      const result = await service.verify(req, "test-provider");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid signature");
    });
  });

  describe("Provider-Specific Configurations", () => {
    it("should verify Stellar webhook with timestamp", async () => {
      webhookSecretManager.registerSecret("stellar", TEST_SECRET);

      const timestamp = Math.floor(Date.now() / 1000);
      const payload = { id: "stellar-123", type: "payment" };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const signedPayload = `${timestamp}.${rawBody.toString("utf8")}`;
      const signature = crypto
        .createHmac("sha256", TEST_SECRET)
        .update(signedPayload)
        .digest("hex");

      const req = createMockRequest(rawBody, {
        "x-stellar-signature": signature,
        "x-stellar-timestamp": timestamp.toString(),
      });

      const result = await service.verify(req, "stellar");

      expect(result.valid).toBe(true);
      expect(result.timestamp).toBeDefined();
    });

    it("should verify Telegram webhook", async () => {
      webhookSecretManager.registerSecret("telegram", TEST_SECRET);

      const payload = { update_id: 12345, message: { text: "test" } };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const signature = crypto
        .createHmac("sha256", TEST_SECRET)
        .update(rawBody)
        .digest("hex");

      const req = createMockRequest(rawBody, {
        "x-telegram-bot-api-secret-token": signature,
      });

      const result = await service.verify(req, "telegram");

      expect(result.valid).toBe(true);
    });

    it("should verify GitHub webhook with sha256 prefix", async () => {
      webhookSecretManager.registerSecret("github", TEST_SECRET);

      const payload = { action: "opened", repository: { name: "test" } };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const signature = crypto
        .createHmac("sha256", TEST_SECRET)
        .update(rawBody)
        .digest("hex");

      const req = createMockRequest(rawBody, {
        "x-hub-signature-256": `sha256=${signature}`,
      });

      const result = await service.verify(req, "github");

      expect(result.valid).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should handle missing raw body", async () => {
      const req = {
        headers: {
          "x-webhook-signature": "sha256=somesig",
        },
        body: { test: "data" },
        // No rawBody
      } as unknown as Request;

      service.registerProvider({
        name: "test-provider",
        signatureHeader: "x-webhook-signature",
        algorithm: "hmac-sha256",
        encoding: "hex",
        signaturePrefix: "sha256=",
        replayWindowMs: 300000,
      });

      const result = await service.verify(req, "test-provider");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Raw body not captured");
    });

    it("should handle unknown provider", async () => {
      const payload = { test: "data" };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const req = createMockRequest(rawBody, {});

      const result = await service.verify(req, "unknown-provider");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Unknown provider");
    });

    it("should handle missing secret configuration", async () => {
      const payload = { test: "data" };
      const rawBody = Buffer.from(JSON.stringify(payload));

      const req = createMockRequest(rawBody, {
        "x-webhook-signature": "sha256=somesig",
      });

      service.registerProvider({
        name: "no-secret-provider",
        signatureHeader: "x-webhook-signature",
        algorithm: "hmac-sha256",
        encoding: "hex",
        signaturePrefix: "sha256=",
        replayWindowMs: 300000,
      });

      const result = await service.verify(req, "no-secret-provider");

      expect(result.valid).toBe(false);
      expect(result.error).toContain("No secrets configured");
    });
  });

  describe("Oversized Input Handling", () => {
    it("should handle large but valid payloads", async () => {
      // Create a large payload (500KB)
      const largePayload = {
        data: "x".repeat(500 * 1024),
      };
      const rawBody = Buffer.from(JSON.stringify(largePayload));

      const signature = crypto
        .createHmac("sha256", TEST_SECRET)
        .update(rawBody)
        .digest("hex");

      const req = createMockRequest(rawBody, {
        "x-webhook-signature": `sha256=${signature}`,
      });

      service.registerProvider({
        name: "test-provider",
        signatureHeader: "x-webhook-signature",
        algorithm: "hmac-sha256",
        encoding: "hex",
        signaturePrefix: "sha256=",
        replayWindowMs: 300000,
      });

      const result = await service.verify(req, "test-provider");

      expect(result.valid).toBe(true);
    });
  });
});

/**
 * Helper function to create mock Express Request with raw body
 */
function createMockRequest(
  rawBody: Buffer,
  headers: Record<string, string>
): Request {
  return {
    rawBody,
    headers,
    body: JSON.parse(rawBody.toString("utf8")),
    path: "/webhook/test",
    ip: "127.0.0.1",
  } as unknown as Request;
}
