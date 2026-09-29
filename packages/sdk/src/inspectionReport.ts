/**
 * Stable, typed transaction inspection & simulation report format (#571).
 *
 * External applications frequently want to render "what will this transaction
 * do, what will it cost, who needs to sign, and is anything risky?" before a
 * user approves it. This module defines a versioned, serializable report shape
 * and a pure builder that assembles it from simulation output, so any app can
 * render the result directly without re-deriving the format.
 */

/** Report format version. Bump on breaking shape changes. */
export const INSPECTION_REPORT_VERSION = "1" as const;

/** Overall verdict for a transaction. */
export type InspectionStatus = "ok" | "warning" | "error";

/** Severity of a single warning. */
export type WarningSeverity = "info" | "warning" | "critical";

/** A human- and machine-readable warning about the transaction. */
export interface InspectionWarning {
  /** Stable warning code, e.g. `FEE_BELOW_SIMULATED`. */
  code: string;
  /** Human-readable explanation. */
  message: string;
  /** How serious the warning is. */
  severity: WarningSeverity;
}

/** Fee estimate, in stroops, expressed as decimal strings to stay exact. */
export interface InspectionFeeEstimate {
  /** Lowest fee likely to succeed. */
  min: string;
  /** Suggested fee. */
  recommended: string;
  /** Upper bound worth offering under contention. */
  max: string;
  /** Unit of the values above. */
  currency: "stroops";
}

/** A signer the transaction requires, with why it is needed. */
export interface SignerRequirement {
  /** Signer public key (`G...`) or signer identifier. */
  key: string;
  /** Signing weight this signer contributes, if known. */
  weight?: number;
  /** Why this signer is required (e.g. `source account`, `additional signer`). */
  reason?: string;
}

/** A single operation within the transaction. */
export interface OperationSummary {
  /** Zero-based index within the transaction. */
  index: number;
  /** Operation type, e.g. `payment`, `invokeHostFunction`. */
  type: string;
  /** Human-readable description of the operation. */
  description: string;
  /** Per-operation source account, when it differs from the tx source. */
  source?: string;
}

/** Resource usage reported by simulation (Soroban). */
export interface ResourceUsage {
  cpuInstructions?: number;
  memoryBytes?: number;
  readBytes?: number;
  writeBytes?: number;
}

/** Summary of the simulation result. */
export interface SimulationSummary {
  /** Whether simulation succeeded. */
  success: boolean;
  /** Decoded return value, when the simulation produced one. */
  returnValue?: unknown;
  /** Minimum resource fee (stroops) reported by simulation. */
  minResourceFee?: string;
  /** Resource usage, when reported. */
  resourceUsage?: ResourceUsage;
  /** Error code when simulation failed. */
  errorCode?: string;
  /** Error message when simulation failed. */
  errorMessage?: string;
}

/** High-level execution summary derived from the report. */
export interface ExecutionSummary {
  /** Whether the transaction is expected to succeed. */
  willLikelySucceed: boolean;
  /** Number of operations. */
  operationCount: number;
  /** Number of distinct required signers. */
  signerCount: number;
  /** Recommended fee (stroops). */
  recommendedFee: string;
  /** One-line summary suitable for a header/toast. */
  headline: string;
}

/** The full, serializable inspection report. */
export interface TransactionInspectionReport {
  /** {@link INSPECTION_REPORT_VERSION}. */
  version: typeof INSPECTION_REPORT_VERSION;
  /** Overall verdict. */
  status: InspectionStatus;
  /** Operations in the transaction. */
  operations: OperationSummary[];
  /** Simulation summary. */
  simulation: SimulationSummary;
  /** Fee estimate. */
  feeEstimate: InspectionFeeEstimate;
  /** Required signers. */
  signerRequirements: SignerRequirement[];
  /** Warnings surfaced during inspection. */
  warnings: InspectionWarning[];
  /** Derived execution summary. */
  executionSummary: ExecutionSummary;
  /** Unix epoch ms when the report was generated. */
  generatedAt: number;
}

/** Simulation output accepted by the builder (loosely typed on purpose). */
export interface SimulationInput {
  success: boolean;
  returnValue?: unknown;
  minResourceFee?: string | number;
  resourceUsage?: ResourceUsage;
  errorCode?: string;
  errorMessage?: string;
}

/** Inputs to {@link buildInspectionReport}. */
export interface InspectionInput {
  /**
   * Base64 operation XDRs to decode. Each is turned into an
   * {@link OperationSummary} via {@link InspectionInput.explainOperation} (or the
   * built-in `XdrDecoder`, loaded on demand).
   */
  operationXdrs?: string[];
  /** Pre-decoded operations (used as-is; takes precedence over `operationXdrs`). */
  operations?: OperationSummary[];
  /**
   * Renders a single operation XDR to a human-readable string. Injectable so the
   * builder stays decoupled from any specific decoder; defaults to the SDK's
   * `XdrDecoder.explainOperation`, which is loaded lazily only when needed.
   */
  explainOperation?: (operationXdr: string, index: number) => string;
  /** Simulation output. */
  simulation: SimulationInput;
  /** Per-operation inclusion fee in stroops (network base fee). Default `100`. */
  baseFeePerOp?: string | number;
  /** Required signers. */
  signers?: SignerRequirement[];
  /** Extra warnings to merge into the report. */
  warnings?: InspectionWarning[];
  /** Multipliers applied to the recommended fee to derive min/max. */
  feeMultipliers?: { min?: number; recommended?: number; max?: number };
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

function toBigInt(value: string | number | undefined, fallback = 0n): bigint {
  if (value === undefined) return fallback;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  const trimmed = value.trim();
  return trimmed === "" ? fallback : BigInt(trimmed);
}

/** Scale a bigint by a decimal multiplier without floating-point drift. */
function scale(value: bigint, multiplier: number): bigint {
  const PRECISION = 1000n;
  const m = BigInt(Math.round(multiplier * Number(PRECISION)));
  return (value * m) / PRECISION;
}

/**
 * Lazily load `XdrDecoder.explainOperation`. Kept out of the module's static
 * import graph so this file (and its tests) never require the decoder unless a
 * caller actually passes raw operation XDRs without their own explainer.
 */
function loadDefaultExplain(): (operationXdr: string) => string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("./xdrDecoder") as {
    XdrDecoder: { explainOperation(operationXdr: string): string };
  };
  return (operationXdr) => mod.XdrDecoder.explainOperation(operationXdr);
}

function decodeOperations(input: InspectionInput): OperationSummary[] {
  if (input.operations) return input.operations;
  const xdrs = input.operationXdrs ?? [];
  if (xdrs.length === 0) return [];
  const explain = input.explainOperation ?? loadDefaultExplain();
  return xdrs.map((xdr, index) => {
    const description = explain(xdr, index);
    // The explainer returns a leading verb we use as a coarse type label.
    const type = description.split(/\s|:/)[0]?.toLowerCase() || "operation";
    return { index, type, description };
  });
}

/**
 * Assemble a {@link TransactionInspectionReport} from simulation output. Pure
 * and deterministic given a fixed `now`.
 */
export function buildInspectionReport(
  input: InspectionInput
): TransactionInspectionReport {
  const now = input.now ?? Date.now;
  const operations = decodeOperations(input);

  const sim = input.simulation;
  const resourceFee = toBigInt(sim.minResourceFee);
  const baseFeePerOp = toBigInt(input.baseFeePerOp, 100n);
  const inclusionFee = baseFeePerOp * BigInt(Math.max(operations.length, 1));
  const recommendedRaw = resourceFee + inclusionFee;

  const mult = input.feeMultipliers ?? {};
  const recommended = scale(recommendedRaw, mult.recommended ?? 1);
  const min = scale(recommendedRaw, mult.min ?? 1);
  const max = scale(recommendedRaw, mult.max ?? 1.5);

  const feeEstimate: InspectionFeeEstimate = {
    min: min.toString(),
    recommended: recommended.toString(),
    max: max.toString(),
    currency: "stroops",
  };

  const simulation: SimulationSummary = {
    success: sim.success,
    returnValue: sim.returnValue,
    minResourceFee:
      sim.minResourceFee !== undefined ? resourceFee.toString() : undefined,
    resourceUsage: sim.resourceUsage,
    errorCode: sim.errorCode,
    errorMessage: sim.errorMessage,
  };

  const warnings: InspectionWarning[] = [...(input.warnings ?? [])];
  if (!sim.success) {
    warnings.push({
      code: "SIMULATION_FAILED",
      message: sim.errorMessage ?? "Transaction simulation failed",
      severity: "critical",
    });
  }
  if (operations.length === 0) {
    warnings.push({
      code: "NO_OPERATIONS",
      message: "Transaction contains no operations",
      severity: "warning",
    });
  }
  if ((input.signers ?? []).length === 0) {
    warnings.push({
      code: "NO_SIGNERS",
      message: "No required signers were provided",
      severity: "info",
    });
  }

  const status: InspectionStatus = !sim.success
    ? "error"
    : warnings.some((w) => w.severity === "critical")
      ? "error"
      : warnings.some((w) => w.severity === "warning")
        ? "warning"
        : "ok";

  const signerRequirements = input.signers ?? [];
  const executionSummary: ExecutionSummary = {
    willLikelySucceed: sim.success && status !== "error",
    operationCount: operations.length,
    signerCount: signerRequirements.length,
    recommendedFee: feeEstimate.recommended,
    headline: sim.success
      ? `${operations.length} operation(s), ~${feeEstimate.recommended} stroops, ${signerRequirements.length} signer(s)`
      : `Will fail: ${sim.errorMessage ?? sim.errorCode ?? "simulation error"}`,
  };

  return {
    version: INSPECTION_REPORT_VERSION,
    status,
    operations,
    simulation,
    feeEstimate,
    signerRequirements,
    warnings,
    executionSummary,
    generatedAt: now(),
  };
}

/** Serialize a report to a stable JSON string (already plain data). */
export function serializeInspectionReport(
  report: TransactionInspectionReport
): string {
  return JSON.stringify(report);
}
