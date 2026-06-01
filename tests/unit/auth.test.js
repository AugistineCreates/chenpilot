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
const supertest_1 = __importDefault(require("supertest"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const api_1 = __importDefault(require("../../src/Gateway/api"));
const Datasource_1 = __importDefault(require("../../src/config/Datasource"));
const user_entity_1 = require("../../src/Auth/user.entity");
const config_1 = __importDefault(require("../../src/config/config"));
describe("Auth - Password Reset & Email Verification", () => {
  let testUser;
  beforeAll(() =>
    __awaiter(void 0, void 0, void 0, function* () {
      const userRepository = Datasource_1.default.getRepository(
        user_entity_1.User
      );
      // Create a test user with an email
      testUser = userRepository.create({
        name: "authtestuser",
        email: "authtest@example.com",
        address: "GTEST000000000000000000000000000000000000000000000000000",
        pk: "STEST000000000000000000000000000000000000000000000000000",
        encryptedPrivateKey: "test-encrypted-key",
      });
      testUser = yield userRepository.save(testUser);
    })
  );
  afterAll(() =>
    __awaiter(void 0, void 0, void 0, function* () {
      const userRepository = Datasource_1.default.getRepository(
        user_entity_1.User
      );
      yield userRepository.delete({ name: "authtestuser" });
    })
  );
  // ─── POST /auth/forgot-password ─────────────────────────────────
  describe("POST /auth/forgot-password", () => {
    it("should return success for valid email", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const response = yield (0, supertest_1.default)(api_1.default)
          .post("/auth/forgot-password")
          .send({ email: "authtest@example.com" })
          .expect(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain("reset link has been sent");
      }));
    it("should return same message for non-existent email (prevent enumeration)", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const response = yield (0, supertest_1.default)(api_1.default)
          .post("/auth/forgot-password")
          .send({ email: "nonexistent@example.com" })
          .expect(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain("reset link has been sent");
      }));
    it("should return 400 when email is missing", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const response = yield (0, supertest_1.default)(api_1.default)
          .post("/auth/forgot-password")
          .send({})
          .expect(400);
        expect(response.body.success).toBe(false);
      }));
    it("should return 400 for invalid email format", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const response = yield (0, supertest_1.default)(api_1.default)
          .post("/auth/forgot-password")
          .send({ email: "not-an-email" })
          .expect(400);
        expect(response.body.success).toBe(false);
      }));
  });
  // ─── POST /auth/reset-password ──────────────────────────────────
  describe("POST /auth/reset-password", () => {
    it("should return 400 when token is missing", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const response = yield (0, supertest_1.default)(api_1.default)
          .post("/auth/reset-password")
          .send({ newPassword: "newpassword123" })
          .expect(400);
        expect(response.body.success).toBe(false);
      }));
    it("should return 400 when newPassword is missing", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const response = yield (0, supertest_1.default)(api_1.default)
          .post("/auth/reset-password")
          .send({ token: "some-token" })
          .expect(400);
        expect(response.body.success).toBe(false);
      }));
    it("should return 401 for invalid token", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const response = yield (0, supertest_1.default)(api_1.default)
          .post("/auth/reset-password")
          .send({ token: "invalid-token", newPassword: "newpassword123" })
          .expect(401);
        expect(response.body.success).toBe(false);
      }));
    it("should return 400 for password shorter than 8 characters", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const validToken = jsonwebtoken_1.default.sign(
          {
            userId: testUser.id,
            email: testUser.email,
            type: "password_reset",
          },
          config_1.default.jwt.secret,
          { expiresIn: "1h" }
        );
        const response = yield (0, supertest_1.default)(api_1.default)
          .post("/auth/reset-password")
          .send({ token: validToken, newPassword: "short" })
          .expect(400);
        expect(response.body.success).toBe(false);
      }));
    it("should reject token with wrong type", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const wrongTypeToken = jsonwebtoken_1.default.sign(
          {
            userId: testUser.id,
            email: testUser.email,
            type: "email_verification",
          },
          config_1.default.jwt.secret,
          { expiresIn: "1h" }
        );
        const response = yield (0, supertest_1.default)(api_1.default)
          .post("/auth/reset-password")
          .send({ token: wrongTypeToken, newPassword: "newpassword123" })
          .expect(401);
        expect(response.body.success).toBe(false);
      }));
  });
  // ─── POST /auth/verify-email ────────────────────────────────────
  describe("POST /auth/verify-email", () => {
    it("should return 400 when token is missing", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const response = yield (0, supertest_1.default)(api_1.default)
          .post("/auth/verify-email")
          .send({})
          .expect(400);
        expect(response.body.success).toBe(false);
      }));
    it("should return 401 for invalid token", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const response = yield (0, supertest_1.default)(api_1.default)
          .post("/auth/verify-email")
          .send({ token: "invalid-token" })
          .expect(401);
        expect(response.body.success).toBe(false);
      }));
    it("should verify email with valid token", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const validToken = jsonwebtoken_1.default.sign(
          {
            userId: testUser.id,
            email: testUser.email,
            type: "email_verification",
          },
          config_1.default.jwt.secret,
          { expiresIn: "24h" }
        );
        const response = yield (0, supertest_1.default)(api_1.default)
          .post("/auth/verify-email")
          .send({ token: validToken })
          .expect(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain("verified");
      }));
    it("should return already verified for re-verification", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const validToken = jsonwebtoken_1.default.sign(
          {
            userId: testUser.id,
            email: testUser.email,
            type: "email_verification",
          },
          config_1.default.jwt.secret,
          { expiresIn: "24h" }
        );
        const response = yield (0, supertest_1.default)(api_1.default)
          .post("/auth/verify-email")
          .send({ token: validToken })
          .expect(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain("already verified");
      }));
    it("should reject token with wrong type", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const wrongTypeToken = jsonwebtoken_1.default.sign(
          {
            userId: testUser.id,
            email: testUser.email,
            type: "password_reset",
          },
          config_1.default.jwt.secret,
          { expiresIn: "1h" }
        );
        const response = yield (0, supertest_1.default)(api_1.default)
          .post("/auth/verify-email")
          .send({ token: wrongTypeToken })
          .expect(401);
        expect(response.body.success).toBe(false);
      }));
  });
  // ─── GET /auth/verify-email ─────────────────────────────────────
  describe("GET /auth/verify-email", () => {
    it("should return 400 when token query param is missing", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const response = yield (0, supertest_1.default)(api_1.default)
          .get("/auth/verify-email")
          .expect(400);
        expect(response.body.success).toBe(false);
      }));
  });
  // ─── POST /auth/send-verification ───────────────────────────────
  describe("POST /auth/send-verification", () => {
    it("should return 400 when userId is missing", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const response = yield (0, supertest_1.default)(api_1.default)
          .post("/auth/send-verification")
          .send({})
          .expect(400);
        expect(response.body.success).toBe(false);
      }));
    it("should return 404 for non-existent user", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const response = yield (0, supertest_1.default)(api_1.default)
          .post("/auth/send-verification")
          .send({ userId: "00000000-0000-0000-0000-000000000000" })
          .expect(404);
        expect(response.body.success).toBe(false);
      }));
  });
});
