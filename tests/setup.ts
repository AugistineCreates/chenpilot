// chenpilot/tests/setup.ts
// Set test fallback environment variables before any config module is loaded
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "default_test_jwt_secret_32_chars_long_12345";
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY || "mock-anthropic-key-for-test-suite";
process.env.NODE_URL = process.env.NODE_URL || "http://localhost:8545";
process.env.DB_HOST = process.env.DB_HOST || "localhost";
process.env.DB_USERNAME = process.env.DB_USERNAME || "test";
process.env.DB_NAME = process.env.DB_NAME || "chenpilot_test";

import "reflect-metadata";
import AppDataSource from "../src/config/Datasource";

beforeAll(async () => {
  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
  } catch {
    // Some tests don't require database connection (e.g., middleware unit tests)
    // Silently skip database initialization if it fails
    console.log("Database initialization skipped (not required for this test)");
  }
});

afterAll(async () => {
  try {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  } catch {
    // Silently skip database cleanup if it fails
  }
});