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
const api_1 = __importDefault(require("../../src/Gateway/api"));
const Datasource_1 = __importDefault(require("../../src/config/Datasource"));
const user_entity_1 = require("../../src/Auth/user.entity");
describe("POST /signup", () => {
  beforeEach(() =>
    __awaiter(void 0, void 0, void 0, function* () {
      const userRepository = Datasource_1.default.getRepository(
        user_entity_1.User
      );
      yield userRepository.clear();
    })
  );
  it("should create a new user with valid name", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const response = yield (0, supertest_1.default)(api_1.default)
        .post("/signup")
        .send({ name: "testuser" })
        .expect(201);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe("User created successfully");
      expect(response.body.data).toHaveProperty("id");
      expect(response.body.data.name).toBe("testuser");
      expect(response.body.data.address).toMatch(/^G/);
      expect(response.body.data.tokenType).toBe("XLM");
      expect(response.body.data).toHaveProperty("createdAt");
      expect(response.body.data).not.toHaveProperty("encryptedPrivateKey");
    }));
  it("should return 400 when name is missing", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const response = yield (0, supertest_1.default)(api_1.default)
        .post("/signup")
        .send({})
        .expect(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("required");
    }));
  it("should return 400 when name is too short", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const response = yield (0, supertest_1.default)(api_1.default)
        .post("/signup")
        .send({ name: "ab" })
        .expect(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("3");
    }));
  it("should return 400 when name is too long", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const longName = "a".repeat(51);
      const response = yield (0, supertest_1.default)(api_1.default)
        .post("/signup")
        .send({ name: longName })
        .expect(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("50");
    }));
  it("should return 400 when name contains invalid characters", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const response = yield (0, supertest_1.default)(api_1.default)
        .post("/signup")
        .send({ name: "test@user!" })
        .expect(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("alphanumeric");
    }));
  it("should return 409 when username already exists", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      // Create first user
      yield (0, supertest_1.default)(api_1.default)
        .post("/signup")
        .send({ name: "duplicateuser" })
        .expect(201);
      // Try to create duplicate
      const response = yield (0, supertest_1.default)(api_1.default)
        .post("/signup")
        .send({ name: "duplicateuser" })
        .expect(409);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain("already exists");
    }));
  it("should store encrypted private key in database", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      yield (0, supertest_1.default)(api_1.default)
        .post("/signup")
        .send({ name: "encryptiontest" })
        .expect(201);
      const userRepository = Datasource_1.default.getRepository(
        user_entity_1.User
      );
      const user = yield userRepository.findOne({
        where: { name: "encryptiontest" },
      });
      expect(user).not.toBeNull();
      expect(user.encryptedPrivateKey).toBeDefined();
      expect(user.encryptedPrivateKey).not.toMatch(/^S/);
      expect(user.encryptedPrivateKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
    }));
});
