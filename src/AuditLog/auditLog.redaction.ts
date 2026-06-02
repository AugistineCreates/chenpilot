/**
 * auditLog.redaction.ts
 *
 * Privacy Discipline layer (Issue #344):
 *   - Pattern-based PII / secret detection (regex)
 *   - Entropy-based secret detection (Shannon entropy)
 *   - Deep-object recursive scrubbing
 *   - String-value scanning for embedded tokens / emails / credit-cards
 *
 * Used both as a standalone scrubber (service layer) and as Express middleware
 * that sanitises request bodies before they are captured by the audit pipeline.
 */

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

// ─── Sensitive Key Names ──────────────────────────────────────────────────────

/**
 * Keys whose values are always redacted, regardless of content.
 * Checked case-insensitively.
 */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  "password",
  "passwd",
  "pass",
  "secret",
  "api_key",
  "apikey",
  "api-key",
  "access_key",
  "accesskey",
  "access-key",
  "private_key",
  "privatekey",
  "private-key",
  "pk",
  "token",
  "auth_token",
  "authtoken",
  "bearer",
  "authorization",
  "x-api-key",
  "x_api_key",
  "refresh_token",
  "refreshtoken",
  "client_secret",
  "clientsecret",
  "webhook_secret",
  "signing_key",
  "signingkey",
  "encryption_key",
  "ssn",
  "social_security",
  "credit_card",
  "creditcard",
  "card_number",
  "cvv",
  "cvc",
  "pin",
]);

// ─── String-Value Patterns ────────────────────────────────────────────────────

interface PatternRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

const STRING_PATTERNS: PatternRule[] = [
  // JWT tokens
  {
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\b/g,
    replacement: "[REDACTED:JWT]",
  },
  // Bearer tokens in header values
  {
    name: "bearer",
    pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
    replacement: "[REDACTED:BEARER]",
  },
  // Email addresses (PII)
  {
    name: "email",
    pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
    replacement: "[REDACTED:EMAIL]",
  },
  // Credit card numbers (13–19 digits, optional separators)
  {
    name: "credit_card",
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    replacement: "[REDACTED:CC]",
  },
  // US SSN
  {
    name: "ssn",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[REDACTED:SSN]",
  },
  // Generic API keys / secrets (hex or base64, 32+ chars)
  {
    name: "generic_secret",
    pattern: /\b[A-Za-z0-9+/]{32,}={0,2}\b/g,
    replacement: (match: string) =>
      shannonEntropy(match) > ENTROPY_THRESHOLD
        ? "[REDACTED:SECRET]"
        : match,
  } as unknown as PatternRule, // typed below via overload
  // AWS-style access keys
  {
    name: "aws_key",
    pattern: /\b(AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g,
    replacement: "[REDACTED:AWS_KEY]",
  },
  // Private key PEM blocks
  {
    name: "pem",
    pattern: /-----BEGIN [A-Z ]+KEY-----[\s\S]+?-----END [A-Z ]+KEY-----/g,
    replacement: "[REDACTED:PEM_KEY]",
  },
];

// ─── Entropy Analysis ─────────────────────────────────────────────────────────

/** Bits of entropy above which a string-value is considered secret-like */
const ENTROPY_THRESHOLD = 4.5;

/**
 * Compute Shannon entropy (bits per character) of a string.
 * High-entropy strings are characteristic of secrets / tokens.
 */
export function shannonEntropy(str: string): number {
  if (!str || str.length === 0) return 0;
  const freq: Record<string, number> = {};
  for (const ch of str) {
    freq[ch] = (freq[ch] ?? 0) + 1;
  }
  const len = str.length;
  return Object.values(freq).reduce((acc, count) => {
    const p = count / len;
    return acc - p * Math.log2(p);
  }, 0);
}

// ─── Core Scrubber ────────────────────────────────────────────────────────────

/** Sentinel value written into redacted fields */
export const REDACTED_SENTINEL = "[REDACTED]";

/**
 * Scrub a raw string value against all pattern rules.
 * High-entropy strings are replaced wholesale.
 */
export function scrubString(value: string): string {
  if (typeof value !== "string") return value;

  // Wholesale replacement for obviously high-entropy short strings
  // (e.g. raw API keys stored as a single field value)
  if (value.length >= 20 && shannonEntropy(value) > ENTROPY_THRESHOLD) {
    return REDACTED_SENTINEL;
  }

  let result = value;
  for (const rule of STRING_PATTERNS) {
    if (typeof rule.replacement === "string") {
      result = result.replace(rule.pattern, rule.replacement);
    } else {
      // replacement is a function (generic_secret pattern)
      result = result.replace(rule.pattern, rule.replacement as never);
    }
  }
  return result;
}

/**
 * Recursively redact sensitive data from any value.
 *
 * Rules applied in order:
 *   1. Key-name denylist — entire value replaced with `[REDACTED]`
 *   2. String-value scan — patterns + entropy analysis
 *   3. Recurse into objects / arrays
 */
export function redactPayload(
  value: unknown,
  parentKey?: string
): unknown {
  if (value === null || value === undefined) return value;

  // Key-name denylist check
  if (
    parentKey !== undefined &&
    SENSITIVE_KEYS.has(parentKey.toLowerCase())
  ) {
    return REDACTED_SENTINEL;
  }

  if (typeof value === "string") {
    return scrubString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactPayload(item));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(
      value as Record<string, unknown>
    )) {
      out[key] = SENSITIVE_KEYS.has(key.toLowerCase())
        ? REDACTED_SENTINEL
        : redactPayload(val, key);
    }
    return out;
  }

  return value;
}

// ─── Correlation ID Utilities ─────────────────────────────────────────────────

export const CORRELATION_ID_HEADER = "x-correlation-id";
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Generate a cryptographically random correlation ID.
 */
export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * Extract or mint a correlation ID from an incoming HTTP request.
 * Checks both `x-correlation-id` and `x-request-id` headers.
 */
export function extractCorrelationId(req: Request): string {
  return (
    (req.headers[CORRELATION_ID_HEADER] as string | undefined)?.trim() ||
    (req.headers[REQUEST_ID_HEADER] as string | undefined)?.trim() ||
    generateCorrelationId()
  );
}

// ─── Express Middleware ───────────────────────────────────────────────────────

/**
 * Express middleware that:
 *   1. Mints / propagates a `x-correlation-id` on every request.
 *   2. Attaches the ID to `req.correlationId` for downstream use.
 *   3. Reflects it back in the response headers.
 */
export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const correlationId = extractCorrelationId(req);
  (req as Request & { correlationId: string }).correlationId = correlationId;
  res.setHeader(CORRELATION_ID_HEADER, correlationId);
  next();
}

/**
 * Express middleware that scrubs the request body in-place before any
 * audit-log middleware can capture it, ensuring PII never reaches storage.
 *
 * Applied globally in `src/index.ts` — BEFORE all route handlers.
 */
export function piiRedactionMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (req.body && typeof req.body === "object") {
    req.body = redactPayload(req.body) as Record<string, unknown>;
  }
  next();
}
