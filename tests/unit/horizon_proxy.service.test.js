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
Object.defineProperty(exports, "__esModule", { value: true });
const horizonProxy_service_1 = require("../../src/Gateway/horizonProxy.service");
describe("HorizonProxyService", () => {
  let service;
  let originalFetch;
  beforeAll(() => {
    originalFetch = global.fetch;
  });
  beforeEach(() => {
    service = new horizonProxy_service_1.HorizonProxyService();
    global.fetch = jest.fn();
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });
  it("rejects paths outside allowlist", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      yield expect(service.proxyGet("/friendbot", {})).rejects.toMatchObject({
        statusCode: 403,
        message: "Requested Horizon path is not allowlisted",
      });
    }));
  it("rejects forbidden query keys", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      yield expect(
        service.proxyGet(
          "/accounts/GABCDEFGHIJKLMNOPQRSTUVWX1234567890ABCDEF",
          {
            api_key: "secret",
          }
        )
      ).rejects.toMatchObject({
        statusCode: 400,
        message: "Forbidden query key: api_key",
      });
    }));
  it("proxies successful JSON GET requests", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const mockJson = { records: [{ id: "op-1" }] };
      global.fetch.mockResolvedValue({
        ok: true,
        headers: {
          get: () => "application/json",
        },
        json: () =>
          __awaiter(void 0, void 0, void 0, function* () {
            return mockJson;
          }),
        text: () =>
          __awaiter(void 0, void 0, void 0, function* () {
            return JSON.stringify(mockJson);
          }),
      });
      const result = yield service.proxyGet(
        "/accounts/GABCDEFGHIJKLMNOPQRSTUVWX1234567890ABCDEF/operations",
        {
          limit: "10",
          order: "desc",
        }
      );
      expect(result).toEqual(mockJson);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const calledUrl = global.fetch.mock.calls[0][0];
      expect(calledUrl).toContain(
        "/accounts/GABCDEFGHIJKLMNOPQRSTUVWX1234567890ABCDEF/operations"
      );
      expect(calledUrl).toContain("limit=10");
      expect(calledUrl).toContain("order=desc");
    }));
});
