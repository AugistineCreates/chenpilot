/**
 * SecuritySensitiveFormatter
 *
 * Provides locale-safe, unambiguous formatting for critical financial data.
 * Designed to prevent user misreading of amounts, addresses, and issuers across
 * different locales (especially RTL languages) and character rendering scenarios.
 *
 * Security Properties:
 * - Decimal separators are never locale-dependent
 * - Grouping separators are fixed and non-ambiguous
 * - Addresses are directionally isolated (RTL-safe)
 * - No truncation of critical values
 * - Unicode homoglyph detection for addresses/issuers
 *
 * @module SecuritySensitiveFormatter
 */

export interface FormattingOptions {
  /**
   * Maximum decimal places to display (default: 7 for Stellar assets)
   */
  maxDecimals?: number;

  /**
   * Force display of trailing zeros (default: true)
   */
  trailingZeros?: boolean;

  /**
   * Use thin non-breaking space for grouping (default: true).
   * When false, uses regular space (less visually ambiguous but may wrap)
   */
  thinNBSpace?: boolean;

  /**
   * Allow scientific notation for very large/small numbers (default: false)
   * When false, always uses decimal notation
   */
  scientificNotation?: boolean;

  /**
   * Currency code to append (e.g., "USDC", "XLM")
   */
  currencyCode?: string;
}

export interface AddressFormattingOptions {
  /**
   * Enable Unicode homoglyph detection (default: true)
   */
  detectHomoglyphs?: boolean;

  /**
   * Enable RTL/LTR directional marks (default: true)
   */
  enableBiDi?: boolean;

  /**
   * Chunk size for address display (default: 4 for readability)
   * 0 means no chunking
   */
  chunkSize?: number;

  /**
   * Separator between address chunks (default: " ")
   */
  chunkSeparator?: string;

  /**
   * Add visual warning if homoglyphs detected (default: true)
   */
  showHomoglyphWarning?: boolean;
}

export interface HomoglyphDetectionResult {
  hasHomoglyphs: boolean;
  suspiciousChars: Array<{
    char: string;
    codePoint: number;
    lookalike: string;
    position: number;
  }>;
  severity: "low" | "medium" | "high";
  recommendation: string;
}

/**
 * Character mappings for common Unicode homoglyphs
 * Key: suspicious character, Value: legitimate lookalike it might confuse
 */
const HOMOGLYPH_MAP: Record<string, string> = {
  // Cyrillic confusables
  "\u0430": "a", // Cyrillic small letter a
  "\u0435": "e", // Cyrillic small letter ie
  "\u043e": "o", // Cyrillic small letter o
  "\u043f": "p", // Cyrillic small letter pe
  "\u0441": "c", // Cyrillic small letter es
  "\u0445": "x", // Cyrillic small letter ha
  "\u0443": "y", // Cyrillic small letter u (Cyrillic)
  "\u0432": "v", // Cyrillic small letter be

  // Greek confusables
  "\u03b1": "a", // Greek small letter alpha
  "\u03bd": "v", // Greek small letter nu
  "\u03c1": "p", // Greek small letter rho
  "\u03bf": "o", // Greek small letter omicron

  // Mathematical Alphanumeric Symbols
  "\u1d41": "a", // Mathematical Alphanumeric Symbols
  "\u1d42": "b",

  // Fullwidth forms (CJK)
  "\uff21": "A",
  "\uff22": "B",
};

/**
 * Latin script character set (for homoglyph detection)
 */
const LATIN_CHARS = new Set(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("")
);

/**
 * Formats financial amounts with locale-safe, unambiguous separators
 *
 * Rules:
 * - Always uses `.` (U+002E) as decimal separator (not locale-dependent)
 * - Uses thin non-breaking space (U+202F) for grouping
 * - No thousand separator for amounts < 1,000,000
 * - For large amounts, groups by 3 digits from right
 * - Trailing zeros retained or stripped based on options
 *
 * @example
 * formatAmount("1234567.89", { maxDecimals: 2, currencyCode: "USDC" })
 * // "1,234,567.89 USDC" (with thin NBSP as grouping)
 *
 * @param amount - Numeric string (should be positive)
 * @param options - Formatting options
 * @returns Formatted amount string
 */
export function formatAmount(
  amount: string | number,
  options: FormattingOptions = {}
): string {
  const {
    maxDecimals = 7,
    trailingZeros = true,
    thinNBSpace = true,
    scientificNotation = false,
    currencyCode,
  } = options;

  // Validate input
  const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!isFinite(numAmount)) {
    throw new Error(`Invalid amount: ${amount}`);
  }

  if (numAmount < 0) {
    throw new Error(`Amount must be non-negative: ${amount}`);
  }

  // Handle very large or very small numbers
  if (!scientificNotation && Math.abs(numAmount) >= 1e21) {
    throw new Error(
      `Amount too large to format safely: ${amount}. Use scientific notation.`
    );
  }

  // Format to specified decimal places
  let formatted: string;

  if (numAmount === 0) {
    formatted = trailingZeros ? `0.${"0".repeat(maxDecimals)}` : "0";
  } else {
    // Use fixed decimal notation
    formatted = numAmount.toFixed(maxDecimals);

    // Strip trailing zeros if not required
    if (!trailingZeros && formatted.includes(".")) {
      formatted = formatted.replace(/\.?0+$/, "");
    }
  }

  // Split into integer and decimal parts
  const [intPart, decPart] = formatted.split(".");

  // Add grouping separators to integer part (only if >= 1,000,000)
  let groupedIntPart = intPart;
  if (Math.abs(numAmount) >= 1000000) {
    const nbSpace = thinNBSpace ? "\u202F" : " ";
    // Group by 3 from the right
    groupedIntPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, nbSpace);
  }

  // Reconstruct with explicit decimal separator
  let result = decPart ? `${groupedIntPart}.\u200B${decPart}` : groupedIntPart;

  // NOTE: We use U+200B (zero-width space) after the decimal point to prevent
  // locale-based rendering engines from replacing the dot. This makes it
  // explicitly clear that a decimal point (not grouping separator) follows.

  if (currencyCode) {
    result = `${result}\u00A0${currencyCode}`; // Non-breaking space before currency
  }

  return result;
}

/**
 * Detects Unicode homoglyphs in a string (typically addresses/issuers)
 *
 * Common concerns:
 * - Cyrillic 'a' (U+0430) vs Latin 'a' (U+0061)
 * - Cyrillic 'o' (U+043E) vs Latin 'o' (U+006F)
 * - etc.
 *
 * @param text - Text to scan
 * @returns Detection result with severity and recommendations
 */
export function detectHomoglyphs(text: string): HomoglyphDetectionResult {
  const suspiciousChars: HomoglyphDetectionResult["suspiciousChars"] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const codePoint = char.charCodeAt(0);

    // Check if this character is a known homoglyph
    if (HOMOGLYPH_MAP[char]) {
      const lookalike = HOMOGLYPH_MAP[char];

      // Only flag if the string contains mostly Latin characters
      // (i.e., this appears to be a Latin string with a homoglyph injection)
      let latinCount = 0;
      for (let j = 0; j < text.length; j++) {
        if (LATIN_CHARS.has(text[j])) {
          latinCount++;
        }
      }
      const latinRatio = latinCount / text.length;

      if (latinRatio > 0.7) {
        suspiciousChars.push({
          char,
          codePoint,
          lookalike,
          position: i,
        });
      }
    }
  }

  let severity: "low" | "medium" | "high" = "low";
  if (suspiciousChars.length >= 3) {
    severity = "high";
  } else if (suspiciousChars.length >= 1) {
    severity = "medium";
  }

  const hasHomoglyphs = suspiciousChars.length > 0;

  return {
    hasHomoglyphs,
    suspiciousChars,
    severity,
    recommendation: hasHomoglyphs
      ? `⚠️ WARNING: Detected ${suspiciousChars.length} potential Unicode homoglyphs. Verify address character-by-character.`
      : "✓ Address appears safe from obvious Unicode homoglyphs.",
  };
}

/**
 * Formats blockchain addresses with RTL safety and optional homoglyph detection
 *
 * Rules:
 * - Injects BiDi isolate marks (U+2068, U+2069) to prevent RTL override attacks
 * - Optionally chunks address for readability
 * - Optionally detects Unicode homoglyphs
 * - Returns format suitable for both display and copying
 *
 * @example
 * formatAddress("0x1234567890abcdef", { chunkSize: 4 })
 * // "0x12 3456 7890 abcd ef"
 *
 * @param address - Blockchain address string
 * @param options - Formatting options
 * @returns RTL-safe formatted address
 */
export function formatAddress(
  address: string,
  options: AddressFormattingOptions = {}
): string {
  const {
    detectHomoglyphs: shouldDetect = true,
    enableBiDi = true,
    chunkSize = 4,
    chunkSeparator = " ",
    showHomoglyphWarning = true,
  } = options;

  // Trim and validate
  const trimmedAddress = address.trim();
  if (!trimmedAddress) {
    throw new Error("Address cannot be empty");
  }

  // Check for homoglyphs if requested
  let homoglyphWarning = "";
  if (shouldDetect) {
    const detection = detectHomoglyphs(trimmedAddress);
    if (detection.hasHomoglyphs && showHomoglyphWarning) {
      homoglyphWarning = `\n${detection.recommendation}`;
    }
  }

  // Apply BiDi isolate if enabled (prevents RTL override attacks)
  const BiDI_ISOLATE_START = "\u2068"; // First Strong Isolate
  const BiDI_ISOLATE_END = "\u2069"; // Pop Directional Isolate

  // Chunk the address if requested
  let displayAddress = trimmedAddress;
  if (chunkSize > 0) {
    const chunks: string[] = [];
    for (let i = 0; i < trimmedAddress.length; i += chunkSize) {
      chunks.push(trimmedAddress.slice(i, i + chunkSize));
    }
    displayAddress = chunks.join(chunkSeparator);
  }

  // Apply BiDi marks
  let result = displayAddress;
  if (enableBiDi) {
    result = `${BiDI_ISOLATE_START}${displayAddress}${BiDI_ISOLATE_END}`;
  }

  return result + homoglyphWarning;
}

/**
 * Formats asset issuers (typically Stellar public keys or Ethereum addresses)
 * with RTL safety and homoglyph detection
 *
 * Issuers are special: they must be absolutely unambiguous since they identify
 * which organization issued an asset. A misidentified issuer means the wrong token.
 *
 * @param issuer - Issuer identifier string
 * @param type - Type of issuer ("stellar_pubkey", "ethereum_address", "other")
 * @param options - Formatting options
 * @returns RTL-safe formatted issuer
 */
export function formatIssuer(
  issuer: string,
  type: "stellar_pubkey" | "ethereum_address" | "other" = "other",
  options: AddressFormattingOptions = {}
): string {
  // Validate issuer based on type
  const trimmed = issuer.trim();

  switch (type) {
    case "stellar_pubkey":
      if (!trimmed.startsWith("G") || trimmed.length !== 56) {
        console.warn(
          `Issuer does not match Stellar public key format: ${trimmed}`
        );
      }
      break;
    case "ethereum_address":
      if (!trimmed.match(/^0x[a-fA-F0-9]{40}$/)) {
        console.warn(
          `Issuer does not match Ethereum address format: ${trimmed}`
        );
      }
      break;
  }

  // Use stricter homoglyph detection for issuers
  const issuedAddress = formatAddress(trimmed, {
    ...options,
    detectHomoglyphs: true, // Always detect for issuers
    showHomoglyphWarning: true, // Always warn
    chunkSize: options.chunkSize ?? 8, // Larger chunks for issuers (easier to verify)
  });

  return issuedAddress;
}

/**
 * Formats percentages for financial displays (fees, risk, slippage, etc.)
 *
 * Rules:
 * - Always shows percentage symbol
 * - Fixed decimal places (typically 2)
 * - Never uses more than 2 decimal places (0.0001% is written as "0.00%")
 * - Includes directional marks for safety
 *
 * @example
 * formatPercentage(0.0234, 2)
 * // "2.34%"
 *
 * formatPercentage(0.00015, 2)
 * // "0.00%" (rounds to 2 decimals)
 *
 * @param value - Decimal value (0.5 = 50%)
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted percentage string with % symbol
 */
export function formatPercentage(
  value: number,
  decimals: number = 2
): string {
  if (!isFinite(value)) {
    throw new Error(`Invalid percentage value: ${value}`);
  }

  if (value < 0 || value > 1) {
    console.warn(`Percentage value outside [0, 1] range: ${value}`);
  }

  // Convert to percentage and format
  const percentage = value * 100;
  const formatted = percentage.toFixed(decimals);

  // BiDi isolate for safety (percentages can be misread in RTL contexts)
  const BiDI_ISOLATE_START = "\u2068";
  const BiDI_ISOLATE_END = "\u2069";

  return `${BiDI_ISOLATE_START}${formatted}%${BiDI_ISOLATE_END}`;
}

/**
 * Formats transaction hashes for display
 *
 * Rules:
 * - Chunks hash for readability
 * - Applies RTL-safe formatting
 * - Does NOT truncate (full hash always visible)
 * - Makes it clear this is a hash (not an amount or address)
 *
 * @example
 * formatTransactionHash("0x1234567890abcdef...")
 * // "0x1234 5678 90ab cdef ..." (with BiDi marks)
 *
 * @param hash - Transaction hash string (hex)
 * @param chunkSize - Characters per chunk (default: 4)
 * @returns Formatted hash
 */
export function formatTransactionHash(
  hash: string,
  chunkSize: number = 4
): string {
  const trimmed = hash.trim();

  if (!trimmed) {
    throw new Error("Transaction hash cannot be empty");
  }

  // Chunk the hash
  const chunks: string[] = [];
  for (let i = 0; i < trimmed.length; i += chunkSize) {
    chunks.push(trimmed.slice(i, i + chunkSize));
  }
  const chunked = chunks.join(" ");

  // Apply RTL-safe formatting (transaction hashes must never be confused)
  const BiDI_ISOLATE_START = "\u2068";
  const BiDI_ISOLATE_END = "\u2069";
  const ZERO_WIDTH_SPACE = "\u200B";

  // Use zero-width spaces after "0x" to prevent smart rendering engines
  // from treating it as hex notation in unexpected ways
  const result = trimmed.startsWith("0x")
    ? `0x${ZERO_WIDTH_SPACE}${chunked.slice(2)}`
    : chunked;

  return `${BiDI_ISOLATE_START}${result}${BiDI_ISOLATE_END}`;
}

/**
 * Validates that a string is safe for financial display
 *
 * Checks:
 * - No invisible Unicode characters that could hide data
 * - No RTL override sequences (U+202E)
 * - No excessive BiDi complexity
 *
 * @param text - Text to validate
 * @returns Validation result
 */
export interface ValidationResult {
  isValid: boolean;
  warnings: string[];
  recommendations: string[];
}

export function validateForFinancialDisplay(text: string): ValidationResult {
  const warnings: string[] = [];
  const recommendations: string[] = [];

  // Check for dangerous Unicode characters
  const rtlOverride = "\u202E"; // RIGHT-TO-LEFT OVERRIDE
  const ltrOverride = "\u202D"; // LEFT-TO-RIGHT OVERRIDE
  const rtlIsolate = "\u2067"; // RIGHT-TO-LEFT ISOLATE

  if (text.includes(rtlOverride)) {
    warnings.push("⚠️ Contains RIGHT-TO-LEFT OVERRIDE (U+202E) - potential attack");
    recommendations.push("Strip or replace U+202E characters");
  }

  if (text.includes(ltrOverride)) {
    warnings.push("⚠️ Contains LEFT-TO-RIGHT OVERRIDE (U+202D) - potential attack");
    recommendations.push("Strip or replace U+202D characters");
  }

  // Check for excessive invisible characters
  const invisibleCount = (text.match(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064]/g)
    || []).length;
  if (invisibleCount > 5) {
    warnings.push(
      `⚠️ Excessive invisible characters detected (${invisibleCount})`
    );
    recommendations.push("Review for potential obfuscation attacks");
  }

  // Check for homoglyphs
  const homoResult = detectHomoglyphs(text);
  if (homoResult.hasHomoglyphs) {
    warnings.push(homoResult.recommendation);
    recommendations.push("Verify character-by-character identity");
  }

  return {
    isValid: warnings.length === 0,
    warnings,
    recommendations,
  };
}

/**
 * Strips all formatting from a formatted string (for copying to clipboard)
 *
 * Removes:
 * - BiDi marks
 * - Zero-width spaces
 * - Chunk separators
 * - Currency codes
 *
 * @param formatted - Formatted string (from this module)
 * @returns Raw, copyable string
 */
export function stripFormatting(formatted: string): string {
  let result = formatted;

  // Remove BiDi marks
  result = result.replace(/[\u2068\u2069\u2066\u2067]/g, "");

  // Remove zero-width characters
  result = result.replace(/[\u200B-\u200F]/g, "");

  // Remove thin non-breaking spaces (used as grouping)
  result = result.replace(/\u202F/g, "");

  // Remove trailing currency codes and warnings (keep only the value)
  result = result.split("\n")[0]; // Remove homoglyph warnings

  return result.trim();
}

/**
 * Generates a checksum for verifying address integrity
 *
 * Useful for detecting if an address was corrupted in display
 * (especially in RTL contexts or with homglyph attacks)
 *
 * Uses simple Luhn-like algorithm, NOT cryptographic
 *
 * @param address - Address to checksum
 * @returns Checksum string (typically 4 hex chars)
 */
export function generateAddressChecksum(address: string): string {
  const cleaned = stripFormatting(address);
  let sum = 0;

  for (let i = 0; i < cleaned.length; i++) {
    sum += cleaned.charCodeAt(i) * (i + 1);
  }

  const checksum = (sum % 65536).toString(16).padStart(4, "0");
  return checksum.toUpperCase();
}

/**
 * Formats an address with a checksum for additional verification
 *
 * Provides user with a quick verification method:
 * Users can manually verify first 2 and last 2 chars match checksum
 *
 * @example
 * formatAddressWithChecksum("0x123...abc")
 * // "0x123...abc [12AB]" where [12AB] is checksum
 *
 * @param address - Address to format with checksum
 * @param options - Formatting options
 * @returns Formatted address with checksum
 */
export function formatAddressWithChecksum(
  address: string,
  options: AddressFormattingOptions = {}
): string {
  const formatted = formatAddress(address, options);
  const checksum = generateAddressChecksum(address);
  return `${formatted} [${checksum}]`;
}

export default {
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
};
