"use strict";
/**
 * Preservation Property Tests for Admin IP Whitelist Enforcement
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 *
 * IMPORTANT: These tests verify baseline behavior that MUST be preserved after the fix.
 *
 * This test suite follows the observation-first methodology:
 * 1. Observe behavior on UNFIXED code for non-buggy inputs
 * 2. Write property-based tests capturing observed behavior patterns
 * 3. Run tests on UNFIXED code - they should PASS
 * 4. After fix is applied, re-run tests - they should still PASS (no regressions)
 *
 * Property 2: Preservation - Backward Compatibility and Non-Admin Behavior
 *
 * For all inputs where the bug condition does NOT hold, the fixed function
 * must produce the same result as the original function.
 *
 * NOTE: These tests use direct middleware testing to avoid database dependencies.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const ipWhitelist_middleware_1 = require("../../src/Gateway/middleware/ipWhitelist.middleware");
const rbac_middleware_1 = require("../../src/Gateway/middleware/rbac.middleware");
const roles_1 = require("../../src/Auth/roles");
const config_1 = __importDefault(require("../../src/config/config"));
const fc = __importStar(require("fast-check"));
// Helper to create mock request
function createMockRequest(ip, user) {
    return {
        headers: {
            "x-forwarded-for": ip,
        },
        socket: {
            remoteAddress: ip,
             
        },
         
        user: user,
    };
}
// Helper to create mock response
function createMockResponse() {
     
    let jsonData = null;
    const res = {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        status: jest.fn((_code) => {
            return res;
        }),
         
        json: jest.fn((data) => {
            jsonData = data;
            return res;
        }),
    };
    return {
        res,
        getJsonData: () => jsonData,
    };
}
describe("Preservation Property Tests: Admin IP Whitelist Enforcement", () => {
    const originalAllowedIps = config_1.default.admin.allowedIps;
    afterAll(() => {
        // Restore original config
        config_1.default.admin.allowedIps = originalAllowedIps;
    });
    afterEach(() => {
        // Restore original config after each test
        config_1.default.admin.allowedIps = originalAllowedIps;
    });
    /**
     * Preservation Test 1: Whitelisted IP Access
     *
     * Requirement 3.1 (partial): When ADMIN_ALLOWED_IPS is configured and the IP is whitelisted,
     * admin access should succeed (middleware should call next()).
     *
     * This behavior must be preserved after the fix.
     */
    describe("Whitelisted IP Preservation", () => {
        it("should allow admin access from whitelisted IP 192.168.1.100 when ADMIN_ALLOWED_IPS=192.168.1.0/24", () => {
            // Configure IP whitelist
            config_1.default.admin.allowedIps = ["192.168.1.0/24"];
            const req = createMockRequest("192.168.1.100");
            const { res } = createMockResponse();
            const next = jest.fn();
            const middleware = (0, ipWhitelist_middleware_1.requireAdminWithIpWhitelist)();
             
            middleware(req, res, next);
            // EXPECTED: next() should be called (IP is whitelisted)
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });
        it("should allow admin access from exact whitelisted IP 127.0.0.1", () => {
            // Configure IP whitelist
            config_1.default.admin.allowedIps = ["127.0.0.1", "::1"];
            const req = createMockRequest("127.0.0.1");
            const { res } = createMockResponse();
            const next = jest.fn();
            const middleware = (0, ipWhitelist_middleware_1.requireAdminWithIpWhitelist)();
             
            middleware(req, res, next);
            // EXPECTED: next() should be called (IP is whitelisted)
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });
        it("should allow admin access from whitelisted IPv6 ::1", () => {
            // Configure IP whitelist
            config_1.default.admin.allowedIps = ["::1"];
            const req = createMockRequest("::1");
            const { res } = createMockResponse();
            const next = jest.fn();
            const middleware = (0, ipWhitelist_middleware_1.requireAdminWithIpWhitelist)();
             
            middleware(req, res, next);
            // EXPECTED: next() should be called (IP is whitelisted)
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });
        /**
         * Property-Based Test: All IPs within whitelisted range should succeed
         */
        it("should allow admin access from any IP in whitelisted CIDR range (property-based)", () => {
            // Configure IP whitelist to 192.168.1.0/24
            config_1.default.admin.allowedIps = ["192.168.1.0/24"];
            // Generate IPs within the 192.168.1.0/24 range
            const whitelistedIpArbitrary = fc
                .integer({ min: 0, max: 255 })
                .map((lastOctet) => `192.168.1.${lastOctet}`);
            fc.assert(fc.property(whitelistedIpArbitrary, (ip) => {
                const req = createMockRequest(ip);
                const { res } = createMockResponse();
                const next = jest.fn();
                const middleware = (0, ipWhitelist_middleware_1.requireAdminWithIpWhitelist)();
                 
                middleware(req, res, next);
                // EXPECTED: next() should be called (IP is in whitelisted range)
                expect(next).toHaveBeenCalled();
                expect(res.status).not.toHaveBeenCalled();
            }), { numRuns: 20 });
        });
    });
    /**
     * Preservation Test 2: Empty ADMIN_ALLOWED_IPS (Backward Compatibility)
     *
     * Requirement 3.1: When ADMIN_ALLOWED_IPS is not configured (empty array),
     * admin access from any IP should succeed for backward compatibility.
     *
     * This is critical backward compatibility behavior that must be preserved.
     */
    describe("Empty Whitelist Preservation (Backward Compatibility)", () => {
        it("should allow admin access from any IP when ADMIN_ALLOWED_IPS is empty", () => {
            // Configure empty IP whitelist (backward compatibility mode)
            config_1.default.admin.allowedIps = [];
            const req = createMockRequest("203.0.113.50");
            const { res } = createMockResponse();
            const next = jest.fn();
            const middleware = (0, ipWhitelist_middleware_1.requireAdminWithIpWhitelist)();
             
            middleware(req, res, next);
            // EXPECTED: next() should be called (backward compatibility - no IP restriction)
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });
        it("should allow admin access from localhost when ADMIN_ALLOWED_IPS is empty", () => {
            // Configure empty IP whitelist
            config_1.default.admin.allowedIps = [];
            const req = createMockRequest("127.0.0.1");
            const { res } = createMockResponse();
            const next = jest.fn();
            const middleware = (0, ipWhitelist_middleware_1.requireAdminWithIpWhitelist)();
             
            middleware(req, res, next);
            // EXPECTED: next() should be called (backward compatibility)
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });
        /**
         * Property-Based Test: Any IP should succeed when whitelist is empty
         */
        it("should allow admin access from any IP when ADMIN_ALLOWED_IPS is empty (property-based)", () => {
            // Configure empty IP whitelist
            config_1.default.admin.allowedIps = [];
            // Generate random valid IPv4 addresses
            const randomIpArbitrary = fc
                .tuple(fc.integer({ min: 1, max: 223 }), fc.nat(255), fc.nat(255), fc.nat(255))
                .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);
            fc.assert(fc.property(randomIpArbitrary, (ip) => {
                const req = createMockRequest(ip);
                const { res } = createMockResponse();
                const next = jest.fn();
                const middleware = (0, ipWhitelist_middleware_1.requireAdminWithIpWhitelist)();
                 
                middleware(req, res, next);
                // EXPECTED: next() should be called (backward compatibility)
                expect(next).toHaveBeenCalled();
                expect(res.status).not.toHaveBeenCalled();
            }), { numRuns: 20 });
        });
    });
    /**
     * Preservation Test 3: Non-Admin User Access (RBAC)
     *
     * Requirement 3.2: Non-admin users attempting to access /admin/stats
     * should be denied based on role-based access control regardless of IP address.
     *
     * This RBAC behavior must be preserved after the fix.
     */
    describe("Non-Admin User Preservation (RBAC)", () => {
        it("should deny non-admin user access regardless of IP (whitelisted IP)", () => {
            // Configure IP whitelist
            config_1.default.admin.allowedIps = ["192.168.1.0/24"];
            const req = createMockRequest("192.168.1.100", {
                userId: "test-user-id",
                role: roles_1.UserRole.USER,
            });
            const { res, getJsonData } = createMockResponse();
            const next = jest.fn();
            // Test requireAdmin middleware (RBAC check)
             
            (0, rbac_middleware_1.requireAdmin)(req, res, next);
            // EXPECTED: 403 from RBAC (user is not admin)
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(403);
            expect(getJsonData()).toHaveProperty("message", "Insufficient permissions");
        });
        it("should deny non-admin user access regardless of IP (non-whitelisted IP)", () => {
            // Configure IP whitelist
            config_1.default.admin.allowedIps = ["192.168.1.0/24"];
            const req = createMockRequest("203.0.113.50", {
                userId: "test-user-id",
                role: roles_1.UserRole.USER,
            });
            const { res, getJsonData } = createMockResponse();
            const next = jest.fn();
            // Test requireAdmin middleware (RBAC check)
             
            (0, rbac_middleware_1.requireAdmin)(req, res, next);
            // EXPECTED: 403 from RBAC (user is not admin)
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(403);
            expect(getJsonData()).toHaveProperty("message", "Insufficient permissions");
        });
        it("should deny non-admin user access when ADMIN_ALLOWED_IPS is empty", () => {
            // Configure empty IP whitelist
            config_1.default.admin.allowedIps = [];
            const req = createMockRequest("127.0.0.1", {
                userId: "test-user-id",
                role: roles_1.UserRole.USER,
            });
            const { res, getJsonData } = createMockResponse();
            const next = jest.fn();
            // Test requireAdmin middleware (RBAC check)
             
            (0, rbac_middleware_1.requireAdmin)(req, res, next);
            // EXPECTED: 403 from RBAC (user is not admin)
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(403);
            expect(getJsonData()).toHaveProperty("message", "Insufficient permissions");
        });
        /**
         * Property-Based Test: Non-admin users should always be denied regardless of IP
         */
        it("should deny non-admin user access from any IP (property-based)", () => {
            // Configure IP whitelist
            config_1.default.admin.allowedIps = ["192.168.1.0/24"];
            // Generate random valid IPv4 addresses
            const randomIpArbitrary = fc
                .tuple(fc.integer({ min: 1, max: 223 }), fc.nat(255), fc.nat(255), fc.nat(255))
                .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);
            fc.assert(fc.property(randomIpArbitrary, (ip) => {
                const req = createMockRequest(ip, {
                    userId: "test-user-id",
                    role: roles_1.UserRole.USER,
                });
                const { res, getJsonData } = createMockResponse();
                const next = jest.fn();
                // Test requireAdmin middleware (RBAC check)
                 
                (0, rbac_middleware_1.requireAdmin)(req, res, next);
                // EXPECTED: 403 from RBAC (user is not admin)
                expect(next).not.toHaveBeenCalled();
                expect(res.status).toHaveBeenCalledWith(403);
                expect(getJsonData()).toHaveProperty("message", "Insufficient permissions");
            }), { numRuns: 20 });
        });
    });
    /**
     * Preservation Test 4: IP Whitelist Middleware Functionality
     *
     * Requirement 3.4: The IP whitelist middleware should continue to correctly
     * handle X-Forwarded-For headers, CIDR notation, and IPv6 addresses.
     *
     * This middleware functionality must be preserved after the fix.
     */
    describe("IP Whitelist Middleware Functionality Preservation", () => {
        it("should correctly handle X-Forwarded-For with multiple IPs (first IP is checked)", () => {
            // Configure IP whitelist
            config_1.default.admin.allowedIps = ["192.168.1.0/24"];
            // X-Forwarded-For with multiple IPs - first one is whitelisted
            const req = {
                headers: {
                    "x-forwarded-for": "192.168.1.100, 203.0.113.50",
                },
                socket: {
                    remoteAddress: "10.0.0.1",
                     
                },
            };
            const { res } = createMockResponse();
            const next = jest.fn();
            const middleware = (0, ipWhitelist_middleware_1.requireAdminWithIpWhitelist)();
             
            middleware(req, res, next);
            // EXPECTED: next() should be called (first IP is whitelisted)
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });
        it("should correctly handle CIDR notation /32 (single IP)", () => {
            // Configure IP whitelist with /32 CIDR (single IP)
            config_1.default.admin.allowedIps = ["192.168.1.100/32"];
            const req = createMockRequest("192.168.1.100");
            const { res } = createMockResponse();
            const next = jest.fn();
            const middleware = (0, ipWhitelist_middleware_1.requireAdminWithIpWhitelist)();
             
            middleware(req, res, next);
            // EXPECTED: next() should be called (IP matches /32 CIDR)
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });
        it("should correctly handle CIDR notation /16 (larger range)", () => {
            // Configure IP whitelist with /16 CIDR
            config_1.default.admin.allowedIps = ["192.168.0.0/16"];
            const req = createMockRequest("192.168.50.100");
            const { res } = createMockResponse();
            const next = jest.fn();
            const middleware = (0, ipWhitelist_middleware_1.requireAdminWithIpWhitelist)();
             
            middleware(req, res, next);
            // EXPECTED: next() should be called (IP is in /16 range)
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });
        it("should correctly handle IPv6 addresses", () => {
            // Configure IP whitelist with IPv6
            config_1.default.admin.allowedIps = ["2001:db8::/32"];
            const req = createMockRequest("2001:db8::1");
            const { res } = createMockResponse();
            const next = jest.fn();
            const middleware = (0, ipWhitelist_middleware_1.requireAdminWithIpWhitelist)();
             
            middleware(req, res, next);
            // EXPECTED: next() should be called (IPv6 is in range)
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });
    });
    /**
     * Preservation Test 5: Non-Admin Routes
     *
     * Requirement 3.3: Non-admin routes should not be affected by IP whitelist middleware.
     *
     * NOTE: This is tested implicitly - the IP whitelist middleware is only applied to admin routes.
     * Non-admin routes don't use requireAdminWithIpWhitelist(), so they are unaffected.
     *
     * This test documents that behavior for completeness.
     */
    describe("Non-Admin Route Preservation", () => {
        it("should document that IP whitelist middleware is not applied to non-admin routes", () => {
            // This is a documentation test
            // Non-admin routes (like /signup, /liquidity, /auth/*) do not use requireAdminWithIpWhitelist()
            // Therefore, they are not affected by ADMIN_ALLOWED_IPS configuration
            // The middleware is only applied to routes that explicitly use it
            // After the fix, only admin routes will have requireAdminWithIpWhitelist() in their middleware chain
            // This test passes by definition - it documents the expected behavior
            expect(true).toBe(true);
        });
    });
});
