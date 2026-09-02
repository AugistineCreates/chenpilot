// chenpilot/tests/setup.ts
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  "test-jwt-secret-at-least-32-chars-long-for-testing-purposes-12345";
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY || "test-anthropic-key-at-least-1-char";
process.env.NODE_URL =
  process.env.NODE_URL || "https://horizon-testnet.stellar.org";
process.env.DB_HOST = process.env.DB_HOST || "localhost";
process.env.DB_USERNAME = process.env.DB_USERNAME || "postgres";
process.env.DB_NAME = process.env.DB_NAME || "test";

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
