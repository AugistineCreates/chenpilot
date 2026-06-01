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
const express_1 = __importDefault(require("express"));
const supertest_1 = __importDefault(require("supertest"));
const mockVerifyAccessToken = jest.fn();
const mockProxyGet = jest.fn();
jest.mock("tsyringe", () => ({
  container: {
    resolve: () => ({
      verifyAccessToken: mockVerifyAccessToken,
    }),
  },
}));
jest.mock("../../src/config/logger", () => ({
  __esModule: true,
  default: {
    warn: jest.fn(),
  },
}));
class MockHorizonProxyError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = "HorizonProxyError";
    this.statusCode = statusCode;
  }
}
jest.mock("../../src/Gateway/horizonProxy.service", () => ({
  horizonProxyService: {
    proxyGet: mockProxyGet,
  },
  HorizonProxyError: MockHorizonProxyError,
}));
const horizonProxy_routes_1 = __importDefault(
  require("../../src/Gateway/horizonProxy.routes")
);
describe("Horizon Proxy Routes", () => {
  const app = (0, express_1.default)();
  app.use("/horizon", horizonProxy_routes_1.default);
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyAccessToken.mockReturnValue({
      userId: "user-1",
      name: "tester",
      role: "user",
    });
  });
  it("returns 401 when access token is missing", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const response = yield (0, supertest_1.default)(app)
        .get("/horizon/proxy")
        .query({ path: "/accounts/GABCDEFGHIJKLMNOPQRSTUVWX1234567890ABCDEF" });
      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    }));
  it("returns proxied data for authenticated requests", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      mockProxyGet.mockResolvedValue({ records: [] });
      const response = yield (0, supertest_1.default)(app)
        .get("/horizon/proxy")
        .set("Authorization", "Bearer valid-token")
        .query({
          path: "/accounts/GABCDEFGHIJKLMNOPQRSTUVWX1234567890ABCDEF",
          limit: "20",
        });
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({ records: [] });
      expect(mockProxyGet).toHaveBeenCalledWith(
        "/accounts/GABCDEFGHIJKLMNOPQRSTUVWX1234567890ABCDEF",
        { limit: "20" }
      );
    }));
  it("maps HorizonProxyError status codes", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      mockProxyGet.mockRejectedValue(
        new MockHorizonProxyError(
          "Requested Horizon path is not allowlisted",
          403
        )
      );
      const response = yield (0, supertest_1.default)(app)
        .get("/horizon/proxy")
        .set("Authorization", "Bearer valid-token")
        .query({ path: "/friendbot" });
      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe(
        "Requested Horizon path is not allowlisted"
      );
    }));
});
