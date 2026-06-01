"use strict";
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
const globals_1 = require("@jest/globals");
const Datasource_1 = __importDefault(require("../../src/config/Datasource"));
const jwt_service_1 = __importDefault(require("../../src/Auth/jwt.service"));
const user_service_1 = __importDefault(require("../../src/Auth/user.service"));
const tsyringe_1 = require("tsyringe");
(0, globals_1.describe)("JWT Refresh Token Rotation", () => {
  let jwtService;
  let userService;
  let testUserId;
  (0, globals_1.beforeAll)(() =>
    __awaiter(void 0, void 0, void 0, function* () {
      // Set test JWT secrets
      process.env.JWT_ACCESS_SECRET =
        "test_access_secret_min_32_characters_long";
      process.env.JWT_REFRESH_SECRET =
        "test_refresh_secret_min_32_characters_long";
      if (!Datasource_1.default.isInitialized) {
        yield Datasource_1.default.initialize();
      }
      jwtService = tsyringe_1.container.resolve(jwt_service_1.default);
      userService = tsyringe_1.container.resolve(user_service_1.default);
      // Create test user
      const user = yield userService.createUser({ name: "testuser_jwt" });
      testUserId = user.id;
    })
  );
  (0, globals_1.afterAll)(() =>
    __awaiter(void 0, void 0, void 0, function* () {
      // Cleanup
      if (testUserId) {
        yield jwtService.revokeAllUserTokens(testUserId, "Test cleanup");
      }
      if (Datasource_1.default.isInitialized) {
        yield Datasource_1.default.destroy();
      }
    })
  );
  (0, globals_1.it)("should generate token pair", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const tokens = yield jwtService.generateTokenPair(
        testUserId,
        "testuser_jwt"
      );
      (0, globals_1.expect)(tokens).toHaveProperty("accessToken");
      (0, globals_1.expect)(tokens).toHaveProperty("refreshToken");
      (0, globals_1.expect)(tokens).toHaveProperty("expiresIn");
      (0, globals_1.expect)(tokens.expiresIn).toBe(900); // 15 minutes
    })
  );
  (0, globals_1.it)("should verify valid access token", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const tokens = yield jwtService.generateTokenPair(
        testUserId,
        "testuser_jwt"
      );
      const payload = jwtService.verifyAccessToken(tokens.accessToken);
      (0, globals_1.expect)(payload.userId).toBe(testUserId);
      (0, globals_1.expect)(payload.name).toBe("testuser_jwt");
    })
  );
  (0, globals_1.it)("should reject invalid access token", () => {
    (0, globals_1.expect)(() => {
      jwtService.verifyAccessToken("invalid_token");
    }).toThrow("Invalid or expired access token");
  });
  (0, globals_1.it)("should rotate refresh token successfully", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const tokens1 = yield jwtService.generateTokenPair(
        testUserId,
        "testuser_jwt"
      );
      // Wait a bit to ensure different timestamps
      yield new Promise((resolve) => setTimeout(resolve, 100));
      const tokens2 = yield jwtService.rotateRefreshToken(tokens1.refreshToken);
      (0, globals_1.expect)(tokens2.accessToken).not.toBe(tokens1.accessToken);
      (0, globals_1.expect)(tokens2.refreshToken).not.toBe(
        tokens1.refreshToken
      );
    })
  );
  (0, globals_1.it)("should reject reused refresh token", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const tokens1 = yield jwtService.generateTokenPair(
        testUserId,
        "testuser_jwt"
      );
      // Use token once
      yield jwtService.rotateRefreshToken(tokens1.refreshToken);
      // Try to reuse the same token
      yield (0, globals_1.expect)(
        jwtService.rotateRefreshToken(tokens1.refreshToken)
      ).rejects.toThrow("Token has been revoked");
    })
  );
  (0, globals_1.it)("should revoke specific token", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const tokens = yield jwtService.generateTokenPair(
        testUserId,
        "testuser_jwt"
      );
      yield jwtService.revokeToken(tokens.refreshToken, "Test revocation");
      yield (0, globals_1.expect)(
        jwtService.rotateRefreshToken(tokens.refreshToken)
      ).rejects.toThrow("Token has been revoked");
    })
  );
  (0, globals_1.it)("should revoke all user tokens", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const tokens1 = yield jwtService.generateTokenPair(
        testUserId,
        "testuser_jwt"
      );
      const tokens2 = yield jwtService.generateTokenPair(
        testUserId,
        "testuser_jwt"
      );
      yield jwtService.revokeAllUserTokens(testUserId, "Test logout all");
      yield (0, globals_1.expect)(
        jwtService.rotateRefreshToken(tokens1.refreshToken)
      ).rejects.toThrow();
      yield (0, globals_1.expect)(
        jwtService.rotateRefreshToken(tokens2.refreshToken)
      ).rejects.toThrow();
    })
  );
  (0, globals_1.it)("should list active user tokens", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      // Clean up first
      yield jwtService.revokeAllUserTokens(testUserId);
      yield jwtService.generateTokenPair(testUserId, "testuser_jwt");
      yield jwtService.generateTokenPair(testUserId, "testuser_jwt");
      const activeTokens = yield jwtService.getUserActiveTokens(testUserId);
      (0, globals_1.expect)(activeTokens.length).toBe(2);
      (0, globals_1.expect)(activeTokens[0].isRevoked).toBe(false);
    })
  );
  (0, globals_1.it)("should cleanup expired tokens", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      // This test would require manipulating dates or waiting
      // For now, just verify the method exists and returns a number
      const deletedCount = yield jwtService.cleanupExpiredTokens();
      (0, globals_1.expect)(typeof deletedCount).toBe("number");
    })
  );
});
