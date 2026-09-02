/**
 * ISOLATED UNIT TESTS
 * These tests do NOT import from src/config (which requires JWT_SECRET setup)
 * Tests are self-contained and focus on formatter logic
 */

import {
  formatAmount,
  formatAddress,
  formatIssuer,
  formatPercentage,
  formatTransactionHash,
  detectHomoglyphs,
  validateForFinancialDisplay,
  stripFormatting,
  generateAddressChecksum,
  formatAddressWithChecksum,
} from "../SecuritySensitiveFormatter";

describe("SecuritySensitiveFormatter - Unit Tests", () => {
  describe("formatAmount - Basic Formatting", () => {
    it("should format simple amounts with correct decimal separator", () => {
      const result = formatAmount("100.50");
      expect(result).toContain("100.50");
    });

    it("should use thin non-breaking space for grouping (large numbers)", () => {
      const result = formatAmount("1234567.89");
      // Contains thin NBSP (U+202F) for grouping
      expect(result).toContain("\u202F");
    });

    it("should preserve decimal separator as dot (U+002E)", () => {
      const result = formatAmount("123.456789");
      expect(result).toMatch(/\d+\.\u200B\d+/); // dot + zero-width space pattern
    });

    it("should handle very small amounts", () => {
      const result = formatAmount("0.00000001");
      expect(result).toContain("0.00000001");
    });

    it("should handle zero", () => {
      const result = formatAmount("0", { trailingZeros: true, maxDecimals: 2 });
      expect(result).toContain("0.00");
    });

    it("should respect maxDecimals option", () => {
      const result = formatAmount("123.456789", { maxDecimals: 2 });
      expect(result).toContain(".46"); // Rounded to 2 decimals
    });

    it("should strip trailing zeros when requested", () => {
      const result = formatAmount("100.00", {
        trailingZeros: false,
        maxDecimals: 2,
      });
      expect(result).not.toContain("00");
    });

    it("should append currency code", () => {
      const result = formatAmount("100.50", { currencyCode: "USDC" });
      expect(result).toContain("USDC");
    });

    it("should NOT group small amounts (< 1,000,000)", () => {
      const result = formatAmount("123456");
      expect(result).not.toContain("\u202F");
    });

    it("should group large amounts correctly", () => {
      const result = formatAmount("1234567890.12");
      // Large amounts should have grouping
      expect((result.match(/\u202F/g) || []).length).toBeGreaterThan(0);
    });

    it("should throw on negative amounts", () => {
      expect(() => formatAmount("-100")).toThrow();
    });

    it("should throw on non-finite values", () => {
      expect(() => formatAmount(Infinity)).toThrow();
      expect(() => formatAmount(NaN)).toThrow();
    });
  });

  describe("formatAmount - Stellar Asset Specific", () => {
    it("should format Stellar amount (7 decimals) correctly", () => {
      const result = formatAmount("100.1234567", {
        maxDecimals: 7,
        currencyCode: "XLM",
      });
      expect(result).toContain("100.1234567");
      expect(result).toContain("XLM");
    });

    it("should handle Stellar stroops (smallest unit)", () => {
      const result = formatAmount("0.0000001", {
        maxDecimals: 7,
        currencyCode: "XLM",
      });
      expect(result).toContain("0.0000001");
    });

    it("should handle large Stellar amounts with grouping", () => {
      const result = formatAmount("1000000.0000000", {
        maxDecimals: 7,
        currencyCode: "XLM",
      });
      expect(result).toContain("\u202F"); // Grouping for 1+ million
      expect(result).toContain("XLM");
    });
  });

  describe("detectHomoglyphs - Unicode Confusables", () => {
    it("should detect Cyrillic 'a' (U+0430) in Latin string", () => {
      const result = detectHomoglyphs("abc\u0430def");
      expect(result.hasHomoglyphs).toBe(true);
      expect(result.suspiciousChars.length).toBeGreaterThan(0);
    });

    it("should detect Cyrillic 'o' (U+043E) in Latin string", () => {
      const result = detectHomoglyphs("abc\u043Edef");
      expect(result.hasHomoglyphs).toBe(true);
    });

    it("should not flag pure Latin strings", () => {
      const result = detectHomoglyphs("abcdef0123456789");
      expect(result.hasHomoglyphs).toBe(false);
    });

    it("should not flag pure Cyrillic strings", () => {
      // Pure Cyrillic (not mixed Latin)
      const result = detectHomoglyphs("\u0430\u0431\u0432");
      expect(result.hasHomoglyphs).toBe(false);
    });

    it("should rate severity by count", () => {
      const singleResult = detectHomoglyphs("abc\u0430def");
      expect(singleResult.severity).toBe("medium");

      const multipleResult = detectHomoglyphs("abc\u0430d\u043Eef\u0441xyz");
      expect(multipleResult.severity).toBe("high");
    });

    it("should provide recommendations", () => {
      const result = detectHomoglyphs("abc\u0430def");
      expect(result.recommendation).toContain("WARNING");
    });
  });

  describe("formatAddress - RTL Safety", () => {
    it("should apply BiDi isolate marks", () => {
      const result = formatAddress("0x1234567890abcdef");
      // Contains BiDi First Strong Isolate (U+2068) and Pop (U+2069)
      expect(result).toContain("\u2068");
      expect(result).toContain("\u2069");
    });

    it("should chunk address for readability", () => {
      const result = formatAddress("0x1234567890abcdef", { chunkSize: 4 });
      expect(result).toContain("1234");
      expect(result).toContain("5678");
    });

    it("should not chunk when chunkSize is 0", () => {
      const result = formatAddress("0x1234567890abcdef", { chunkSize: 0 });
      // Should still have BiDi marks but no spaces from chunking
      expect(result).toContain("0x1234567890abcdef");
    });

    it("should detect homoglyphs in addresses", () => {
      const addressWithGlyph = "0x123\u0430bcdef";
      const result = formatAddress(addressWithGlyph);
      expect(result).toContain("WARNING");
    });

    it("should not show warning when homoglyph detection is disabled", () => {
      const addressWithGlyph = "0x123\u0430bcdef";
      const result = formatAddress(addressWithGlyph, {
        detectHomoglyphs: false,
      });
      expect(result).not.toContain("WARNING");
    });

    it("should disable BiDi marks when not needed", () => {
      const result = formatAddress("0x1234567890abcdef", { enableBiDi: false });
      expect(result).not.toContain("\u2068");
      expect(result).not.toContain("\u2069");
    });

    it("should throw on empty address", () => {
      expect(() => formatAddress("")).toThrow();
      expect(() => formatAddress("   ")).toThrow();
    });
  });

  describe("formatIssuer - Issuer-Specific Formatting", () => {
    it("should format Stellar public key issuer", () => {
      const stellarIssuer =
        "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIAMRNZOQMOS2R7XOFYDXMWAVX";
      const result = formatIssuer(stellarIssuer, "stellar_pubkey");
      expect(result).toContain("GBUQWP3B");
    });

    it("should format Ethereum address issuer", () => {
      const ethIssuer = "0x1234567890123456789012345678901234567890";
      const result = formatIssuer(ethIssuer, "ethereum_address");
      expect(result).toContain("0x1234");
    });

    it("should use larger chunk size for issuers (readability)", () => {
      const issuer = "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIAMRNZOQMOS2R7XOFYDXMWAVX";
      const result = formatIssuer(issuer, "stellar_pubkey");
      // Default chunk size for issuers is 8
      const chunks = result.split(" ");
      expect(chunks[0].length).toBeLessThanOrEqual(8);
    });

    it("should always detect homoglyphs for issuers", () => {
      const issuerWithGlyph =
        "GBUQWP3BOUZ\u043034ULNQG23RQ6F4BVWCIAMRNZOQMOS2R7XOFYDXMWAVX";
      const result = formatIssuer(issuerWithGlyph, "stellar_pubkey");
      expect(result).toContain("WARNING");
    });
  });

  describe("formatPercentage - Risk/Fee Display", () => {
    it("should format percentage correctly", () => {
      const result = formatPercentage(0.0234);
      expect(result).toContain("2.34%");
    });

    it("should use 2 decimal places by default", () => {
      const result = formatPercentage(0.12345);
      expect(result).toContain("12.35%"); // Rounded
    });

    it("should respect custom decimal places", () => {
      const result = formatPercentage(0.12345, 3);
      expect(result).toContain("12.345%");
    });

    it("should format small percentages", () => {
      const result = formatPercentage(0.00015);
      expect(result).toContain("0.02%"); // Rounds up
    });

    it("should format risk percentages (0.5 = 50%)", () => {
      const result = formatPercentage(0.5);
      expect(result).toContain("50.00%");
    });

    it("should apply BiDi marks for safety", () => {
      const result = formatPercentage(0.5);
      expect(result).toContain("\u2068");
      expect(result).toContain("\u2069");
    });

    it("should throw on invalid values", () => {
      expect(() => formatPercentage(Infinity)).toThrow();
      expect(() => formatPercentage(NaN)).toThrow();
    });
  });

  describe("formatTransactionHash - Hash Display", () => {
    it("should chunk transaction hash", () => {
      const hash =
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
      const result = formatTransactionHash(hash);
      expect(result).toContain("0x");
      expect(result).toContain(" ");
    });

    it("should never truncate hash (full display)", () => {
      const hash =
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
      const result = formatTransactionHash(hash);
      const stripped = stripFormatting(result);
      expect(stripped).toBe(hash);
    });

    it("should apply BiDi marks", () => {
      const hash = "0x123456";
      const result = formatTransactionHash(hash);
      expect(result).toContain("\u2068");
      expect(result).toContain("\u2069");
    });

    it("should handle non-0x prefixed hashes", () => {
      const hash = "123456789abcdef";
      const result = formatTransactionHash(hash);
      expect(result).toContain("1234");
    });

    it("should throw on empty hash", () => {
      expect(() => formatTransactionHash("")).toThrow();
    });
  });

  describe("validateForFinancialDisplay - Safety Checks", () => {
    it("should flag RTL override (U+202E)", () => {
      const text = "abc\u202Edef";
      const result = validateForFinancialDisplay(text);
      expect(result.isValid).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("should flag LTR override (U+202D)", () => {
      const text = "abc\u202Ddef";
      const result = validateForFinancialDisplay(text);
      expect(result.isValid).toBe(false);
    });

    it("should flag excessive invisible characters", () => {
      const text = "abc\u200B\u200C\u200D\u200E\u200F\u202A\u202Bdef";
      const result = validateForFinancialDisplay(text);
      expect(result.isValid).toBe(false);
      expect(result.warnings.some((w) => w.includes("invisible"))).toBe(true);
    });

    it("should flag homoglyphs", () => {
      const text = "abc\u0430def";
      const result = validateForFinancialDisplay(text);
      expect(result.isValid).toBe(false);
    });

    it("should validate clean strings as safe", () => {
      const result = validateForFinancialDisplay("0x1234567890abcdef");
      expect(result.isValid).toBe(true);
      expect(result.warnings.length).toBe(0);
    });
  });

  describe("stripFormatting - Clipboard Operations", () => {
    it("should remove BiDi marks", () => {
      const formatted = "\u20681234\u2069";
      const result = stripFormatting(formatted);
      expect(result).toBe("1234");
    });

    it("should remove zero-width spaces", () => {
      const formatted = "1234\u200B5678";
      const result = stripFormatting(formatted);
      expect(result).toBe("12345678");
    });

    it("should remove thin non-breaking space grouping", () => {
      const formatted = "1\u202F234\u202F567";
      const result = stripFormatting(formatted);
      expect(result).toBe("1234567");
    });

    it("should strip currency codes", () => {
      const formatted = "1234.56\u00A0USDC";
      const result = stripFormatting(formatted);
      expect(result).not.toContain("USDC");
    });

    it("should strip homoglyph warnings", () => {
      const formatted = "0x1234abc\n⚠️ WARNING: ...";
      const result = stripFormatting(formatted);
      expect(result).not.toContain("WARNING");
    });

    it("should allow copy-paste of stripped result", () => {
      const original = "0x1234567890abcdef";
      const formatted = formatAddress(original);
      const stripped = stripFormatting(formatted);
      expect(stripped.toLowerCase()).toContain("0x1234567890abcdef");
    });
  });

  describe("Checksum - Address Verification", () => {
    it("should generate consistent checksums", () => {
      const address = "0x1234567890abcdef";
      const checksum1 = generateAddressChecksum(address);
      const checksum2 = generateAddressChecksum(address);
      expect(checksum1).toBe(checksum2);
    });

    it("should generate different checksums for different addresses", () => {
      const checksum1 = generateAddressChecksum("0x1234567890abcdef");
      const checksum2 = generateAddressChecksum("0x9876543210fedcba");
      expect(checksum1).not.toBe(checksum2);
    });

    it("should format address with checksum", () => {
      const result = formatAddressWithChecksum("0x1234567890abcdef");
      expect(result).toContain("[");
      expect(result).toContain("]");
      expect(result).toMatch(/\[[A-F0-9]{4}\]/);
    });
  });

  describe("RTL Locale Scenarios", () => {
    it("should prevent RTL hijacking of address display", () => {
      const result = formatAddress("0x1234567890abcdef");
      expect(result).toContain("\u2068");
      expect(result).toContain("\u2069");
    });

    it("should display address correctly even with surrounding text", () => {
      const address = "0x1234567890abcdef";
      const formatted = formatAddress(address);
      const stripped = stripFormatting(formatted);
      expect(stripped.toLowerCase()).toContain("0x1234567890abcdef");
    });

    it("should handle Hebrew percentage display", () => {
      const percentage = formatPercentage(0.25); // 25%
      expect(percentage).toContain("25.00%");
    });

    it("should isolate transaction hash in RTL context", () => {
      const hash = "0x123456";
      const result = formatTransactionHash(hash);
      expect(result).toContain("\u2068");
      expect(result).toContain("\u2069");
    });
  });

  describe("Narrow Screen Rendering (No Truncation)", () => {
    it("should not truncate addresses even on narrow screens", () => {
      const address =
        "0x1234567890abcdef1234567890abcdef12345678";
      const formatted = formatAddress(address);
      const stripped = stripFormatting(formatted);
      // Full address should be present
      expect(stripped.toLowerCase()).toContain(
        "0x1234567890abcdef1234567890abcdef12345678"
      );
    });

    it("should not truncate transaction hashes on narrow screens", () => {
      const hash =
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
      const formatted = formatTransactionHash(hash);
      const stripped = stripFormatting(formatted);
      expect(stripped.toLowerCase()).toBe(hash.toLowerCase());
    });

    it("should maintain readability with chunking on narrow screens", () => {
      const address = "0x1234567890abcdef1234567890abcdef12345678";
      const formatted = formatAddress(address, { chunkSize: 4 });
      // Should have spaces for breaking, not ellipsis
      expect(formatted).not.toContain("...");
      expect(formatted).toContain(" ");
    });

    it("should not use ellipsis for amounts", () => {
      const amount = formatAmount("1234567890.123456789");
      expect(amount).not.toContain("...");
      // Full amount should be present
      expect(amount).toContain("123456789");
    });
  });

  describe("Edge Cases & Error Handling", () => {
    it("should handle whitespace-only inputs", () => {
      expect(() => formatAddress("   ")).toThrow();
      expect(() => formatTransactionHash("   ")).toThrow();
    });

    it("should handle very long addresses", () => {
      const longAddress = "0x" + "a".repeat(1000);
      expect(() => formatAddress(longAddress)).not.toThrow();
    });

    it("should handle mixed case addresses", () => {
      const mixed = "0x1234AbCd5678eF90";
      const result = formatAddress(mixed);
      expect(stripFormatting(result).toLowerCase()).toContain(
        "0x1234abcd5678ef90"
      );
    });

    it("should handle amounts with no decimals", () => {
      const result = formatAmount("1000");
      expect(result).toContain("1000");
    });

    it("should handle extremely small amounts", () => {
      const result = formatAmount("0.0000000001", { maxDecimals: 10 });
      expect(result).toContain("0.0000000001");
    });

    it("should handle zero amount", () => {
      expect(() => formatAmount("0")).not.toThrow();
    });

    it("should handle string vs number inputs consistently", () => {
      const result1 = formatAmount("123.45");
      const result2 = formatAmount(123.45);
      expect(stripFormatting(result1)).toBe(stripFormatting(result2));
    });
  });
});
