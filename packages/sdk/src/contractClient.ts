import { SorobanNetwork } from "./types";

export type ContractFunctionKind = "query" | "simulate" | "execute";
export type ApprovalCheckpoint =
  | "none"
  | "fee"
  | "auth"
  | "policy"
  | "manual";

export interface ContractClientConfig {
  network: SorobanNetwork;
  rpcUrl?: string;
  fetcher?: typeof fetch;
  defaultIdempotencyKey?: string;
  compatibility?: CompatibilityPolicy;
}

export interface CompatibilityPolicy {
  minProtocolVersion?: number;
  maxProtocolVersion?: number;
  supportedNetworks?: SorobanNetwork[];
}

export interface ContractCall<Args extends readonly unknown[] = unknown[]> {
  contractId: string;
  method: string;
  args?: Args;
}

export interface QueryRequest<TDecoded = unknown> extends ContractCall {
  decoder?: ResultDecoder<TDecoded>;
}

export interface SimulationRequest<TDecoded = unknown> extends ContractCall {
  sourceAccount?: string;
  transactionXdr?: string;
  decoder?: ResultDecoder<TDecoded>;
}

export interface ExecuteRequest<TDecoded = unknown> extends ContractCall {
  signedTransactionXdr: string;
  idempotencyKey?: string;
  decoder?: ResultDecoder<TDecoded>;
}

export type ResultDecoder<T> = (value: unknown) => T;

export interface ContractResult<TDecoded> {
  raw: unknown;
  decoded: TDecoded;
  compatibility: CompatibilityReport;
}

export interface CompatibilityReport {
  network: SorobanNetwork;
  protocolVersion?: number;
  compatible: boolean;
  warnings: string[];
}

export interface FeeEstimate {
  minResourceFee: string | null;
  refundableFee: string | null;
  inclusionFee: string | null;
}

export interface SimulationWarning {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
}

export interface ApprovalRequirement {
  checkpoint: ApprovalCheckpoint;
  required: boolean;
  reason: string;
}

export interface SimulationResult<TDecoded> extends ContractResult<TDecoded> {
  feeEstimate: FeeEstimate;
  authEntries: unknown[];
  approvalRequirements: ApprovalRequirement[];
  warnings: SimulationWarning[];
  transactionDataXdr: string | null;
}

export interface ExecutionResult<TDecoded> extends ContractResult<TDecoded> {
  hash: string | null;
  status: "PENDING" | "SUCCESS" | "FAILED" | "UNKNOWN";
  idempotencyKey: string;
}

export interface ContractMethodSpec<
  Args extends readonly unknown[] = readonly unknown[],
  Result = unknown,
> {
  contractId: string;
  method: string;
  kind: ContractFunctionKind;
  decoder?: ResultDecoder<Result>;
}

export type ContractSpec = Record<string, ContractMethodSpec>;

export type ContractBinding<TSpec extends ContractSpec> = {
  [K in keyof TSpec]: TSpec[K] extends ContractMethodSpec<infer Args, infer Result>
    ? (...args: Args) => Promise<BindingResult<TSpec[K]["kind"], Result>>
    : never;
};

export type BindingResult<TKind, Result> = TKind extends "simulate"
  ? SimulationResult<Result>
  : TKind extends "execute"
    ? ExecutionResult<Result>
    : ContractResult<Result>;

interface JsonRpcResponse<T> {
  result?: T;
  error?: { code: number; message: string };
}

const DEFAULT_RPC_URLS: Record<SorobanNetwork, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://soroban-mainnet.stellar.org",
};

const identityDecoder = <T>(value: unknown): T => value as T;

export class ContractClient {
  private readonly network: SorobanNetwork;
  private readonly rpcUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly defaultIdempotencyKey?: string;
  private readonly compatibility?: CompatibilityPolicy;
  private protocolVersion?: number;

  constructor(config: ContractClientConfig) {
    if (config.network !== "testnet" && config.network !== "mainnet") {
      throw new Error(`Unsupported Soroban network: ${config.network}`);
    }

    this.network = config.network;
    this.rpcUrl = config.rpcUrl ?? DEFAULT_RPC_URLS[config.network];
    this.fetcher = config.fetcher ?? globalThis.fetch;
    this.defaultIdempotencyKey = config.defaultIdempotencyKey;
    this.compatibility = config.compatibility;
  }

  async query<TDecoded = unknown>(
    request: QueryRequest<TDecoded>
  ): Promise<ContractResult<TDecoded>> {
    this.validateCall(request);
    const raw = await this.rpc("getLedgerEntries", {
      keys: [this.ledgerEntryKey(request.contractId, request.method, request.args)],
    });
    return this.toContractResult(raw, request.decoder);
  }

  async simulate<TDecoded = unknown>(
    request: SimulationRequest<TDecoded>
  ): Promise<SimulationResult<TDecoded>> {
    this.validateCall(request);
    const raw = await this.rpc<Record<string, unknown>>("simulateTransaction", {
      transaction: request.transactionXdr,
      contractId: request.contractId,
      method: request.method,
      args: request.args ?? [],
      sourceAccount: request.sourceAccount,
    });

    const base = await this.toContractResult(raw, request.decoder);
    const authEntries = extractArray(raw, ["result", "auth"]);
    const feeEstimate = extractFeeEstimate(raw);
    const warnings = extractWarnings(raw);

    return {
      ...base,
      feeEstimate,
      authEntries,
      approvalRequirements: buildApprovalRequirements(
        feeEstimate,
        authEntries,
        warnings
      ),
      warnings,
      transactionDataXdr: extractString(raw, "transactionData") ?? null,
    };
  }

  async execute<TDecoded = unknown>(
    request: ExecuteRequest<TDecoded>
  ): Promise<ExecutionResult<TDecoded>> {
    this.validateCall(request);
    if (!request.signedTransactionXdr) {
      throw new Error("signedTransactionXdr is required for execution");
    }

    const idempotencyKey =
      request.idempotencyKey ??
      this.defaultIdempotencyKey ??
      createIdempotencyKey(request);

    const raw = await this.rpc<Record<string, unknown>>(
      "sendTransaction",
      { xdr: request.signedTransactionXdr },
      { "Idempotency-Key": idempotencyKey }
    );
    const base = await this.toContractResult(raw, request.decoder);

    return {
      ...base,
      hash: extractString(raw, "hash"),
      status: normalizeExecutionStatus(extractString(raw, "status")),
      idempotencyKey,
    };
  }

  bind<TSpec extends ContractSpec>(spec: TSpec): ContractBinding<TSpec> {
    const binding: Partial<Record<keyof TSpec, unknown>> = {};

    for (const name of Object.keys(spec) as Array<keyof TSpec>) {
      const methodSpec = spec[name];
      binding[name] = async (...args: unknown[]) => {
        const request = {
          contractId: methodSpec.contractId,
          method: methodSpec.method,
          args,
          decoder: methodSpec.decoder,
        };

        if (methodSpec.kind === "simulate") return this.simulate(request);
        if (methodSpec.kind === "execute") {
          throw new Error(
            "Bound execute methods require signedTransactionXdr; call client.execute directly."
          );
        }
        return this.query(request);
      };
    }

    return binding as ContractBinding<TSpec>;
  }

  private async toContractResult<TDecoded>(
    raw: unknown,
    decoder?: ResultDecoder<TDecoded>
  ): Promise<ContractResult<TDecoded>> {
    return {
      raw,
      decoded: (decoder ?? identityDecoder<TDecoded>)(extractReturnValue(raw)),
      compatibility: await this.checkCompatibility(),
    };
  }

  private async rpc<T>(
    method: string,
    params: unknown,
    headers: Record<string, string> = {}
  ): Promise<T> {
    const response = await this.fetcher(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });

    if (!response.ok) {
      throw new Error(`RPC HTTP ${response.status}: ${response.statusText}`);
    }

    const payload = (await response.json()) as JsonRpcResponse<T>;
    if (payload.error) {
      throw new Error(`RPC error ${payload.error.code}: ${payload.error.message}`);
    }
    if (payload.result === undefined) {
      throw new Error("RPC returned no result");
    }
    return payload.result;
  }

  private async checkCompatibility(): Promise<CompatibilityReport> {
    const warnings: string[] = [];
    const compatibleNetworks = this.compatibility?.supportedNetworks;
    let compatible = !compatibleNetworks || compatibleNetworks.includes(this.network);

    if (!compatible) {
      warnings.push(`Network ${this.network} is outside the supported contract set.`);
    }

    if (
      this.protocolVersion === undefined &&
      (this.compatibility?.minProtocolVersion ||
        this.compatibility?.maxProtocolVersion)
    ) {
      await this.loadProtocolVersion();
    }

    if (
      this.protocolVersion !== undefined &&
      this.compatibility?.minProtocolVersion !== undefined &&
      this.protocolVersion < this.compatibility.minProtocolVersion
    ) {
      compatible = false;
      warnings.push(
        `Protocol ${this.protocolVersion} is below required ${this.compatibility.minProtocolVersion}.`
      );
    }

    if (
      this.protocolVersion !== undefined &&
      this.compatibility?.maxProtocolVersion !== undefined &&
      this.protocolVersion > this.compatibility.maxProtocolVersion
    ) {
      compatible = false;
      warnings.push(
        `Protocol ${this.protocolVersion} is above supported ${this.compatibility.maxProtocolVersion}.`
      );
    }

    return {
      network: this.network,
      protocolVersion: this.protocolVersion,
      compatible,
      warnings,
    };
  }

  private async loadProtocolVersion(): Promise<void> {
    try {
      const raw = await this.rpc<Record<string, unknown>>("getNetwork", {});
      const version = raw["protocolVersion"] ?? raw["protocol_version"];
      if (version !== undefined) {
        this.protocolVersion = Number(version);
      }
    } catch {
      this.protocolVersion = undefined;
    }
  }

  private validateCall(call: ContractCall): void {
    if (!call.contractId?.startsWith("C")) {
      throw new Error("contractId must be a Soroban contract address");
    }
    if (!call.method) {
      throw new Error("method is required");
    }
  }

  private ledgerEntryKey(
    contractId: string,
    method: string,
    args: readonly unknown[] | undefined
  ): string {
    return JSON.stringify({ contractId, method, args: args ?? [] });
  }
}

export function createContractBinding<TSpec extends ContractSpec>(
  client: ContractClient,
  spec: TSpec
): ContractBinding<TSpec> {
  return client.bind(spec);
}

export function decodeObject<T extends Record<string, unknown>>(
  requiredKeys: Array<keyof T & string>
): ResultDecoder<T> {
  return (value: unknown): T => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Decoded contract result is not an object");
    }

    for (const key of requiredKeys) {
      if (!(key in value)) {
        throw new Error(`Decoded contract result is missing "${key}"`);
      }
    }

    return value as T;
  };
}

export function decodeArray<T>(
  itemDecoder: ResultDecoder<T>
): ResultDecoder<T[]> {
  return (value: unknown): T[] => {
    if (!Array.isArray(value)) {
      throw new Error("Decoded contract result is not an array");
    }
    return value.map(itemDecoder);
  };
}

function extractReturnValue(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  const result = obj["result"] as Record<string, unknown> | undefined;
  return obj["returnValue"] ?? obj["retval"] ?? result?.["retval"] ?? result ?? raw;
}

function extractFeeEstimate(raw: Record<string, unknown>): FeeEstimate {
  return {
    minResourceFee:
      extractString(raw, "minResourceFee") ?? extractString(raw, "min_resource_fee"),
    refundableFee:
      extractString(raw, "refundableFee") ?? extractString(raw, "refundable_fee"),
    inclusionFee:
      extractString(raw, "inclusionFee") ?? extractString(raw, "inclusion_fee"),
  };
}

function extractWarnings(raw: Record<string, unknown>): SimulationWarning[] {
  const warnings = raw["warnings"];
  if (!Array.isArray(warnings)) return [];
  return warnings.map((warning, index) => {
    const w = warning as Record<string, unknown>;
    return {
      code: String(w["code"] ?? `warning_${index}`),
      severity: normalizeSeverity(String(w["severity"] ?? "warning")),
      message: String(w["message"] ?? warning),
    };
  });
}

function buildApprovalRequirements(
  feeEstimate: FeeEstimate,
  authEntries: unknown[],
  warnings: SimulationWarning[]
): ApprovalRequirement[] {
  const requirements: ApprovalRequirement[] = [];

  if (feeEstimate.minResourceFee) {
    requirements.push({
      checkpoint: "fee",
      required: true,
      reason: `Minimum resource fee is ${feeEstimate.minResourceFee}.`,
    });
  }

  if (authEntries.length > 0) {
    requirements.push({
      checkpoint: "auth",
      required: true,
      reason: `${authEntries.length} Soroban authorization entr${authEntries.length === 1 ? "y" : "ies"} must be approved.`,
    });
  }

  for (const warning of warnings.filter((w) => w.severity !== "info")) {
    requirements.push({
      checkpoint: warning.severity === "error" ? "policy" : "manual",
      required: true,
      reason: warning.message,
    });
  }

  if (requirements.length === 0) {
    requirements.push({
      checkpoint: "none",
      required: false,
      reason: "Simulation produced no approval checkpoints.",
    });
  }

  return requirements;
}

function extractArray(raw: Record<string, unknown>, path: string[]): unknown[] {
  let cursor: unknown = raw;
  for (const key of path) {
    cursor = (cursor as Record<string, unknown> | undefined)?.[key];
  }
  return Array.isArray(cursor) ? cursor : [];
}

function extractString(raw: Record<string, unknown>, key: string): string | null {
  const value = raw[key];
  return value === undefined || value === null ? null : String(value);
}

function normalizeSeverity(value: string): SimulationWarning["severity"] {
  if (value === "info" || value === "warning" || value === "error") return value;
  return "warning";
}

function normalizeExecutionStatus(
  value: string | null
): ExecutionResult<unknown>["status"] {
  if (value === "PENDING" || value === "SUCCESS" || value === "FAILED") return value;
  return "UNKNOWN";
}

function createIdempotencyKey(request: ExecuteRequest): string {
  return [
    request.contractId,
    request.method,
    request.signedTransactionXdr.slice(0, 24),
  ].join(":");
}
