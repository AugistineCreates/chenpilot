/**
 * auditLog.redaction.test.ts
 *
 * Unit tests for the Privacy Discipline layer (Issue #344)
 *
 * Covers:
 *   - shannonEntropy
 *   - scrubString  — pattern-based + entropy-based detection
 *   - redactPayload — key-name denylist, nested objects, arrays
 *   - generateCorrelationId / extractCorrelationId
 *   - correlationIdMiddleware
 *   - piiRedactionMiddleware
 */

import {
  shannonEntropy,
  scrubString,
  redactPayload,
  generateCorrelationId,
  extractCorrelationId,
  correlationIdMiddleware,
  piiRedactionMiddleware,
  REDACTED_SENTINEL,
  CORRELATION_ID_HEADER,
} from "../../../src/AuditLog/auditLog.redaction";
import type { Request, Response } from "express";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    body: {},
    socket: {},
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response & { _headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    _headers: headers,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  } as unknown as Response & { _headers: Record<string, string> };
}

// ─── shannonEntropy ───────────────────────────────────────────────────────────

describe("shannonEntropy", () => {
  it("returns 0 for empty string", () => {
    expect(shannonEntropy("")).toBe(0);
  });

  it("returns 0 for single-character string", () => {
    expect(shannonEntropy("aaaa")).toBeCloseTo(0, 5);
  });

  it("returns high entropy for random-looking strings", () => {
    // SHA-256 hex output is uniformly distributed
    const hexHash = "a3f1b2e9c4d507f8012345abcdef6789aabbccdd1234567890abcdef01234567";
    expect(shannonEntropy(hexHash)).toBeGreaterThan(3.5);
  });

  it("returns low entropy for repetitive strings", () => {
    expect(shannonEntropy("aaaaaaaaaaaaaaaa")).toBeLessThan(1);
  });
});

// ─── scrubString ──────────────────────────────────────────────────────────────

describe("scrubString", () => {
  it("redacts email addresses", () => {
    const result = scrubString("Contact alice@example.com for details");
    expect(result).not.toContain("alice@example.com");
    expect(result).toContain("[REDACTED:EMAIL]");
  });

  it("redacts JWT tokens embedded in strings", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const result = scrubString(`Bearer token: ${jwt}`);
    expect(result).not.toContain(jwt);
  });

  it("redacts Bearer tokens", () => {
    const result = scrubString("Authorization: Bearer super-secret-token-value-here");
    expect(result).toContain("[REDACTED:BEARER]");
  });

  it("redacts AWS access keys", () => {
    const result = scrubString("Key: AKIAIOSFODNN7EXAMPLE");
    expect(result).toContain("[REDACTED:AWS_KEY]");
  });

  it("redacts PEM private keys", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";
    const result = scrubString(pem);
    expect(result).toContain("[REDACTED:PEM_KEY]");
  });

  it("does not redact innocent low-entropy strings", () => {
    const safe = "hello world this is a normal message";
    expect(scrubString(safe)).toBe(safe);
  });

  it("replaces high-entropy string values wholesale with REDACTED sentinel", () => {
    // A random-looking base64 secret longer than 20 chars with high entropy
    const secret = "Xy9kL2mNpQrStUvWxYzAbCdEfGh=";
    const result = scrubString(secret);
    expect(result).toBe(REDACTED_SENTINEL);
  });
});

// ─── redactPayload ────────────────────────────────────────────────────────────

describe("redactPayload", () => {
  it("redacts top-level sensitive key names", () => {
    const result = redactPayload({ password: "s3cr3t", username: "alice" });
    expect((result as Record<string, unknown>).password).toBe(REDACTED_SENTINEL);
    expect((result as Record<string, unknown>).username).toBe("alice");
  });

  it("redacts nested sensitive keys", () => {
    const payload = { user: { token: "abc123", name: "Bob" } };
    const result = redactPayload(payload) as { user: Record<string, unknown> };
    expect(result.user.token).toBe(REDACTED_SENTINEL);
    expect(result.user.name).toBe("Bob");
  });

  it("redacts inside arrays", () => {
    const payload = [{ api_key: "supersecret" }, { value: "safe" }];
    const result = redactPayload(payload) as Array<Record<string, unknown>>;
    expect(result[0].api_key).toBe(REDACTED_SENTINEL);
    expect(result[1].value).toBe("safe");
  });

  it("redacts email in string values", () => {
    const payload = { message: "email me at hacker@evil.com please" };
    const result = redactPayload(payload) as Record<string, unknown>;
    expect(result.message as string).not.toContain("hacker@evil.com");
  });

  it("passes through null and undefined", () => {
    expect(redactPayload(null)).toBeNull();
    expect(redactPayload(undefined)).toBeUndefined();
  });

  it("passes through numeric values unchanged", () => {
    const payload = { amount: 1000, count: 42 };
    const result = redactPayload(payload) as Record<string, unknown>;
    expect(result.amount).toBe(1000);
  });

  it("handles authorization header key", () => {
    const payload = { authorization: "Bearer some-token-here" };
    const result = redactPayload(payload) as Record<string, unknown>;
    expect(result.authorization).toBe(REDACTED_SENTINEL);
  });

  it("handles private_key key", () => {
    const payload = { private_key: "-----BEGIN EC PRIVATE KEY-----..." };
    const result = redactPayload(payload) as Record<string, unknown>;
    expect(result.private_key).toBe(REDACTED_SENTINEL);
  });
});

// ─── generateCorrelationId ────────────────────────────────────────────────────

describe("generateCorrelationId", () => {
  it("returns a valid UUID v4 format string", () => {
    const id = generateCorrelationId();
    const uuidV4Regex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuidV4Regex.test(id)).toBe(true);
  });

  it("generates unique IDs on each call", () => {
    const ids = new Set(Array.from({ length: 20 }, generateCorrelationId));
    expect(ids.size).toBe(20);
  });
});

// ─── extractCorrelationId ─────────────────────────────────────────────────────

describe("extractCorrelationId", () => {
  it("reads x-correlation-id header when present", () => {
    const req = mockReq({
      headers: { "x-correlation-id": "test-corr-id-123" },
    });
    expect(extractCorrelationId(req)).toBe("test-corr-id-123");
  });

  it("falls back to x-request-id header", () => {
    const req = mockReq({ headers: { "x-request-id": "req-id-456" } });
    expect(extractCorrelationId(req)).toBe("req-id-456");
  });

  it("generates a new UUID when no header is present", () => {
    const req = mockReq({ headers: {} });
    const id = extractCorrelationId(req);
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });
});

// ─── correlationIdMiddleware ──────────────────────────────────────────────────

describe("correlationIdMiddleware", () => {
  it("attaches correlationId to req and sets response header", () => {
    const req = mockReq({
      headers: { "x-correlation-id": "propagated-id" },
    });
    const res = mockRes();
    const next = jest.fn();

    correlationIdMiddleware(req, res as Response, next);

    expect((req as Request & { correlationId: string }).correlationId).toBe(
      "propagated-id"
    );
    expect(res._headers[CORRELATION_ID_HEADER]).toBe("propagated-id");
    expect(next).toHaveBeenCalled();
  });

  it("mints a new ID when no header is present", () => {
    const req = mockReq({ headers: {} });
    const res = mockRes();
    const next = jest.fn();

    correlationIdMiddleware(req, res as Response, next);

    const assigned = (req as Request & { correlationId: string }).correlationId;
    expect(typeof assigned).toBe("string");
    expect(assigned.length).toBeGreaterThan(0);
    expect(res._headers[CORRELATION_ID_HEADER]).toBe(assigned);
  });
});

// ─── piiRedactionMiddleware ───────────────────────────────────────────────────

describe("piiRedactionMiddleware", () => {
  it("scrubs sensitive keys from req.body in-place", () => {
    const req = mockReq({
      body: { password: "p@ss", username: "alice", amount: 50 },
    });
    const next = jest.fn();

    piiRedactionMiddleware(req, {} as Response, next);

    expect(req.body.password).toBe(REDACTED_SENTINEL);
    expect(req.body.username).toBe("alice");
    expect(req.body.amount).toBe(50);
    expect(next).toHaveBeenCalled();
  });

  it("handles requests with no body gracefully", () => {
    const req = mockReq({ body: undefined });
    const next = jest.fn();
    expect(() =>
      piiRedactionMiddleware(req, {} as Response, next)
    ).not.toThrow();
    expect(next).toHaveBeenCalled();
  });
});
