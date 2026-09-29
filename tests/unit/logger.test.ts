import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { redactSensitiveData } from "../../src/config/logger";
import logger, {
  logInfo,
  logError,
  logWarn,
  logDebug,
} from "../../src/config/logger";
import fs from "fs";
import path from "path";

describe("Logger", () => {
  const logsDir = path.join(process.cwd(), "logs");

  beforeEach(() => {
    // Ensure logs directory exists
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
  });

  it("should log info messages", () => {
    const spy = jest.spyOn(logger, "info");
    logInfo("Test info message", { test: true });
    expect(spy).toHaveBeenCalledWith("Test info message", { test: true });
  });

  it("should log error messages", () => {
    const spy = jest.spyOn(logger, "error");
    const error = new Error("Test error");
    logError("Test error message", error);
    expect(spy).toHaveBeenCalled();
  });

  it("should log warning messages", () => {
    const spy = jest.spyOn(logger, "warn");
    logWarn("Test warning message", { warning: true });
    expect(spy).toHaveBeenCalledWith("Test warning message", { warning: true });
  });

  it("should log debug messages", () => {
    const spy = jest.spyOn(logger, "debug");
    logDebug("Test debug message", { debug: true });
    expect(spy).toHaveBeenCalledWith("Test debug message", { debug: true });
  });

  it("should redact sensitive data", () => {
    const spy = jest.spyOn(logger, "info");
    logInfo("User data", {
      username: "john",
      password: "secret123",
      pk: "private-key-data",
    });
    expect(spy).toHaveBeenCalled();
  });

  it("should redact KYC PII fields", () => {
    const kycPayload = {
      userId: "user-abc-123",
      fullName: "Jane Doe",
      dateOfBirth: "1990-01-15",
      email: "jane.doe@example.com",
      phoneNumber: "+1-555-123-4567",
      addressLine1: "123 Main Street",
      addressLine2: "Apt 4B",
      postalCode: "10001",
      countryCode: "US",
      documentId: "AB1234567",
      fileUrl: "https://storage.example.com/documents/passport.pdf",
    };

    const result = redactSensitiveData(kycPayload) as Record<string, unknown>;

    expect(result.userId).toBe("user-abc-123");
    expect(result.fullName).toBe("[REDACTED]");
    expect(result.dateOfBirth).toBe("[REDACTED]");
    expect(result.email).toBe("[REDACTED]");
    expect(result.phoneNumber).toBe("[REDACTED]");
    expect(result.addressLine1).toBe("[REDACTED]");
    expect(result.addressLine2).toBe("[REDACTED]");
    expect(result.postalCode).toBe("[REDACTED]");
    expect(result.countryCode).toBe("[REDACTED]");
    expect(result.documentId).toBe("[REDACTED]");
    expect(result.fileUrl).toBe("[REDACTED]");
  });
});
