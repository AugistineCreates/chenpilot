"use strict";
/**
 * Bug Condition Exploration Test for Admin IP Whitelist Enforcement
 *
 * **Validates: Requirements 1.1, 1.2, 2.1, 2.2**
 *
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists
 *
 * This test directly tests the route configuration to verify if IP whitelist middleware
 * is applied to admin routes. On UNFIXED code, the middleware will NOT be present.
 * After the fix is implemented, the middleware will be present.
 *
 * DO NOT attempt to fix the test or the code when it fails - the failure is expected
 * and proves the bug exists.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = require("path");
describe("Bug Condition Exploration: Admin IP Whitelist Middleware Application", () => {
  /**
   * Test Case: Check if requireAdminWithIpWhitelist is imported and used in routes.ts
   * EXPECTED ON UNFIXED CODE: Import and usage will NOT be found (BUG)
   * EXPECTED ON FIXED CODE: Import and usage will be found
   */
  it("should have requireAdminWithIpWhitelist imported in routes.ts", () => {
    const routesPath = (0, path_1.join)(
      __dirname,
      "../../src/Gateway/routes.ts"
    );
    const routesContent = (0, fs_1.readFileSync)(routesPath, "utf-8");
    // Check if requireAdminWithIpWhitelist is imported
    const hasImport = routesContent.includes("requireAdminWithIpWhitelist");
    // EXPECTED: true on fixed code, false on unfixed code
    expect(hasImport).toBe(true);
  });
  it("should apply requireAdminWithIpWhitelist middleware to /admin/stats route", () => {
    const routesPath = (0, path_1.join)(
      __dirname,
      "../../src/Gateway/routes.ts"
    );
    const routesContent = (0, fs_1.readFileSync)(routesPath, "utf-8");
    // Find the /admin/stats route definition
    const adminStatsRouteRegex =
      /router\.get\s*\(\s*["']\/admin\/stats["']\s*,([^)]+)\)/s;
    const match = routesContent.match(adminStatsRouteRegex);
    expect(match).not.toBeNull();
    if (match) {
      const middlewareChain = match[1];
      // Check if requireAdminWithIpWhitelist is in the middleware chain
      const hasIpWhitelistMiddleware = middlewareChain.includes(
        "requireAdminWithIpWhitelist"
      );
      // EXPECTED: true on fixed code, false on unfixed code
      // This will FAIL on unfixed code, proving the bug exists
      expect(hasIpWhitelistMiddleware).toBe(true);
    }
  });
  /**
   * Documentation of Expected Counterexamples:
   *
   * On UNFIXED code, the tests above will FAIL with:
   * - requireAdminWithIpWhitelist is NOT imported in routes.ts
   * - requireAdminWithIpWhitelist is NOT applied to /admin/stats route
   * - Only authenticateToken and requireAdmin are present in the middleware chain
   *
   * This proves that the IP whitelist middleware exists but is not being used,
   * which is the root cause of the bug.
   *
   * After the fix is applied:
   * - requireAdminWithIpWhitelist WILL be imported
   * - requireAdminWithIpWhitelist WILL be in the middleware chain for /admin/stats
   * - The tests will PASS, validating the fix
   */
});
