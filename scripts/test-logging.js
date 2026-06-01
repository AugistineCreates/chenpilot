"use strict";
/**
 * Script to test and demonstrate the logging system
 * Run with: npx ts-node scripts/test-logging.ts
 */
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../src/config/logger");
console.log("Testing logging system...\n");
// Test different log levels
(0, logger_1.logInfo)("Application started", {
  version: "1.0.0",
  environment: "test",
});
(0, logger_1.logDebug)("Debug information", {
  requestId: "test-123",
  timestamp: Date.now(),
});
(0, logger_1.logWarn)("Warning: API rate limit approaching", {
  remaining: 10,
  limit: 100,
});
// Test error logging
try {
  throw new Error("Test error for logging");
} catch (error) {
  (0, logger_1.logError)("Caught an error", error, { context: "test-script" });
}
// Test sensitive data redaction
(0, logger_1.logInfo)("User authentication", {
  username: "testuser",
  password: "this-should-be-redacted",
  pk: "private-key-should-be-redacted",
  token: "token-should-be-redacted",
  email: "user@example.com", // This should NOT be redacted
});
// Test with metadata
(0, logger_1.logInfo)("Transaction processed", {
  transactionId: "tx-456",
  amount: 100.5,
  currency: "USD",
  status: "completed",
});
console.log("\nLogging test completed!");
console.log("Check the logs directory for output files:");
console.log("- logs/application-current.log");
console.log("- logs/error-current.log");
