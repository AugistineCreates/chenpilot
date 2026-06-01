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
exports.AgentClient = exports.AgentRequestError = void 0;
exports.generateIdempotencyKey = generateIdempotencyKey;
exports.createBtcToStellarSwapIdempotencyKey =
  createBtcToStellarSwapIdempotencyKey;
const crypto_1 = require("crypto");
const types_1 = require("./types");
/** Error thrown when an agent request fails after all retries */
class AgentRequestError extends Error {
  constructor(message, idempotencyKey, attempts, statusCode) {
    super(message);
    this.name = "AgentRequestError";
    this.idempotencyKey = idempotencyKey;
    this.attempts = attempts;
    this.statusCode = statusCode;
  }
}
exports.AgentRequestError = AgentRequestError;
const RETRIABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const obj = value;
  return Object.keys(obj)
    .sort()
    .reduce((acc, key) => {
      acc[key] = canonicalize(obj[key]);
      return acc;
    }, {});
}
/**
 * Generates universally unique string determining an idempotent request based on its data payload.
 *
 * @param input - The payload and namespace for the key.
 * @returns The generated idempotency key.
 */
function generateIdempotencyKey({ namespace, payload, clientRequestId }) {
  const fingerprint = (0, crypto_1.createHash)("sha256")
    .update(JSON.stringify(canonicalize(payload)))
    .digest("hex")
    .slice(0, 24);
  const requestId =
    clientRequestId !== null && clientRequestId !== void 0
      ? clientRequestId
      : (0, crypto_1.randomUUID)();
  return `${namespace}:${fingerprint}:${requestId}`;
}
/**
 * Specific idempotency key generator for BTC-Stellar swaps.
 *
 * @param request - The swap request payload.
 * @param clientRequestId - Optional client-provided request ID.
 * @returns The generated idempotency key.
 */
function createBtcToStellarSwapIdempotencyKey(request, clientRequestId) {
  return generateIdempotencyKey({
    namespace: "swap-btc-stellar",
    payload: request,
    clientRequestId,
  });
}
function toSwapQuery(request) {
  return [
    `Swap ${request.amount} ${request.fromToken}`,
    `from ${request.fromChain}`,
    `to ${request.toToken} on ${request.toChain}`,
    `for destination ${request.destinationAddress}`,
  ].join(" ");
}
function createTimedSignal(timeoutMs, externalSignal) {
  var _a;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      (_a = externalSignal.addEventListener) === null || _a === void 0
        ? void 0
        : _a.call(externalSignal, "abort", () => controller.abort(), {
            once: true,
          });
    }
  }
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}
/**
 * Client for interacting with the Chen Pilot AI Agent backend.
 * Provides resilient querying with retries and timeout controls.
 */
class AgentClient {
  constructor(options) {
    var _a, _b, _c, _d;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.defaultTimeoutMs =
      (_a = options.defaultTimeoutMs) !== null && _a !== void 0 ? _a : 15000;
    this.defaultMaxRetries =
      (_b = options.defaultMaxRetries) !== null && _b !== void 0 ? _b : 3;
    this.defaultRetryDelayMs =
      (_c = options.defaultRetryDelayMs) !== null && _c !== void 0 ? _c : 500;
    const runtimeFetch = globalThis.fetch;
    const selectedFetch =
      (_d = options.fetchFn) !== null && _d !== void 0 ? _d : runtimeFetch;
    if (!selectedFetch) {
      throw new Error("No fetch implementation available for AgentClient");
    }
    this.fetchFn = selectedFetch;
  }
  /**
   * Sends a parameterized query to the AI Agent backend.
   *
   * @param request - The query parameters.
   * @returns A promise resolving to the agent's response.
   */
  query(request) {
    return __awaiter(this, void 0, void 0, function* () {
      var _a, _b, _c, _d;
      const idempotencyKey =
        (_a = request.idempotencyKey) !== null && _a !== void 0
          ? _a
          : generateIdempotencyKey({
              namespace: "agent-query",
              payload: {
                userId: request.userId,
                query: request.query,
              },
            });
      const maxRetries =
        (_b = request.maxRetries) !== null && _b !== void 0
          ? _b
          : this.defaultMaxRetries;
      const timeoutMs =
        (_c = request.timeoutMs) !== null && _c !== void 0
          ? _c
          : this.defaultTimeoutMs;
      const retryDelayMs =
        (_d = request.retryDelayMs) !== null && _d !== void 0
          ? _d
          : this.defaultRetryDelayMs;
      let attempts = 0;
      let lastErrorMessage = "Request failed";
      let lastStatusCode;
      while (attempts < maxRetries) {
        attempts += 1;
        const timedSignal = createTimedSignal(timeoutMs, request.signal);
        try {
          const response = yield this.fetchFn(`${this.baseUrl}/query`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": idempotencyKey,
            },
            body: JSON.stringify({
              userId: request.userId,
              query: request.query,
            }),
            signal: timedSignal.signal,
          });
          if (!response.ok) {
            lastStatusCode = response.status;
            const body = yield response.text().catch(() => "");
            const message = body || `HTTP ${response.status}`;
            if (
              !RETRIABLE_STATUS_CODES.has(response.status) ||
              attempts >= maxRetries
            ) {
              throw new AgentRequestError(
                `Agent query failed: ${message}`,
                idempotencyKey,
                attempts,
                response.status
              );
            }
            lastErrorMessage = `Agent query failed: ${message}`;
            yield sleep(retryDelayMs * attempts);
            continue;
          }
          const parsed = yield response.json();
          return {
            idempotencyKey,
            attempts,
            result: parsed.result,
          };
        } catch (error) {
          const isAbort =
            error instanceof Error &&
            (error.name === "AbortError" || error.message.includes("aborted"));
          const isNetwork =
            error instanceof TypeError ||
            (error instanceof Error &&
              error.message.toLowerCase().includes("network"));
          if (error instanceof AgentRequestError) {
            throw error;
          }
          lastErrorMessage =
            error instanceof Error ? error.message : String(error);
          if (!(isAbort || isNetwork) || attempts >= maxRetries) {
            throw new AgentRequestError(
              `Agent query failed: ${lastErrorMessage}`,
              idempotencyKey,
              attempts,
              lastStatusCode
            );
          }
          yield sleep(retryDelayMs * attempts);
        } finally {
          timedSignal.clear();
        }
      }
      throw new AgentRequestError(
        `Agent query failed: ${lastErrorMessage}`,
        idempotencyKey,
        attempts,
        lastStatusCode
      );
    });
  }
  /**
   * High-level utility to request a cross-chain swap from BTC to Stellar.
   *
   * @param swapRequest - Details about the swap token pair and amount.
   * @param options - Execution options including signals and timeouts.
   * @returns A promise resolving to the swap execution response.
   */
  executeBtcToStellarSwap(swapRequest, options) {
    return __awaiter(this, void 0, void 0, function* () {
      var _a;
      if (
        swapRequest.fromChain !== types_1.ChainId.BITCOIN ||
        swapRequest.toChain !== types_1.ChainId.STELLAR
      ) {
        throw new Error(
          "executeBtcToStellarSwap only supports fromChain=bitcoin and toChain=stellar"
        );
      }
      const idempotencyKey =
        (_a = options.idempotencyKey) !== null && _a !== void 0
          ? _a
          : createBtcToStellarSwapIdempotencyKey(swapRequest);
      return this.query({
        userId: options.userId,
        query: toSwapQuery(swapRequest),
        idempotencyKey,
        timeoutMs: options.timeoutMs,
        maxRetries: options.maxRetries,
        retryDelayMs: options.retryDelayMs,
        signal: options.signal,
      });
    });
  }
}
exports.AgentClient = AgentClient;
