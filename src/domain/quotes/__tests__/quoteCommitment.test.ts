// chenpilot/src/domain/quotes/__tests__/quoteCommitment.test.ts
// Issue #625 — Comprehensive test suite for the quote commitment system.

import {
  QuoteCommitmentPayload,
  generateQuoteDigest,
  verifyQuoteDigest,
  validateQuoteCommitment,
} from "../quoteCommitment";
import { QuoteDriftError, QuoteExpiredError } from "../errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A valid baseline payload — all tests derive from this. */
function makePayload(
  overrides: Partial<QuoteCommitmentPayload> = {}
): QuoteCommitmentPayload {
  return {
    fromAsset: "XLM",
    toAsset: "USDC",
    fromAmount: "100.0000000",
    toAmount: "12.3456789",
    route: ["XLM", "USDC"],
    fees: "0.0000100",
    deadline: Math.floor(Date.now() / 1000) + 60, // 60 s in the future
    network: "Test SDF Network ; September 2015",
    slippage: 1.0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Happy Path
// ---------------------------------------------------------------------------

describe("Happy Path", () => {
  it("generates a 64-char hex SHA-256 digest", () => {
    const digest = generateQuoteDigest(makePayload());
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same digest for identical payloads", () => {
    const payload = makePayload();
    const digest1 = generateQuoteDigest(payload);
    const digest2 = generateQuoteDigest(payload);
    expect(digest1).toBe(digest2);
  });

  it("verifyQuoteDigest returns true for matching digest", () => {
    const payload = makePayload();
    const digest = generateQuoteDigest(payload);
    expect(verifyQuoteDigest(digest, payload)).toBe(true);
  });

  it("validateQuoteCommitment succeeds when digests match and deadline is future", () => {
    const payload = makePayload({
      deadline: Math.floor(Date.now() / 1000) + 120,
    });
    const digest = generateQuoteDigest(payload);
    // Should not throw
    expect(() => validateQuoteCommitment(digest, payload)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. Canonical Key Ordering Invariance
// ---------------------------------------------------------------------------

describe("Canonical Key Ordering Invariance", () => {
  it("produces identical digests regardless of property insertion order", () => {
    // Payload A — fields inserted in alphabetical order
    const payloadA: QuoteCommitmentPayload = {
      deadline: Math.floor(Date.now() / 1000) + 60,
      fees: "0.0000100",
      fromAmount: "100.0000000",
      fromAsset: "XLM",
      network: "Test SDF Network ; September 2015",
      route: ["XLM", "USDC"],
      slippage: 1.0,
      toAmount: "12.3456789",
      toAsset: "USDC",
    };

    // Payload B — fields inserted in reverse alphabetical order
    const payloadB: QuoteCommitmentPayload = {
      toAsset: "USDC",
      toAmount: "12.3456789",
      slippage: 1.0,
      route: ["XLM", "USDC"],
      network: "Test SDF Network ; September 2015",
      fromAsset: "XLM",
      fromAmount: "100.0000000",
      fees: "0.0000100",
      deadline: payloadA.deadline,
    };

    expect(generateQuoteDigest(payloadA)).toBe(generateQuoteDigest(payloadB));
  });

  it("produces identical digests with scrambled key order", () => {
    const deadline = Math.floor(Date.now() / 1000) + 60;

    // Completely random insertion order
    const payloadC: QuoteCommitmentPayload = {
      route: ["XLM", "USDC"],
      fromAsset: "XLM",
      slippage: 1.0,
      deadline,
      toAmount: "12.3456789",
      network: "Test SDF Network ; September 2015",
      fees: "0.0000100",
      toAsset: "USDC",
      fromAmount: "100.0000000",
    };

    const reference = makePayload({ deadline });
    expect(generateQuoteDigest(payloadC)).toBe(generateQuoteDigest(reference));
  });
});

// ---------------------------------------------------------------------------
// 3. Mutated-Field Tests (Fail-Closed Verification)
// ---------------------------------------------------------------------------

describe("Mutated-Field Tests — Fail-Closed", () => {
  const basePayload = makePayload({
    deadline: Math.floor(Date.now() / 1000) + 300,
  });
  const approvedDigest = generateQuoteDigest(basePayload);

  // For each mutated field: assert digest differs AND validateQuoteCommitment throws QuoteDriftError.

  it("detects fromAsset mutation", () => {
    const mutated = makePayload({ ...basePayload, fromAsset: "USDT" });
    expect(generateQuoteDigest(mutated)).not.toBe(approvedDigest);
    expect(() => validateQuoteCommitment(approvedDigest, mutated)).toThrow(
      QuoteDriftError
    );
  });

  it("detects toAsset mutation", () => {
    const mutated = makePayload({ ...basePayload, toAsset: "USDT" });
    expect(generateQuoteDigest(mutated)).not.toBe(approvedDigest);
    expect(() => validateQuoteCommitment(approvedDigest, mutated)).toThrow(
      QuoteDriftError
    );
  });

  it("detects fromAmount mutation", () => {
    const mutated = makePayload({ ...basePayload, fromAmount: "100.0000001" });
    expect(generateQuoteDigest(mutated)).not.toBe(approvedDigest);
    expect(() => validateQuoteCommitment(approvedDigest, mutated)).toThrow(
      QuoteDriftError
    );
  });

  it("detects toAmount mutation", () => {
    const mutated = makePayload({ ...basePayload, toAmount: "12.3456790" });
    expect(generateQuoteDigest(mutated)).not.toBe(approvedDigest);
    expect(() => validateQuoteCommitment(approvedDigest, mutated)).toThrow(
      QuoteDriftError
    );
  });

  it("detects route mutation — swapped hop order", () => {
    const mutated = makePayload({ ...basePayload, route: ["USDC", "XLM"] });
    expect(generateQuoteDigest(mutated)).not.toBe(approvedDigest);
    expect(() => validateQuoteCommitment(approvedDigest, mutated)).toThrow(
      QuoteDriftError
    );
  });

  it("detects route mutation — extra hop added", () => {
    const mutated = makePayload({
      ...basePayload,
      route: ["XLM", "USDT", "USDC"],
    });
    expect(generateQuoteDigest(mutated)).not.toBe(approvedDigest);
    expect(() => validateQuoteCommitment(approvedDigest, mutated)).toThrow(
      QuoteDriftError
    );
  });

  it("detects fees mutation (0.01 delta)", () => {
    const mutated = makePayload({ ...basePayload, fees: "0.0100100" });
    expect(generateQuoteDigest(mutated)).not.toBe(approvedDigest);
    expect(() => validateQuoteCommitment(approvedDigest, mutated)).toThrow(
      QuoteDriftError
    );
  });

  it("detects slippage mutation (0.5% → 1.0%)", () => {
    // Base has slippage 1.0; create a new base with 0.5 to flip it
    const base05 = makePayload({ ...basePayload, slippage: 0.5 });
    const digest05 = generateQuoteDigest(base05);
    const mutated10 = makePayload({
      ...basePayload,
      slippage: 1.0,
      deadline: base05.deadline,
    });
    expect(generateQuoteDigest(mutated10)).not.toBe(digest05);
    expect(() => validateQuoteCommitment(digest05, mutated10)).toThrow(
      QuoteDriftError
    );
  });

  it("detects network mutation", () => {
    const mutated = makePayload({
      ...basePayload,
      network: "Public Global Stellar Network ; September 2015",
    });
    expect(generateQuoteDigest(mutated)).not.toBe(approvedDigest);
    expect(() => validateQuoteCommitment(approvedDigest, mutated)).toThrow(
      QuoteDriftError
    );
  });

  it("QuoteDriftError carries both digests", () => {
    const mutated = makePayload({ ...basePayload, fromAsset: "ETH" });
    try {
      validateQuoteCommitment(approvedDigest, mutated);
      fail("Expected QuoteDriftError");
    } catch (err) {
      expect(err).toBeInstanceOf(QuoteDriftError);
      const drift = err as QuoteDriftError;
      expect(drift.approvedDigest).toBe(approvedDigest);
      expect(drift.liveDigest).toBe(generateQuoteDigest(mutated));
      expect(drift.code).toBe("QUOTE_DRIFT");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Deadline Expiration Test
// ---------------------------------------------------------------------------

describe("Deadline Expiration", () => {
  it("throws QuoteExpiredError when deadline is in the past", () => {
    const expiredPayload = makePayload({
      deadline: Math.floor(Date.now() / 1000) - 10,
    });
    const digest = generateQuoteDigest(expiredPayload);

    expect(() => validateQuoteCommitment(digest, expiredPayload)).toThrow(
      QuoteExpiredError
    );
  });

  it("QuoteExpiredError carries the deadline and expiredAt date", () => {
    const pastDeadline = Math.floor(Date.now() / 1000) - 60;
    const expiredPayload = makePayload({ deadline: pastDeadline });
    const digest = generateQuoteDigest(expiredPayload);

    try {
      validateQuoteCommitment(digest, expiredPayload);
      fail("Expected QuoteExpiredError");
    } catch (err) {
      expect(err).toBeInstanceOf(QuoteExpiredError);
      const expired = err as QuoteExpiredError;
      expect(expired.deadline).toBe(pastDeadline);
      expect(expired.expiredAt).toBeInstanceOf(Date);
      expect(expired.expiredAt.getTime()).toBe(pastDeadline * 1000);
      expect(expired.code).toBe("QUOTE_EXPIRED");
    }
  });

  it("does NOT throw when deadline is in the future", () => {
    const futurePayload = makePayload({
      deadline: Math.floor(Date.now() / 1000) + 3600,
    });
    const digest = generateQuoteDigest(futurePayload);
    expect(() => validateQuoteCommitment(digest, futurePayload)).not.toThrow();
  });

  it("deadline check runs before digest comparison (fast-fail)", () => {
    // Use a wrong digest + expired deadline: should throw QuoteExpiredError, not QuoteDriftError
    const expiredPayload = makePayload({
      deadline: Math.floor(Date.now() / 1000) - 5,
    });
    const wrongDigest = "0".repeat(64);

    expect(() => validateQuoteCommitment(wrongDigest, expiredPayload)).toThrow(
      QuoteExpiredError
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Edge Cases
// ---------------------------------------------------------------------------

describe("Edge Cases", () => {
  it("verifyQuoteDigest returns false for a tampered digest", () => {
    const payload = makePayload();
    const digest = generateQuoteDigest(payload);
    const tampered = digest.replace(digest[0], digest[0] === "a" ? "b" : "a");
    expect(verifyQuoteDigest(tampered, payload)).toBe(false);
  });

  it("empty route array produces a valid digest", () => {
    const payload = makePayload({ route: [] });
    const digest = generateQuoteDigest(payload);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different deadline values produce different digests", () => {
    const now = Math.floor(Date.now() / 1000);
    const d1 = generateQuoteDigest(makePayload({ deadline: now + 30 }));
    const d2 = generateQuoteDigest(makePayload({ deadline: now + 31 }));
    expect(d1).not.toBe(d2);
  });
});
