"use strict";
/**
 * Horizon Client for Stellar API interactions with cursor-based pagination support
 */
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
var __await =
  (this && this.__await) ||
  function (v) {
    return this instanceof __await ? ((this.v = v), this) : new __await(v);
  };
var __asyncGenerator =
  (this && this.__asyncGenerator) ||
  function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator)
      throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []),
      i,
      q = [];
    return (
      (i = Object.create(
        (typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype
      )),
      verb("next"),
      verb("throw"),
      verb("return", awaitReturn),
      (i[Symbol.asyncIterator] = function () {
        return this;
      }),
      i
    );
    function awaitReturn(f) {
      return function (v) {
        return Promise.resolve(v).then(f, reject);
      };
    }
    function verb(n, f) {
      if (g[n]) {
        i[n] = function (v) {
          return new Promise(function (a, b) {
            q.push([n, v, a, b]) > 1 || resume(n, v);
          });
        };
        if (f) i[n] = f(i[n]);
      }
    }
    function resume(n, v) {
      try {
        step(g[n](v));
      } catch (e) {
        settle(q[0][3], e);
      }
    }
    function step(r) {
      r.value instanceof __await
        ? Promise.resolve(r.value.v).then(fulfill, reject)
        : settle(q[0][2], r);
    }
    function fulfill(value) {
      resume("next", value);
    }
    function reject(value) {
      resume("throw", value);
    }
    function settle(f, v) {
      if ((f(v), q.shift(), q.length)) resume(q[0][0], q[0][1]);
    }
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.HorizonClient = void 0;
/**
 * Horizon Client for accessing Stellar Horizon API with cursor-based pagination
 */
class HorizonClient {
  constructor(options = {}) {
    var _a, _b;
    this.baseUrl =
      (_a = options.baseUrl) !== null && _a !== void 0
        ? _a
        : "https://horizon.stellar.org";
    this.fetch =
      (_b = options.fetchFn) !== null && _b !== void 0 ? _b : globalThis.fetch;
    this.timeout = options.timeout;
  }
  /**
   * Fetch account offers with cursor-based pagination
   * @param accountId - The account ID to fetch offers for
   * @param options - Pagination options (cursor and limit)
   * @returns Paginated response with account offers
   */
  getAccountOffers(accountId, options) {
    return __awaiter(this, void 0, void 0, function* () {
      var _a, _b, _c, _d, _e, _f, _g, _h, _j;
      const params = new URLSearchParams();
      if (options === null || options === void 0 ? void 0 : options.cursor) {
        params.append("cursor", options.cursor);
      }
      if (options === null || options === void 0 ? void 0 : options.limit) {
        // Horizon API has a maximum limit of 200
        params.append("limit", Math.min(options.limit, 200).toString());
      } else {
        // Default limit
        params.append("limit", "50");
      }
      const url = `${this.baseUrl}/accounts/${accountId}/offers?${params.toString()}`;
      const signal = this.timeout
        ? AbortSignal.timeout(this.timeout)
        : undefined;
      const response = yield this.fetch(url, { signal });
      if (!response.ok) {
        const errorText = yield response.text();
        throw new Error(
          `Failed to fetch account offers: ${response.status} ${errorText}`
        );
      }
      const data = yield response.json();
      // Extract next and previous cursors from Horizon links
      let nextCursor;
      let prevCursor;
      if (
        (_b =
          (_a = data._links) === null || _a === void 0 ? void 0 : _a.next) ===
          null || _b === void 0
          ? void 0
          : _b.href
      ) {
        const nextUrl = new URL(data._links.next.href);
        nextCursor =
          (_c = nextUrl.searchParams.get("cursor")) !== null && _c !== void 0
            ? _c
            : undefined;
      }
      if (
        (_e =
          (_d = data._links) === null || _d === void 0 ? void 0 : _d.prev) ===
          null || _e === void 0
          ? void 0
          : _e.href
      ) {
        const prevUrl = new URL(data._links.prev.href);
        prevCursor =
          (_f = prevUrl.searchParams.get("cursor")) !== null && _f !== void 0
            ? _f
            : undefined;
      }
      const records =
        (_j =
          (_h =
            (_g = data._embedded) === null || _g === void 0
              ? void 0
              : _g.records) !== null && _h !== void 0
            ? _h
            : data.records) !== null && _j !== void 0
          ? _j
          : [];
      return {
        records,
        nextCursor,
        prevCursor,
      };
    });
  }
  /**
   * Async iterator for iterating through all account offers
   * Automatically handles pagination using cursors
   * @param accountId - The account ID to fetch offers for
   * @param pageSize - Number of records per page (default: 50, max: 200)
   */
  iterateAccountOffers(accountId_1) {
    return __asyncGenerator(
      this,
      arguments,
      function* iterateAccountOffers_1(accountId, pageSize = 50) {
        let cursor;
        let hasMore = true;
        while (hasMore) {
          const page = yield __await(
            this.getAccountOffers(accountId, {
              cursor,
              limit: pageSize,
            })
          );
          for (const record of page.records) {
            yield yield __await(record);
          }
          if (!page.nextCursor) {
            hasMore = false;
          } else {
            cursor = page.nextCursor;
          }
        }
      }
    );
  }
}
exports.HorizonClient = HorizonClient;
