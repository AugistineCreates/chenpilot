/**
 * Tests for the SDK error-code registry (#566).
 */

import {
  ErrorRegistry,
  SdkModule,
  SDK_ERROR_DEFINITIONS,
  createSdkError,
} from "../errorRegistry";
import { ErrorCategory, SdkError } from "../errors";

describe("ErrorRegistry", () => {
  it("exposes every definition and has unique codes", () => {
    const codes = ErrorRegistry.codes();
    expect(codes.length).toBe(SDK_ERROR_DEFINITIONS.length);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("get() returns a definition and require() throws for unknown codes", () => {
    expect(ErrorRegistry.get("TRANSPORT_ERROR")?.category).toBe(
      ErrorCategory.TRANSPORT
    );
    expect(ErrorRegistry.get("NOPE_NOT_A_CODE")).toBeUndefined();
    expect(() => ErrorRegistry.require("NOPE_NOT_A_CODE")).toThrow(
      /Unknown SDK error code/
    );
  });

  it("has() reflects registration", () => {
    expect(ErrorRegistry.has("VALIDATION_ERROR")).toBe(true);
    expect(ErrorRegistry.has("MADE_UP")).toBe(false);
  });

  it("byModule() and byCategory() filter correctly", () => {
    const soroban = ErrorRegistry.byModule(SdkModule.SOROBAN);
    expect(soroban.length).toBeGreaterThan(0);
    expect(soroban.every((d) => d.module === SdkModule.SOROBAN)).toBe(true);

    const transport = ErrorRegistry.byCategory(ErrorCategory.TRANSPORT);
    expect(transport.every((d) => d.category === ErrorCategory.TRANSPORT)).toBe(
      true
    );
  });

  it("createError() builds an SdkError from registry metadata", () => {
    const err = ErrorRegistry.createError("SOROBAN_RPC_ERROR", {
      details: { url: "x" },
    });
    expect(err).toBeInstanceOf(SdkError);
    expect(err.code).toBe("SOROBAN_RPC_ERROR");
    expect(err.category).toBe(ErrorCategory.TRANSPORT);
    expect(err.recoverable).toBe(true);
    expect(err.details).toEqual({ url: "x" });
  });

  it("createError() lets callers override the message and recoverability", () => {
    const err = ErrorRegistry.createError("VALIDATION_ERROR", {
      message: "custom",
      recoverable: true,
    });
    expect(err.message).toBe("custom");
    expect(err.recoverable).toBe(true);
  });

  it("createSdkError() is an alias for ErrorRegistry.createError()", () => {
    const err = createSdkError("UNAUTHORIZED");
    expect(err.code).toBe("UNAUTHORIZED");
    expect(err.category).toBe(ErrorCategory.POLICY);
  });
});
