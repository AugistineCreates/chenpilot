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
const agentClient_1 = require("../../packages/sdk/src/agentClient");
const types_1 = require("../../packages/sdk/src/types");
describe("AgentClient idempotency", () => {
  const swapRequest = {
    fromChain: types_1.ChainId.BITCOIN,
    toChain: types_1.ChainId.STELLAR,
    fromToken: "BTC",
    toToken: "XLM",
    amount: "0.01",
    destinationAddress: "GDSTELLARDESTINATION",
  };
  it("generates deterministic fingerprint regardless of payload key order", () => {
    const keyA = (0, agentClient_1.generateIdempotencyKey)({
      namespace: "swap-btc-stellar",
      payload: {
        a: 1,
        b: { z: 2, y: [3, 4] },
      },
      clientRequestId: "req-123",
    });
    const keyB = (0, agentClient_1.generateIdempotencyKey)({
      namespace: "swap-btc-stellar",
      payload: {
        b: { y: [3, 4], z: 2 },
        a: 1,
      },
      clientRequestId: "req-123",
    });
    expect(keyA).toBe(keyB);
  });
  it("reuses the same idempotency key across timeout/network retries", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const capturedHeaders = [];
      const stableKey = (0, agentClient_1.createBtcToStellarSwapIdempotencyKey)(
        swapRequest,
        "client-retry-id"
      );
      let calls = 0;
      const client = new agentClient_1.AgentClient({
        baseUrl: "http://localhost:3000",
        defaultRetryDelayMs: 0,
        fetchFn: (_url, init) =>
          __awaiter(void 0, void 0, void 0, function* () {
            capturedHeaders.push(
              init === null || init === void 0 ? void 0 : init.headers
            );
            calls += 1;
            if (calls === 1) {
              throw new TypeError("network error");
            }
            if (calls === 2) {
              return {
                ok: false,
                status: 503,
                json: () =>
                  __awaiter(void 0, void 0, void 0, function* () {
                    return { result: {} };
                  }),
                text: () =>
                  __awaiter(void 0, void 0, void 0, function* () {
                    return "temporary unavailable";
                  }),
              };
            }
            return {
              ok: true,
              status: 200,
              json: () =>
                __awaiter(void 0, void 0, void 0, function* () {
                  return { result: { success: true, message: "ok" } };
                }),
              text: () =>
                __awaiter(void 0, void 0, void 0, function* () {
                  return "";
                }),
            };
          }),
      });
      const result = yield client.executeBtcToStellarSwap(swapRequest, {
        userId: "user-1",
        idempotencyKey: stableKey,
        maxRetries: 3,
      });
      expect(result.idempotencyKey).toBe(stableKey);
      expect(result.attempts).toBe(3);
      expect(capturedHeaders).toHaveLength(3);
      for (const headers of capturedHeaders) {
        expect(
          headers === null || headers === void 0
            ? void 0
            : headers["Idempotency-Key"]
        ).toBe(stableKey);
      }
    }));
  it("surfaces idempotency key when retries are exhausted", () =>
    __awaiter(void 0, void 0, void 0, function* () {
      const providedKey = "swap-btc-stellar:fingerprint:req-999";
      const client = new agentClient_1.AgentClient({
        baseUrl: "http://localhost:3000",
        defaultRetryDelayMs: 0,
        fetchFn: () =>
          __awaiter(void 0, void 0, void 0, function* () {
            throw new TypeError("network disconnected");
          }),
      });
      yield expect(
        client.executeBtcToStellarSwap(swapRequest, {
          userId: "user-1",
          idempotencyKey: providedKey,
          maxRetries: 2,
        })
      ).rejects.toMatchObject({
        name: "AgentRequestError",
        idempotencyKey: providedKey,
        attempts: 2,
      });
    }));
});
