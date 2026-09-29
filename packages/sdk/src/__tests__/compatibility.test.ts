/**
 * Tests for the SDK ↔ contract compatibility matrix & guardrails (#570).
 */

import {
  CompatibilityMatrix,
  checkCompatibility,
  assertCompatible,
  parseSemVer,
  compareSemVer,
  isVersionInRange,
} from "../compatibility";
import { SdkError } from "../errors";

describe("semver helpers", () => {
  it("parses and compares versions", () => {
    expect(parseSemVer("v1.2.3-beta.1")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
    });
    expect(compareSemVer("1.0.0", "1.0.1")).toBeLessThan(0);
    expect(compareSemVer("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareSemVer("1.2.3", "1.2.3")).toBe(0);
  });

  it("checks ranges inclusively with open bounds", () => {
    expect(isVersionInRange("1.5.0", { min: "1.0.0", max: "2.0.0" })).toBe(
      true
    );
    expect(isVersionInRange("2.0.0", { min: "1.0.0", max: "2.0.0" })).toBe(
      true
    );
    expect(isVersionInRange("2.0.1", { min: "1.0.0", max: "2.0.0" })).toBe(
      false
    );
    expect(isVersionInRange("0.9.0", { min: "1.0.0" })).toBe(false);
    expect(isVersionInRange("9.9.9", { max: "10.0.0" })).toBe(true);
  });
});

describe("CompatibilityMatrix", () => {
  const matrix = new CompatibilityMatrix([
    {
      contract: "vault",
      contractVersion: "1.0.0",
      sdkRange: { min: "0.1.0", max: "0.9.0" },
      requiredCapabilities: ["deposit", "withdraw"],
    },
  ]);

  it("reports compatible when the SDK is in range and capabilities are met", () => {
    const result = checkCompatibility(matrix, {
      sdkVersion: "0.1.0",
      contract: "vault",
      contractVersion: "1.0.0",
      backendCapabilities: ["deposit", "withdraw", "extra"],
    });
    expect(result.compatible).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("flags an unregistered contract version", () => {
    const result = matrix.check({
      sdkVersion: "0.1.0",
      contract: "vault",
      contractVersion: "9.9.9",
    });
    expect(result.compatible).toBe(false);
    expect(result.issues[0].code).toBe("CONTRACT_VERSION_UNSUPPORTED");
  });

  it("flags an out-of-range SDK version", () => {
    const result = matrix.check({
      sdkVersion: "1.5.0",
      contract: "vault",
      contractVersion: "1.0.0",
    });
    expect(result.issues.some((i) => i.code === "COMPATIBILITY_ERROR")).toBe(
      true
    );
  });

  it("flags missing required capabilities", () => {
    const result = matrix.check({
      sdkVersion: "0.1.0",
      contract: "vault",
      contractVersion: "1.0.0",
      backendCapabilities: ["deposit"],
    });
    expect(result.issues.some((i) => i.code === "CAPABILITY_UNSUPPORTED")).toBe(
      true
    );
    expect(result.issues[0].message).toMatch(/withdraw/);
  });

  it("assert() throws a typed SdkError on incompatibility and returns on success", () => {
    expect(() =>
      assertCompatible(matrix, {
        sdkVersion: "5.0.0",
        contract: "vault",
        contractVersion: "1.0.0",
      })
    ).toThrow(SdkError);

    const ok = assertCompatible(matrix, {
      sdkVersion: "0.5.0",
      contract: "vault",
      contractVersion: "1.0.0",
      backendCapabilities: ["deposit", "withdraw"],
    });
    expect(ok.compatible).toBe(true);
  });

  it("entriesFor() returns rows for a contract", () => {
    expect(matrix.entriesFor("vault")).toHaveLength(1);
    expect(matrix.entriesFor("missing")).toHaveLength(0);
  });
});
