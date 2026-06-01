"use strict";
/**
 * Bug Condition Exploration Test for Admin IP Whitelist Enforcement
 *
 * **Validates: Requirements 1.1, 1.2, 2.1, 2.2**
 *
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists
 *
 * This test encodes the EXPECTED behavior (IP whitelist enforcement on admin routes).
 * On UNFIXED code, it will FAIL because the middleware is not applied.
 * After the fix is implemented, this test will PASS, validating the fix.
 *
 * DO NOT attempt to fix the test or the code when it fails - the failure is expected
 * and proves the bug exists.
 */
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (
          !desc ||
          ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)
        ) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, "default", { enumerable: true, value: v });
      }
    : function (o, v) {
        o["default"] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o)
            if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== "default") __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done
          ? resolve(result.value)
          : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const api_1 = __importDefault(require("../../src/Gateway/api"));
const roles_1 = require("../../src/Auth/roles");
const config_1 = __importDefault(require("../../src/config/config"));
const fc = __importStar(require("fast-check"));
describe("Bug Condition Exploration: Admin IP Whitelist Enforcement", () => {
  let adminToken;
  const originalAllowedIps = config_1.default.admin.allowedIps;
  beforeAll(() =>
    __awaiter(void 0, void 0, void 0, function* () {
      // Generate admin JWT token (no database required for this test)
      // We're testing the middleware behavior, not the database
      // Use JWT_ACCESS_SECRET which is what the JwtService uses
      const jwtSecret =
        process.env.JWT_ACCESS_SECRET ||
        "b789aaf3a7b2f27536e4133e96ea2107b4c80a8ab15727a18ce13d7725627744";
      adminToken = jsonwebtoken_1.default.sign(
        {
          userId: "test-admin-id",
          name: "test-admin",
          role: roles_1.UserRole.ADMIN,
        },
        jwtSecret,
        { expiresIn: "1h" }
      );
    })
  );
  afterAll(() => {
    // Restore original config
    config_1.default.admin.allowedIps = originalAllowedIps;
  });
  afterEach(() => {
    // Restore original config after each test
    config_1.default.admin.allowedIps = originalAllowedIps;
  });
  /**
   * Property 1: Fault Condition - IP Whitelist Not Enforced on Admin Routes
   *
   * Test Case 1: Authenticated admin from IP 203.0.113.50 with ADMIN_ALLOWED_IPS=192.168.1.0/24
   * EXPECTED ON UNFIXED CODE: Returns 200 with stats (BUG - should return 403)
   * EXPECTED ON FIXED CODE: Returns 403 with "Access denied" message
   */
  it("should deny admin access from non-whitelisted IP 203.0.113.50 when ADMIN_ALLOWED_IPS=192.168.1.0/24", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      // Configure IP whitelist
      config_1.default.admin.allowedIps = ["192.168.1.0/24"];
      const response = yield (0, supertest_1.default)(api_1.default)
        .get("/api/admin/stats")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", "203.0.113.50");
      // EXPECTED: 403 on fixed code, will be 200 on unfixed code
      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe(
        "Access denied. Your IP is not allowed to access this resource."
      );
    }));
  /**
   * Test Case 2: Authenticated admin from IP 10.0.0.5 with ADMIN_ALLOWED_IPS=127.0.0.1,::1
   * EXPECTED ON UNFIXED CODE: Returns 200 with stats (BUG - should return 403)
   * EXPECTED ON FIXED CODE: Returns 403 with "Access denied" message
   */
  it("should deny admin access from non-whitelisted IP 10.0.0.5 when ADMIN_ALLOWED_IPS=127.0.0.1,::1", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      // Configure IP whitelist
      config_1.default.admin.allowedIps = ["127.0.0.1", "::1"];
      const response = yield (0, supertest_1.default)(api_1.default)
        .get("/api/admin/stats")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", "10.0.0.5");
      // EXPECTED: 403 on fixed code, will be 200 on unfixed code
      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe(
        "Access denied. Your IP is not allowed to access this resource."
      );
    }));
  /**
   * Test Case 3: Authenticated admin from IPv6 2001:db8::1 with ADMIN_ALLOWED_IPS=::1
   * EXPECTED ON UNFIXED CODE: Returns 200 with stats (BUG - should return 403)
   * EXPECTED ON FIXED CODE: Returns 403 with "Access denied" message
   */
  it("should deny admin access from non-whitelisted IPv6 2001:db8::1 when ADMIN_ALLOWED_IPS=::1", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      // Configure IP whitelist
      config_1.default.admin.allowedIps = ["::1"];
      const response = yield (0, supertest_1.default)(api_1.default)
        .get("/api/admin/stats")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", "2001:db8::1");
      // EXPECTED: 403 on fixed code, will be 200 on unfixed code
      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe(
        "Access denied. Your IP is not allowed to access this resource."
      );
    }));
  /**
   * Test Case 4: Authenticated admin with X-Forwarded-For containing non-whitelisted IP
   * EXPECTED ON UNFIXED CODE: Returns 200 with stats (BUG - should return 403)
   * EXPECTED ON FIXED CODE: Returns 403 with "Access denied" message
   */
  it("should deny admin access when X-Forwarded-For contains non-whitelisted IP", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      // Configure IP whitelist
      config_1.default.admin.allowedIps = ["192.168.1.0/24"];
      // X-Forwarded-For with multiple IPs (first one should be checked)
      const response = yield (0, supertest_1.default)(api_1.default)
        .get("/api/admin/stats")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", "203.0.113.100, 192.168.1.50");
      // EXPECTED: 403 on fixed code, will be 200 on unfixed code
      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe(
        "Access denied. Your IP is not allowed to access this resource."
      );
    }));
  /**
   * Property-Based Test: Scoped PBT for Non-Whitelisted IPs
   *
   * Generates random non-whitelisted IPs and verifies they are all denied access
   * when ADMIN_ALLOWED_IPS is configured.
   */
  it("should deny admin access from any non-whitelisted IP (property-based)", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      // Configure IP whitelist to a specific range
      config_1.default.admin.allowedIps = ["192.168.1.0/24"];
      // Generate IPs that are NOT in the 192.168.1.0/24 range
      const nonWhitelistedIpArbitrary = fc.oneof(
        // IPs in different private ranges
        fc
          .tuple(fc.constant(10), fc.nat(255), fc.nat(255), fc.nat(255))
          .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
        fc
          .tuple(
            fc.constant(172),
            fc.integer({ min: 16, max: 31 }),
            fc.nat(255),
            fc.nat(255)
          )
          .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
        // IPs in 192.168.x.x but NOT 192.168.1.x
        fc
          .tuple(
            fc.constant(192),
            fc.constant(168),
            fc.integer({ min: 2, max: 255 }),
            fc.nat(255)
          )
          .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
        // Public IPs
        fc
          .tuple(
            fc.integer({ min: 1, max: 223 }),
            fc.nat(255),
            fc.nat(255),
            fc.nat(255)
          )
          .filter(([a]) => a !== 10 && a !== 172 && a !== 192)
          .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`)
      );
      yield fc.assert(
        fc.asyncProperty(nonWhitelistedIpArbitrary, (ip) =>
          __awaiter(void 0, void 0, void 0, function* () {
            const response = yield (0, supertest_1.default)(api_1.default)
              .get("/api/admin/stats")
              .set("Authorization", `Bearer ${adminToken}`)
              .set("X-Forwarded-For", ip);
            // EXPECTED: 403 on fixed code, will be 200 on unfixed code
            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
            expect(response.body.message).toBe(
              "Access denied. Your IP is not allowed to access this resource."
            );
          })
        ),
        { numRuns: 20 } // Run 20 random test cases
      );
    }));
});
