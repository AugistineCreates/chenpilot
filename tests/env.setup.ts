/**
 * Test-environment defaults.
 *
 * `src/config/config.ts` validates a small set of secrets at import time
 * (JWT_SECRET, ENCRYPTION_KEY, ANTHROPIC_API_KEY, NODE_URL, DB_*). Tests that
 * transitively import the config (e.g. the red-team suite via PolicyEnforcer)
 * need these set. Safe non-secret placeholders only — never real credentials.
 */

process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? "test-only-jwt-secret-0123456789abcdef";
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ??
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY ?? "sk-test-placeholder";
process.env.NODE_URL = process.env.NODE_URL ?? "https://rpc.testnet.example";
process.env.DB_HOST = process.env.DB_HOST ?? "localhost";
process.env.DB_USERNAME = process.env.DB_USERNAME ?? "test";
process.env.DB_NAME = process.env.DB_NAME ?? "chenpilot_test";
