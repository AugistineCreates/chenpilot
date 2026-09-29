/**
 * Golden vector tests for canonical serialization.
 *
 * These tests ensure that the canonicalization algorithm produces identical
 * output across TypeScript and backend runtimes.
 *
 * Test categories:
 * - field-order: Object key ordering
 * - unicode: Unicode normalization
 * - integers: Integer serialization
 * - decimals: Decimal/float serialization
 * - optional-values: undefined vs null handling
 * - strings: String escaping
 * - primitives: Boolean serialization
 * - mixed-types: Arrays with mixed element types
 * - edge-cases: Empty objects/arrays
 * - plan-verification: Execution plan canonicalization
 * - idempotency: Idempotency key generation
 * - offline-signing: Offline signing artifact canonicalization
 * - encoding: Base64URL encoding
 */

import * as fs from "fs";
import * as path from "path";
import {
  canonicalize,
  computeDigest,
  toBase64Url,
  fromBase64Url,
  normalizeUnicode,
  canonicalizeWithNormalization,
  type CanonicalValue,
} from "../../canonical";

interface GoldenVector {
  id: string;
  name: string;
  description: string;
  input: CanonicalValue;
  expected: string;
  category: string;
}

interface GoldenVectorFile {
  version: string;
  description: string;
  vectors: GoldenVector[];
}

function loadGoldenVectors(): GoldenVector[] {
  const fixturePath = path.join(
    __dirname,
    "..",
    "..",
    "__fixtures__",
    "canonicalVectors",
    "goldenVectors.json"
  );
  const content = fs.readFileSync(fixturePath, "utf-8");
  const data: GoldenVectorFile = JSON.parse(content);
  return data.vectors;
}

describe("Golden Vector Tests", () => {
  const vectors = loadGoldenVectors();

  describe("Field Order", () => {
    const fieldOrderVectors = vectors.filter(
      (v) => v.category === "field-order"
    );

    it.each(fieldOrderVectors)(
      "$id: $name",
      (vector) => {
        const result = canonicalize(vector.input);
        expect(result).toBe(vector.expected);
      }
    );
  });

  describe("Unicode", () => {
    const unicodeVectors = vectors.filter((v) => v.category === "unicode");

    it.each(unicodeVectors)(
      "$id: $name",
      (vector) => {
        const result = canonicalize(vector.input);
        expect(result).toBe(vector.expected);
      }
    );

    it("should normalize combining characters to NFC", () => {
      const combining = "e\u0301"; // e + combining acute accent
      const nfc = "\u00e9"; // é as single codepoint
      expect(normalizeUnicode(combining)).toBe(nfc);
    });
  });

  describe("Integers", () => {
    const integerVectors = vectors.filter((v) => v.category === "integers");

    it.each(integerVectors)(
      "$id: $name",
      (vector) => {
        const result = canonicalize(vector.input);
        expect(result).toBe(vector.expected);
      }
    );
  });

  describe("Decimals", () => {
    const decimalVectors = vectors.filter((v) => v.category === "decimals");

    it.each(decimalVectors)(
      "$id: $name",
      (vector) => {
        const result = canonicalize(vector.input);
        expect(result).toBe(vector.expected);
      }
    );
  });

  describe("Optional Values", () => {
    const optionalVectors = vectors.filter(
      (v) => v.category === "optional-values"
    );

    it.each(optionalVectors)(
      "$id: $name",
      (vector) => {
        const result = canonicalize(vector.input);
        expect(result).toBe(vector.expected);
      }
    );

    it("should omit undefined values (not representable in JSON)", () => {
      const input = { a: 1, b: undefined, c: 3 };
      const result = canonicalize(input);
      expect(result).toBe('{"a":1,"c":3}');
    });
  });

  describe("Strings", () => {
    const stringVectors = vectors.filter((v) => v.category === "strings");

    it.each(stringVectors)(
      "$id: $name",
      (vector) => {
        const result = canonicalize(vector.input);
        expect(result).toBe(vector.expected);
      }
    );
  });

  describe("Primitives", () => {
    const primitiveVectors = vectors.filter(
      (v) => v.category === "primitives"
    );

    it.each(primitiveVectors)(
      "$id: $name",
      (vector) => {
        const result = canonicalize(vector.input);
        expect(result).toBe(vector.expected);
      }
    );
  });

  describe("Mixed Types", () => {
    const mixedVectors = vectors.filter((v) => v.category === "mixed-types");

    it.each(mixedVectors)(
      "$id: $name",
      (vector) => {
        const result = canonicalize(vector.input);
        expect(result).toBe(vector.expected);
      }
    );
  });

  describe("Edge Cases", () => {
    const edgeCaseVectors = vectors.filter(
      (v) => v.category === "edge-cases"
    );

    it.each(edgeCaseVectors)(
      "$id: $name",
      (vector) => {
        const result = canonicalize(vector.input);
        expect(result).toBe(vector.expected);
      }
    );
  });

  describe("Plan Verification", () => {
    const planVectors = vectors.filter(
      (v) => v.category === "plan-verification"
    );

    it.each(planVectors)(
      "$id: $name",
      (vector) => {
        const result = canonicalize(vector.input);
        expect(result).toBe(vector.expected);
      }
    );

    it("should produce deterministic digest for plans", () => {
      const planInput = vectors.find((v) => v.id === "vec-016")?.input;
      if (!planInput) return;

      const digest1 = computeDigest(planInput);
      const digest2 = computeDigest(planInput);

      expect(digest1).toBe(digest2);
      expect(digest1).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("Idempotency", () => {
    const idempotencyVectors = vectors.filter(
      (v) => v.category === "idempotency"
    );

    it.each(idempotencyVectors)(
      "$id: $name",
      (vector) => {
        const result = canonicalize(vector.input);
        expect(result).toBe(vector.expected);
      }
    );
  });

  describe("Offline Signing", () => {
    const offlineSigningVectors = vectors.filter(
      (v) => v.category === "offline-signing"
    );

    it.each(offlineSigningVectors)(
      "$id: $name",
      (vector) => {
        const result = canonicalize(vector.input);
        expect(result).toBe(vector.expected);
      }
    );
  });

  describe("Encoding", () => {
    it("vec-019: base64url-encoding", () => {
      const vector = vectors.find((v) => v.id === "vec-019");
      if (!vector) return;

      const result = toBase64Url(vector.input as string);
      expect(result).toBe(vector.expected);
    });

    it("should round-trip through base64url", () => {
      const original = "Hello, World! 🌍";
      const encoded = toBase64Url(original);
      const decoded = fromBase64Url(encoded);
      expect(decoded).toBe(original);
    });
  });

  describe("Digest Determinism", () => {
    it("should produce same digest for same input", () => {
      const input = { a: 1, b: 2, c: 3 };
      const digest1 = computeDigest(input);
      const digest2 = computeDigest(input);
      expect(digest1).toBe(digest2);
    });

    it("should produce different digests for different inputs", () => {
      const input1 = { a: 1, b: 2 };
      const input2 = { a: 1, b: 3 };
      const digest1 = computeDigest(input1);
      const digest2 = computeDigest(input2);
      expect(digest1).not.toBe(digest2);
    });

    it("should be order-independent for object keys", () => {
      const input1 = { z: 1, a: 2, m: 3 };
      const input2 = { a: 2, m: 3, z: 1 };
      const digest1 = computeDigest(input1);
      const digest2 = computeDigest(input2);
      expect(digest1).toBe(digest2);
    });
  });

  describe("Versioning", () => {
    it("should have a version field", () => {
      const fixturePath = path.join(
        __dirname,
        "..",
        "..",
        "__fixtures__",
        "canonicalVectors",
        "goldenVectors.json"
      );
      const content = fs.readFileSync(fixturePath, "utf-8");
      const data = JSON.parse(content);
      expect(data.version).toBeDefined();
      expect(data.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it("should have unique vector IDs", () => {
      const fixturePath = path.join(
        __dirname,
        "..",
        "..",
        "__fixtures__",
        "canonicalVectors",
        "goldenVectors.json"
      );
      const content = fs.readFileSync(fixturePath, "utf-8");
      const data = JSON.parse(content);
      const ids = data.vectors.map((v: GoldenVector) => v.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe("Fuzz Tests - Normalization Stability", () => {
    it("should handle random objects deterministically", () => {
      const inputs = [
        { a: 1, b: { c: 2, d: 3 }, e: [1, 2, 3] },
        { z: "hello", y: null, x: true },
        { nested: { deep: { value: 42 } } },
        { arr: [{ a: 1 }, { b: 2 }], obj: { c: 3 } },
      ];

      for (const input of inputs) {
        const result1 = canonicalize(input);
        const result2 = canonicalize(input);
        expect(result1).toBe(result2);
      }
    });

    it("should produce same output when re-canonicalized", () => {
      const input = { z: 1, a: 2, nested: { y: 3, b: 4 } };
      const first = canonicalize(input);
      const second = canonicalize(JSON.parse(first));
      expect(first).toBe(second);
    });

    it("should handle all primitive types", () => {
      const primitives: CanonicalValue[] = [
        null,
        true,
        false,
        0,
        1,
        -1,
        0.5,
        "",
        "hello",
        [],
        {},
      ];

      for (const input of primitives) {
        const result1 = canonicalize(input);
        const result2 = canonicalize(input);
        expect(result1).toBe(result2);
      }
    });
  });
});
