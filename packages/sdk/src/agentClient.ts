import { createHash, randomUUID } from "crypto";
import { 
  AgentResponse, 
  ChainId, 
  CrossChainSwapRequest,
  RequestOptions,
  SimulationRequest,
  SimulationResult,
  ExecutionRequest,
  ExecutionResult,
  VaultOperationRequest,
  VaultOperationResult,
  AbortSignalLike,
} from "./types";

export interface IdempotencyKeyInput {
  namespace: string;
  payload: unknown;
  clientRequestId?: string;
}

export interface AgentClientOptions {
  baseUrl: string;
  defaultTimeoutMs?: number;
  defaultMaxRetries?: number;
  defaultRetryDelayMs?: number;
  fetchFn?: FetchLike;
}

interface AbortControllerLike {
  signal: AbortSignalLike;
  abort: () => void;
}

export interface AgentQueryRequest {
  userId: string;
  query: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  signal?: AbortSignalLike;
}

export interface AgentQueryResult<T = AgentResponse> {
  idempotencyKey: string;
  attempts: number;
  result: T;
}

export class AgentRequestError extends Error {
  readonly idempotencyKey: string;
  readonly attempts: number;
  readonly statusCode?: number;

  constructor(
    message: string,
    idempotencyKey: string,
    attempts: number,
    statusCode?: number
  ) {
    super(message);
    this.name = "AgentRequestError";
    this.idempotencyKey = idempotencyKey;
    this.attempts = attempts;
    this.statusCode = statusCode;
  }
}

interface QueryEnvelope<T = unknown> {
  result: T;
}

interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignalLike;
  }
) => Promise<FetchResponseLike>;

const RETRIABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const obj = value as Record<string, unknown>;
  return Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = canonicalize(obj[key]);
      return acc;
    }, {});
}

export function generateIdempotencyKey({
  namespace,
  payload,
  clientRequestId,
}: IdempotencyKeyInput): string {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)))
    .digest("hex")
    .slice(0, 24);

  const requestId = clientRequestId ?? randomUUID();
  return `${namespace}:${fingerprint}:${requestId}`;
}

export function createBtcToStellarSwapIdempotencyKey(
  request: CrossChainSwapRequest,
  clientRequestId?: string
): string {
  return generateIdempotencyKey({
    namespace: "swap-btc-stellar",
    payload: request,
    clientRequestId,
  });
}

function toSwapQuery(request: CrossChainSwapRequest): string {
  return [
    `Swap ${request.amount} ${request.fromToken}`,
    `from ${request.fromChain}`,
    `to ${request.toToken} on ${request.toChain}`,
    `for destination ${request.destinationAddress}`,
  ].join(" ");
}

function createTimedSignal(
  timeoutMs: number,
  externalSignal?: AbortSignalLike
) {
  const controller = new AbortController() as unknown as AbortControllerLike;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener?.("abort", () => controller.abort(), {
        once: true,
      });
    }
  }

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

export class AgentClient {
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxRetries: number;
  private readonly defaultRetryDelayMs: number;
  private readonly fetchFn: FetchLike;

  constructor(options: AgentClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 15_000;
    this.defaultMaxRetries = options.defaultMaxRetries ?? 3;
    this.defaultRetryDelayMs = options.defaultRetryDelayMs ?? 500;
    const runtimeFetch = (globalThis as unknown as { fetch?: FetchLike }).fetch;
    const selectedFetch = options.fetchFn ?? runtimeFetch;

    if (!selectedFetch) {
      throw new Error("No fetch implementation available for AgentClient");
    }

    this.fetchFn = selectedFetch;
  }

  async query<T = AgentResponse>(
    request: AgentQueryRequest
  ): Promise<AgentQueryResult<T>> {
    const idempotencyKey =
      request.idempotencyKey ??
      generateIdempotencyKey({
        namespace: "agent-query",
        payload: {
          userId: request.userId,
          query: request.query,
        },
      });

    const maxRetries = request.maxRetries ?? this.defaultMaxRetries;
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const retryDelayMs = request.retryDelayMs ?? this.defaultRetryDelayMs;

    let attempts = 0;
    let lastErrorMessage = "Request failed";
    let lastStatusCode: number | undefined;

    while (attempts < maxRetries) {
      attempts += 1;
      const timedSignal = createTimedSignal(timeoutMs, request.signal);

      try {
        const response = await this.fetchFn(`${this.baseUrl}/query`, {
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
          const body = await response.text().catch(() => "");
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
          await sleep(retryDelayMs * attempts);
          continue;
        }

        const parsed = (await response.json()) as QueryEnvelope<T>;
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

        await sleep(retryDelayMs * attempts);
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
  }

  async simulate(
    simulationRequest: SimulationRequest,
    options: RequestOptions
  ): Promise<AgentQueryResult<SimulationResult>> {
    const idempotencyKey =
      options.idempotencyKey ??
      generateIdempotencyKey({
        namespace: "simulation",
        payload: simulationRequest,
      });

    return this.query<SimulationResult>({
      userId: options.userId,
      query: JSON.stringify({ type: "simulate", data: simulationRequest }),
      idempotencyKey,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      retryDelayMs: options.retryDelayMs,
      signal: options.signal,
    });
  }

  async execute(
    executionRequest: ExecutionRequest,
    options: RequestOptions
  ): Promise<AgentQueryResult<ExecutionResult>> {
    const idempotencyKey =
      options.idempotencyKey ??
      generateIdempotencyKey({
        namespace: "execution",
        payload: executionRequest,
      });

    return this.query<ExecutionResult>({
      userId: options.userId,
      query: JSON.stringify({ type: "execute", data: executionRequest }),
      idempotencyKey,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      retryDelayMs: options.retryDelayMs,
      signal: options.signal,
    });
  }

  async vaultOperation(
    vaultRequest: VaultOperationRequest,
    options: RequestOptions
  ): Promise<AgentQueryResult<VaultOperationResult>> {
    const idempotencyKey =
      options.idempotencyKey ??
      generateIdempotencyKey({
        namespace: "vault-operation",
        payload: vaultRequest,
      });

    return this.query<VaultOperationResult>({
      userId: options.userId,
      query: JSON.stringify({ type: "vault", data: vaultRequest }),
      idempotencyKey,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      retryDelayMs: options.retryDelayMs,
      signal: options.signal,
    });
  }

  async executeBtcToStellarSwap<T = AgentResponse>(
    swapRequest: CrossChainSwapRequest,
    options: RequestOptions
  ): Promise<AgentQueryResult<T>> {
    if (
      swapRequest.fromChain !== ChainId.BITCOIN ||
      swapRequest.toChain !== ChainId.STELLAR
    ) {
      throw new Error(
        "executeBtcToStellarSwap only supports fromChain=bitcoin and toChain=stellar"
      );
    }

    const idempotencyKey =
      options.idempotencyKey ??
      createBtcToStellarSwapIdempotencyKey(swapRequest);

    return this.query<T>({
      userId: options.userId,
      query: toSwapQuery(swapRequest),
      idempotencyKey,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      retryDelayMs: options.retryDelayMs,
      signal: options.signal,
    });
  }
}
