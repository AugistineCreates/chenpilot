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
var __asyncValues =
  (this && this.__asyncValues) ||
  function (o) {
    if (!Symbol.asyncIterator)
      throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator],
      i;
    return m
      ? m.call(o)
      : ((o =
          typeof __values === "function" ? __values(o) : o[Symbol.iterator]()),
        (i = {}),
        verb("next"),
        verb("throw"),
        verb("return"),
        (i[Symbol.asyncIterator] = function () {
          return this;
        }),
        i);
    function verb(n) {
      i[n] =
        o[n] &&
        function (v) {
          return new Promise(function (resolve, reject) {
            ((v = o[n](v)), settle(resolve, reject, v.done, v.value));
          });
        };
    }
    function settle(resolve, reject, d, v) {
      Promise.resolve(v).then(function (v) {
        resolve({ value: v, done: d });
      }, reject);
    }
  };
Object.defineProperty(exports, "__esModule", { value: true });
const horizonClient_1 = require("../horizonClient");
// Mock fetch function
const createMockFetch = (responses) => {
  return (url) =>
    __awaiter(void 0, void 0, void 0, function* () {
      const key = url.split("?")[0]; // Get base URL without query params
      const data = responses.get(key);
      if (!data) {
        return {
          ok: false,
          status: 404,
          json: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              return {};
            }),
          text: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              return "Not found";
            }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: () =>
          __awaiter(void 0, void 0, void 0, function* () {
            return data;
          }),
        text: () =>
          __awaiter(void 0, void 0, void 0, function* () {
            return JSON.stringify(data);
          }),
      };
    });
};
describe("HorizonClient", () => {
  describe("getAccountOffers", () => {
    it("should fetch account offers with default pagination", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockOffers = [
          {
            id: "1",
            paging_token: "token1",
            seller: "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J",
            selling: { asset_type: "native" },
            buying: {
              asset_type: "credit_alphanum4",
              asset_code: "USD",
              asset_issuer:
                "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYK536QOXYUKQ7NRXVGD7YDPFH",
            },
            amount: "100.00",
            price_r: { n: 1, d: 1 },
            price: "1.0000",
            last_modified_ledger: 123456,
            last_modified_time: "2025-01-01T00:00:00Z",
          },
        ];
        const mockResponse = {
          _links: {
            self: {
              href: "https://horizon.stellar.org/accounts/GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J/offers?limit=50",
            },
            next: {
              href: "https://horizon.stellar.org/accounts/GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J/offers?limit=50&cursor=token1",
            },
          },
          _embedded: {
            records: mockOffers,
          },
        };
        const mockResponses = new Map([
          [
            "https://horizon.stellar.org/accounts/GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J/offers",
            mockResponse,
          ],
        ]);
        const client = new horizonClient_1.HorizonClient({
          baseUrl: "https://horizon.stellar.org",
          fetchFn: createMockFetch(mockResponses),
        });
        const result = yield client.getAccountOffers(
          "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J"
        );
        expect(result.records).toHaveLength(1);
        expect(result.records[0].id).toBe("1");
        expect(result.nextCursor).toBe("token1");
        expect(result.prevCursor).toBeUndefined();
      }));
    it("should support cursor-based pagination", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockOffers1 = [
          {
            id: "1",
            paging_token: "token1",
            seller: "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J",
            selling: { asset_type: "native" },
            buying: {
              asset_type: "credit_alphanum4",
              asset_code: "USD",
              asset_issuer:
                "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYK536QOXYUKQ7NRXVGD7YDPFH",
            },
            amount: "100.00",
            price_r: { n: 1, d: 1 },
            price: "1.0000",
            last_modified_ledger: 123456,
            last_modified_time: "2025-01-01T00:00:00Z",
          },
        ];
        const mockOffers2 = [
          {
            id: "2",
            paging_token: "token2",
            seller: "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J",
            selling: { asset_type: "native" },
            buying: {
              asset_type: "credit_alphanum4",
              asset_code: "EUR",
              asset_issuer:
                "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYK536QOXYUKQ7NRXVGD7YDPFH",
            },
            amount: "200.00",
            price_r: { n: 2, d: 1 },
            price: "2.0000",
            last_modified_ledger: 123457,
            last_modified_time: "2025-01-01T01:00:00Z",
          },
        ];
        const mockResponses = new Map([
          [
            "https://horizon.stellar.org/accounts/GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J/offers",
            {
              _links: {
                self: {
                  href: "https://horizon.stellar.org/accounts/GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J/offers?limit=10",
                },
                next: {
                  href: "https://horizon.stellar.org/accounts/GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J/offers?limit=10&cursor=token1",
                },
              },
              _embedded: { records: mockOffers1 },
            },
          ],
        ]);
        const client = new horizonClient_1.HorizonClient({
          baseUrl: "https://horizon.stellar.org",
          fetchFn: (url) =>
            __awaiter(void 0, void 0, void 0, function* () {
              if (url.includes("cursor=token1")) {
                return {
                  ok: true,
                  status: 200,
                  json: () =>
                    __awaiter(void 0, void 0, void 0, function* () {
                      return {
                        _links: {
                          self: {
                            href: "https://horizon.stellar.org/accounts/GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J/offers?limit=10&cursor=token1",
                          },
                          prev: {
                            href: "https://horizon.stellar.org/accounts/GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J/offers?limit=10",
                          },
                        },
                        _embedded: { records: mockOffers2 },
                      };
                    }),
                  text: () =>
                    __awaiter(void 0, void 0, void 0, function* () {
                      return "";
                    }),
                };
              }
              const baseData = mockResponses.get(url.split("?")[0]);
              return {
                ok: true,
                status: 200,
                json: () =>
                  __awaiter(void 0, void 0, void 0, function* () {
                    return baseData;
                  }),
                text: () =>
                  __awaiter(void 0, void 0, void 0, function* () {
                    return JSON.stringify(baseData);
                  }),
              };
            }),
        });
        const firstPage = yield client.getAccountOffers(
          "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J",
          { limit: 10 }
        );
        expect(firstPage.records).toHaveLength(1);
        expect(firstPage.records[0].id).toBe("1");
        expect(firstPage.nextCursor).toBe("token1");
        if (firstPage.nextCursor) {
          const secondPage = yield client.getAccountOffers(
            "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J",
            { cursor: firstPage.nextCursor, limit: 10 }
          );
          expect(secondPage.records).toHaveLength(1);
          expect(secondPage.records[0].id).toBe("2");
          expect(secondPage.prevCursor).toBeUndefined();
        }
      }));
    it("should respect limit parameter and cap at 200", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockResponse = {
          _links: {
            self: { href: "https://horizon.stellar.org/accounts/test/offers" },
          },
          _embedded: { records: [] },
        };
        let capturedUrl = "";
        const client = new horizonClient_1.HorizonClient({
          baseUrl: "https://horizon.stellar.org",
          fetchFn: (url) =>
            __awaiter(void 0, void 0, void 0, function* () {
              capturedUrl = url;
              return {
                ok: true,
                status: 200,
                json: () =>
                  __awaiter(void 0, void 0, void 0, function* () {
                    return mockResponse;
                  }),
                text: () =>
                  __awaiter(void 0, void 0, void 0, function* () {
                    return JSON.stringify(mockResponse);
                  }),
              };
            }),
        });
        // Request with limit > 200 should be capped at 200
        yield client.getAccountOffers(
          "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J",
          {
            limit: 500,
          }
        );
        expect(capturedUrl).toContain("limit=200");
        // Request with limit < 200 should use that limit
        yield client.getAccountOffers(
          "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J",
          {
            limit: 75,
          }
        );
        expect(capturedUrl).toContain("limit=75");
      }));
    it("should use default limit of 50 when not specified", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const mockResponse = {
          _links: {
            self: { href: "https://horizon.stellar.org/accounts/test/offers" },
          },
          _embedded: { records: [] },
        };
        let capturedUrl = "";
        const client = new horizonClient_1.HorizonClient({
          baseUrl: "https://horizon.stellar.org",
          fetchFn: (url) =>
            __awaiter(void 0, void 0, void 0, function* () {
              capturedUrl = url;
              return {
                ok: true,
                status: 200,
                json: () =>
                  __awaiter(void 0, void 0, void 0, function* () {
                    return mockResponse;
                  }),
                text: () =>
                  __awaiter(void 0, void 0, void 0, function* () {
                    return JSON.stringify(mockResponse);
                  }),
              };
            }),
        });
        yield client.getAccountOffers(
          "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J"
        );
        expect(capturedUrl).toContain("limit=50");
      }));
    it("should throw error on failed request", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        const client = new horizonClient_1.HorizonClient({
          baseUrl: "https://horizon.stellar.org",
          fetchFn: () =>
            __awaiter(void 0, void 0, void 0, function* () {
              return {
                ok: false,
                status: 404,
                json: () =>
                  __awaiter(void 0, void 0, void 0, function* () {
                    return {};
                  }),
                text: () =>
                  __awaiter(void 0, void 0, void 0, function* () {
                    return "Not found";
                  }),
              };
            }),
        });
        yield expect(
          client.getAccountOffers(
            "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J"
          )
        ).rejects.toThrow("Failed to fetch account offers");
      }));
  });
  describe("iterateAccountOffers", () => {
    it("should iterate through offers using async generator", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a, e_1, _b, _c;
        const mockOffers1 = Array.from({ length: 3 }, (_, i) => ({
          id: `${i + 1}`,
          paging_token: `token${i + 1}`,
          seller: "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J",
          selling: { asset_type: "native" },
          buying: {
            asset_type: "credit_alphanum4",
            asset_code: "USD",
            asset_issuer:
              "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYK536QOXYUKQ7NRXVGD7YDPFH",
          },
          amount: "100.00",
          price_r: { n: 1, d: 1 },
          price: "1.0000",
          last_modified_ledger: 123456 + i,
          last_modified_time: "2025-01-01T00:00:00Z",
        }));
        const mockOffers2 = Array.from({ length: 2 }, (_, i) => ({
          id: `${i + 4}`,
          paging_token: `token${i + 4}`,
          seller: "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J",
          selling: { asset_type: "native" },
          buying: {
            asset_type: "credit_alphanum4",
            asset_code: "EUR",
            asset_issuer:
              "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYK536QOXYUKQ7NRXVGD7YDPFH",
          },
          amount: "200.00",
          price_r: { n: 2, d: 1 },
          price: "2.0000",
          last_modified_ledger: 123460,
          last_modified_time: "2025-01-01T01:00:00Z",
        }));
        const client = new horizonClient_1.HorizonClient({
          baseUrl: "https://horizon.stellar.org",
          fetchFn: (url) =>
            __awaiter(void 0, void 0, void 0, function* () {
              if (url.includes("cursor=token3")) {
                return {
                  ok: true,
                  status: 200,
                  json: () =>
                    __awaiter(void 0, void 0, void 0, function* () {
                      return {
                        _links: {
                          self: { href: url },
                          prev: { href: "https://horizon.stellar.org/..." },
                        },
                        _embedded: { records: mockOffers2 },
                      };
                    }),
                  text: () =>
                    __awaiter(void 0, void 0, void 0, function* () {
                      return "";
                    }),
                };
              }
              return {
                ok: true,
                status: 200,
                json: () =>
                  __awaiter(void 0, void 0, void 0, function* () {
                    return {
                      _links: {
                        self: { href: url },
                        next: {
                          href: "https://horizon.stellar.org/accounts/GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J/offers?limit=3&cursor=token3",
                        },
                      },
                      _embedded: { records: mockOffers1 },
                    };
                  }),
                text: () =>
                  __awaiter(void 0, void 0, void 0, function* () {
                    return "";
                  }),
              };
            }),
        });
        const offers = [];
        try {
          for (
            var _d = true,
              _e = __asyncValues(
                client.iterateAccountOffers(
                  "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J",
                  3
                )
              ),
              _f;
            (_f = yield _e.next()), (_a = _f.done), !_a;
            _d = true
          ) {
            _c = _f.value;
            _d = false;
            const offer = _c;
            offers.push(offer);
          }
        } catch (e_1_1) {
          e_1 = { error: e_1_1 };
        } finally {
          try {
            if (!_d && !_a && (_b = _e.return)) yield _b.call(_e);
          } finally {
            if (e_1) throw e_1.error;
          }
        }
        expect(offers).toHaveLength(5);
        expect(offers[0].id).toBe("1");
        expect(offers[4].id).toBe("5");
      }));
    it("should use default page size of 50 when not specified", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        var _a, e_2, _b, _c;
        let capturedUrl = "";
        const client = new horizonClient_1.HorizonClient({
          baseUrl: "https://horizon.stellar.org",
          fetchFn: (url) =>
            __awaiter(void 0, void 0, void 0, function* () {
              capturedUrl = url;
              return {
                ok: true,
                status: 200,
                json: () =>
                  __awaiter(void 0, void 0, void 0, function* () {
                    return {
                      _links: { self: { href: url } },
                      _embedded: { records: [] },
                    };
                  }),
                text: () =>
                  __awaiter(void 0, void 0, void 0, function* () {
                    return "";
                  }),
              };
            }),
        });
        try {
          for (
            var _d = true,
              _e = __asyncValues(
                client.iterateAccountOffers(
                  "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J"
                )
              ),
              _f;
            (_f = yield _e.next()), (_a = _f.done), !_a;
            _d = true
          ) {
            _c = _f.value;
            _d = false;
            const _offer = _c;
            // Just iterate once to verify pagination setup
            void _offer; // Use the variable to satisfy ESLint
            break;
          }
        } catch (e_2_1) {
          e_2 = { error: e_2_1 };
        } finally {
          try {
            if (!_d && !_a && (_b = _e.return)) yield _b.call(_e);
          } finally {
            if (e_2) throw e_2.error;
          }
        }
        expect(capturedUrl).toContain("limit=50");
      }));
  });
  describe("custom fetch function", () => {
    it("should use custom fetch function if provided", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        let fetchCalled = false;
        const customFetch = () =>
          __awaiter(void 0, void 0, void 0, function* () {
            fetchCalled = true;
            return {
              ok: true,
              status: 200,
              json: () =>
                __awaiter(void 0, void 0, void 0, function* () {
                  return {
                    _links: { self: { href: "" } },
                    _embedded: { records: [] },
                  };
                }),
              text: () =>
                __awaiter(void 0, void 0, void 0, function* () {
                  return "";
                }),
            };
          });
        const client = new horizonClient_1.HorizonClient({
          baseUrl: "https://horizon.stellar.org",
          fetchFn: customFetch,
        });
        yield client.getAccountOffers(
          "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J"
        );
        expect(fetchCalled).toBe(true);
      }));
  });
  describe("default base URL", () => {
    it("should use public Horizon server by default", () =>
      __awaiter(void 0, void 0, void 0, function* () {
        let capturedUrl = "";
        const client = new horizonClient_1.HorizonClient({
          fetchFn: (url) =>
            __awaiter(void 0, void 0, void 0, function* () {
              capturedUrl = url;
              return {
                ok: true,
                status: 200,
                json: () =>
                  __awaiter(void 0, void 0, void 0, function* () {
                    return {
                      _links: { self: { href: url } },
                      _embedded: { records: [] },
                    };
                  }),
                text: () =>
                  __awaiter(void 0, void 0, void 0, function* () {
                    return "";
                  }),
              };
            }),
        });
        yield client.getAccountOffers(
          "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J"
        );
        expect(capturedUrl).toContain("https://horizon.stellar.org");
      }));
  });
});
